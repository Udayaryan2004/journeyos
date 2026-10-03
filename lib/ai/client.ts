import OpenAI from "openai";

/**
 * The AI layer is provider-agnostic at the edges but concretely OpenAI here.
 * If OPENAI_API_KEY is absent the orchestrator falls back to a deterministic
 * planner (lib/ai/fallback.ts) so the whole app still runs end to end.
 */
export const hasApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

let cached: OpenAI | null = null;
export function openai(): OpenAI {
  if (!hasApiKey) throw new Error("OPENAI_API_KEY is not set");
  cached ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 2 });
  return cached;
}

export const MODELS = {
  /** Multi-constraint reasoning + tool calling. */
  planner: process.env.MODEL_PLANNER?.trim() || "gpt-4o",
  /** Classification and slot extraction. Runs every turn, so it must be cheap. */
  extractor: process.env.MODEL_EXTRACTOR?.trim() || "gpt-4o-mini",
} as const;

/**
 * Approximate USD per million tokens, for the admin cost panel only.
 * Override per model with MODEL_PRICE_<MODEL>_IN / _OUT if yours differ.
 */
const PRICE: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
};

export function costUsd(model: string, usage?: { prompt_tokens?: number; completion_tokens?: number } | null) {
  if (!usage) return 0;
  const p = PRICE[model] ?? { in: 1, out: 4 };
  return ((usage.prompt_tokens ?? 0) / 1e6) * p.in + ((usage.completion_tokens ?? 0) / 1e6) * p.out;
}

export const AI_MAX_TOOL_ITERATIONS = Number(process.env.AI_MAX_TOOL_ITERATIONS ?? 6);
