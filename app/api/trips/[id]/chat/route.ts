import { one, ownedTrip } from "@/lib/db";
import { requireUser, rateLimit } from "@/lib/auth";
import { fail, handle, body } from "@/lib/http";
import { runTurn } from "@/lib/ai/orchestrator";

export const runtime = "nodejs";       // pg and bcrypt need Node, not edge
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await ownedTrip(id, user.sub);

    const limit = rateLimit(`chat:${user.sub}`, 20, 60_000);
    if (!limit.ok) return fail(429, "RATE_LIMITED", `Slow down — try again in ${limit.retryAfter}s.`);

    const b = await body<{ message?: string; inputMode?: "text" | "voice" }>(req);
    const message = (b.message ?? "").trim();
    if (!message) return fail(400, "VALIDATION_FAILED", "Message is empty");
    if (message.length > 4000) return fail(400, "VALIDATION_FAILED", "Message is too long");

    const convo = await one<{ id: string }>(`select id from conversations where trip_id = $1`, [id]);
    if (!convo) return fail(500, "INTERNAL", "This trip has no conversation");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            /* client went away mid-stream */
          }
        };
        try {
          for await (const ev of runTurn({
            tripId: id,
            userId: user.sub,
            conversationId: convo.id,
            userMessage: message,
            inputMode: b.inputMode ?? "text",
          })) {
            send(ev.type, ev);
          }
        } catch (err) {
          send("error", { type: "error", code: "AI_UNAVAILABLE", message: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",   // stop proxies buffering the stream
      },
    });
  } catch (err) {
    return handle(err);
  }
}
