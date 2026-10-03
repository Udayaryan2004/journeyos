#!/usr/bin/env node
/**
 * Verifies the OpenAI configuration in .env.local before you trust the app.
 *
 *   npm run ai:check
 *
 * Diagnoses the four things that actually go wrong: no key, a malformed key,
 * a valid key with no billing credit, and a model your account cannot use.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "..", ".env.local");

const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

/* ---------------------------------------------------------------- load env */

let env = {};
try {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch {
  console.log(c.r("\n.env.local not found."));
  console.log(`Copy it first:  ${c.b("cp .env.example .env.local")}\n`);
  process.exit(1);
}

const key = (process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "").trim();
const planner = env.MODEL_PLANNER || "gpt-4o";
const extractor = env.MODEL_EXTRACTOR || "gpt-4o-mini";

console.log(c.b("\nJourneyOS — OpenAI configuration check"));
console.log("=".repeat(46));

/* ------------------------------------------------------------- 1. the key */

if (!key) {
  console.log(`\n${c.y("No OPENAI_API_KEY set.")}`);
  console.log("\nThe app still runs — a deterministic planner drives the same tools,");
  console.log("so every feature works end to end at zero cost. Add a key when you");
  console.log("want the model to reason freely.\n");
  console.log(c.d("Get one at https://platform.openai.com/api-keys"));
  console.log(c.d(`Then put it in ${envPath} and restart npm run dev\n`));
  process.exit(0);
}

if (!/^sk-/.test(key)) {
  console.log(`\n${c.r("That does not look like an OpenAI key.")}`);
  console.log(`OpenAI keys start with ${c.b("sk-")} (project keys with ${c.b("sk-proj-")}).`);
  console.log(c.d(`Got: ${key.slice(0, 8)}…\n`));
  process.exit(1);
}

console.log(`\nKey        ${c.g("present")} ${c.d(`(${key.slice(0, 7)}…${key.slice(-4)}, ${key.length} chars)`)}`);
console.log(`Planner    ${planner}`);
console.log(`Extractor  ${extractor}`);

const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

/* --------------------------------------------------- 2. does the key work */

console.log(c.b("\nChecking the key…"));
let models = [];
try {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) {
    console.log(c.r("  Rejected (401) — the key is invalid or has been revoked."));
    console.log(c.d("  Create a fresh one at https://platform.openai.com/api-keys\n"));
    process.exit(1);
  }
  if (!res.ok) {
    console.log(c.r(`  Unexpected ${res.status}: ${(await res.text()).slice(0, 200)}\n`));
    process.exit(1);
  }
  const json = await res.json();
  models = (json.data ?? []).map((m) => m.id);
  console.log(c.g(`  Valid — the account exposes ${models.length} models.`));
} catch (err) {
  console.log(c.r(`  Could not reach api.openai.com: ${err.message}`));
  console.log(c.d("  Check your network or proxy.\n"));
  process.exit(1);
}

/* ------------------------------------------------- 3. are the models there */

console.log(c.b("\nChecking model access…"));
let plannerOk = true;
for (const [label, model] of [["planner", planner], ["extractor", extractor]]) {
  if (models.includes(model)) {
    console.log(`  ${c.g("ok")}   ${label.padEnd(9)} ${model}`);
  } else {
    if (label === "planner") plannerOk = false;
    console.log(`  ${c.y("miss")} ${label.padEnd(9)} ${model} ${c.d("— not on this account")}`);
    const near = models.filter((m) => m.startsWith("gpt-")).slice(0, 6);
    if (near.length) console.log(c.d(`        available gpt-* include: ${near.join(", ")}`));
  }
}

/* --------------------------------------- 4. does a real call actually bill */

console.log(c.b("\nMaking one real request (a few tokens, well under a cent)…"));
try {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(40_000),
    body: JSON.stringify({
      model: plannerOk ? planner : extractor,
      max_tokens: 5,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
    }),
  });

  const text = await res.text();

  if (res.status === 429) {
    console.log(c.r("  429 — the key is valid but the account has no usable credit."));
    console.log(c.y("\n  This is the usual blocker. A key alone is not enough:"));
    console.log("  add a payment method and buy credit (the minimum is small),");
    console.log("  then retry. Until then every API call will fail this way.");
    console.log(c.d("\n  https://platform.openai.com/settings/organization/billing/overview\n"));
    process.exit(1);
  }
  if (res.status === 404) {
    console.log(c.r(`  404 — "${plannerOk ? planner : extractor}" is not available to this account.`));
    console.log(c.d(`  Set MODEL_PLANNER in .env.local to one of the models listed above.\n`));
    process.exit(1);
  }
  if (!res.ok) {
    console.log(c.r(`  ${res.status}: ${text.slice(0, 300)}\n`));
    process.exit(1);
  }

  const json = JSON.parse(text);
  const reply = json.choices?.[0]?.message?.content?.trim();
  const used = json.usage ?? {};
  console.log(c.g(`  Success — model replied "${reply}"`));
  console.log(c.d(`  tokens in ${used.prompt_tokens ?? "?"}, out ${used.completion_tokens ?? "?"}`));
} catch (err) {
  console.log(c.r(`  Request failed: ${err.message}\n`));
  process.exit(1);
}

console.log(`\n${"=".repeat(46)}`);
console.log(c.g(c.b("Ready.")) + " Restart the dev server and the live model takes over:");
console.log(`  ${c.b("npm run dev")}`);
console.log(c.d("\nConfirm it switched at http://localhost:3000/admin — the provider"));
console.log(c.d("banner turns green and reads \"Live\" instead of the fallback notice.\n"));
