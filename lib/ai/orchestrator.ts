import type OpenAI from "openai";
import { openai, MODELS, costUsd, AI_MAX_TOOL_ITERATIONS, hasApiKey } from "./client";
import { SYSTEM_PROMPT, tripStateMessage } from "./prompt";
import { TOOL_DEFS, HANDLERS, TOOL_LABELS, TOOL_SCOPE, type ToolContext } from "./tools";
import { runFallbackTurn } from "./fallback";
import { loadTrip, loadConstraints } from "@/lib/plan";
import { q } from "@/lib/db";
import type { ChatEvent, TripState } from "@/lib/types";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

export interface TurnInput {
  tripId: string;
  userId: string;
  conversationId: string;
  userMessage: string;
  inputMode: "text" | "voice";
}

/** Recent turns, oldest first. The trip state object carries the rest. */
async function loadHistory(conversationId: string, limit = 14): Promise<Msg[]> {
  const rows = await q<{ role: string; content: string | null }>(
    `select role, content from (
       select role, content, created_at from messages
        where conversation_id = $1 and role in ('user','assistant') and content is not null
        order by created_at desc limit $2
     ) t order by created_at asc`,
    [conversationId, limit],
  );
  return rows.map((r) => ({ role: r.role as "user" | "assistant", content: r.content ?? "" }));
}

async function persistMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  extra: { toolCalls?: unknown; model?: string; tokensIn?: number; tokensOut?: number; costUsd?: number; inputMode?: string } = {},
) {
  await q(
    `insert into messages (conversation_id, role, content, tool_calls, model, tokens_in, tokens_out, cost_usd, input_mode)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      conversationId, role, content,
      extra.toolCalls ? JSON.stringify(extra.toolCalls) : null,
      extra.model ?? null, extra.tokensIn ?? 0, extra.tokensOut ?? 0,
      extra.costUsd ?? 0, extra.inputMode ?? null,
    ],
  );
}

/**
 * One conversational turn, streamed.
 *
 * A manual loop rather than a helper, because the UI needs tool_start and
 * tool_end events as the calls actually happen -- that is what makes the AI
 * legible instead of mysterious.
 */
export async function* runTurn(input: TurnInput): AsyncGenerator<ChatEvent> {
  await persistMessage(input.conversationId, "user", input.userMessage, { inputMode: input.inputMode });

  if (!hasApiKey) {
    // No key: a deterministic planner drives the same tools so the product
    // still works end to end. Swap in a key and the real model takes over.
    yield* runFallbackTurn(input, persistMessage);
    return;
  }

  const ctx: ToolContext = { tripId: input.tripId, userId: input.userId };
  const trip = await loadTrip(input.tripId);
  const constraints = await loadConstraints(input.tripId);

  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: tripStateMessage(trip, constraints) },
    ...(await loadHistory(input.conversationId)),
  ];
  if (messages[messages.length - 1]?.content !== input.userMessage) {
    messages.push({ role: "user", content: input.userMessage });
  }

  let totalCost = 0, tokensIn = 0, tokensOut = 0;
  let finalText = "";
  const allToolCalls: { name: string; args: string }[] = [];

  try {
    for (let iteration = 0; iteration < AI_MAX_TOOL_ITERATIONS; iteration++) {
      const stream = await openai().chat.completions.create({
        model: MODELS.planner,
        messages,
        tools: TOOL_DEFS,
        tool_choice: "auto",
        temperature: 0.6,
        max_tokens: 2000,
        stream: true,
        stream_options: { include_usage: true },
      });

      let content = "";
      const pending = new Map<number, PendingCall>();
      let finish: string | null = null;

      for await (const chunk of stream) {
        if (chunk.usage) {
          tokensIn += chunk.usage.prompt_tokens ?? 0;
          tokensOut += chunk.usage.completion_tokens ?? 0;
          totalCost += costUsd(MODELS.planner, chunk.usage);
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          content += choice.delta.content;
          yield { type: "token", text: choice.delta.content };
        }

        // tool calls arrive as deltas keyed by index and must be accumulated
        for (const tc of choice.delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = pending.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          pending.set(idx, cur);
        }

        if (choice.finish_reason) finish = choice.finish_reason;
      }

      if (content) finalText += content;

      if (finish !== "tool_calls" || pending.size === 0) {
        if (finish === "length") {
          yield { type: "error", code: "TRUNCATED", message: "That answer got cut short — ask me to continue." };
        }
        break;
      }

      const calls = [...pending.values()].filter((c) => c.name);

      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: calls.map((c) => ({
          id: c.id, type: "function" as const,
          function: { name: c.name, arguments: c.args || "{}" },
        })),
      });

      // run them in parallel -- the whole point of the provider fan-out
      const results = await Promise.all(
        calls.map(async (call) => {
          const label = TOOL_LABELS[call.name] ?? call.name;
          const started = Date.now();
          let parsed: Record<string, unknown> = {};
          try {
            parsed = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {};
          } catch {
            return {
              call, label, ms: 0, warn: true,
              payload: { ok: false, error: "INVALID_JSON", note: "Arguments were not valid JSON. Try again." },
            };
          }
          try {
            const handler = HANDLERS[call.name];
            if (!handler) {
              return { call, label, ms: 0, warn: true, payload: { ok: false, error: "UNKNOWN_TOOL" } };
            }
            const payload = await handler(parsed, ctx);
            return { call, label, ms: Date.now() - started, warn: false, payload };
          } catch (err) {
            // a dead provider degrades one panel, never the whole plan
            return {
              call, label, ms: Date.now() - started, warn: true,
              payload: { ok: false, error: (err as Error).message },
            };
          }
        }),
      );

      for (const r of results) {
        yield { type: "tool_start", tool: r.call.name, label: r.label };
      }

      for (const r of results) {
        allToolCalls.push({ name: r.call.name, args: r.call.args });
        const payload = r.payload as { count?: number; counts?: Record<string, number> };
        yield {
          type: "tool_end",
          tool: r.call.name,
          label: r.label,
          count: payload?.count ?? payload?.counts?.places,
          ms: r.ms,
          warn: r.warn,
        };
        const scope = TOOL_SCOPE[r.call.name];
        if (scope) yield { type: "patch", scope };
      }

      // all tool results go back in the same turn, one message each
      for (const r of results) {
        messages.push({
          role: "tool",
          tool_call_id: r.call.id,
          content: JSON.stringify(r.payload).slice(0, 12_000),
        });
      }
    }

    const fresh = await loadTrip(input.tripId);
    const state: TripState = fresh?.state ?? "gathering";

    await persistMessage(input.conversationId, "assistant", finalText, {
      toolCalls: allToolCalls,
      model: MODELS.planner,
      tokensIn, tokensOut, costUsd: totalCost,
    });

    yield { type: "done", state, costUsd: totalCost, tokensIn, tokensOut };
  } catch (err) {
    const message = (err as Error).message ?? "The assistant is unavailable.";
    await persistMessage(input.conversationId, "assistant", `[error] ${message}`, { model: MODELS.planner });
    yield { type: "error", code: "AI_UNAVAILABLE", message };
  }
}
