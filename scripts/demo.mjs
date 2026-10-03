#!/usr/bin/env node
/**
 * Runs the reference conversation end to end against a live server and prints
 * what the assistant actually said, plus the plan it built.
 *
 *   npm run demo
 *
 * Works with or without OpenAI credit — with an unusable key the orchestrator
 * degrades to the deterministic planner and this still completes.
 */

const BASE = process.argv[2] ?? "http://localhost:3000";
const EMAIL = "admin@journeyos.local";
const PASSWORD = "Admin@12345";

const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  cy: (s) => `\x1b[36m${s}\x1b[0m`,
};

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i > 0) {
      const v = pair.slice(i + 1).trim();
      if (v) jar.set(pair.slice(0, i).trim(), v);
      else jar.delete(pair.slice(0, i).trim());
    }
  }
}

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookieHeader(), ...(init.headers ?? {}) },
  });
  absorb(res);
  const text = await res.text();
  try { return { res, json: JSON.parse(text) }; } catch { return { res, json: null }; }
}

/** Stream a turn, printing tool chips as they fire and text as it arrives. */
async function say(tripId, message) {
  console.log(`\n${c.b(c.cy("You ›"))} ${message}\n`);
  const res = await fetch(`${BASE}/api/trips/${tripId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify({ message, inputMode: "text" }),
  });
  if (!res.ok || !res.body) {
    console.log(c.r(`  chat failed: HTTP ${res.status}`));
    return "";
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", wroteHeader = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }

      if (ev.type === "tool_start") process.stdout.write(c.d(`  ⟳ ${ev.label}…\n`));
      else if (ev.type === "tool_end") {
        process.stdout.write(c.d(`  ${ev.warn ? "⚠" : "✓"} ${ev.label}${ev.count != null ? ` — ${ev.count}` : ""} ${c.d(`(${ev.ms}ms)`)}\n`));
      } else if (ev.type === "error" && ev.code === "AI_KEY_UNUSABLE") {
        console.log(c.y(`\n  [${ev.message}]\n`));
      } else if (ev.type === "token") {
        if (!wroteHeader) { process.stdout.write(`\n${c.b(c.g("JourneyOS ›"))} `); wroteHeader = true; }
        process.stdout.write(ev.text);
        text += ev.text;
      } else if (ev.type === "question" && ev.chips?.length) {
        process.stdout.write(c.d(`\n\n  suggested replies: ${ev.chips.map((x) => `[${x}]`).join("  ")}\n`));
      }
    }
  }
  process.stdout.write("\n");
  return text;
}

/* ------------------------------------------------------------------- run */

console.log(c.b(`\nJourneyOS demo → ${BASE}\n${"=".repeat(60)}`));

const login = await api("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (login.res.status !== 200) {
  console.log(c.r(`\nCould not sign in as ${EMAIL} (HTTP ${login.res.status}).`));
  console.log(c.d("Is the server running, and has schema.sql been applied?\n"));
  process.exit(1);
}
console.log(`Signed in as ${c.b(EMAIL)}`);

const created = await api("/api/trips", { method: "POST", body: "{}" });
const tripId = created.json?.trip?.id;
if (!tripId) { console.log(c.r("Could not create a trip.")); process.exit(1); }

await say(tripId, "Plan a 7-day London vacation for me, my wife and two kids");
await say(tripId, "Second week of April. Kids are 6 and 11.");

/* ------------------------------------------------------------ the result */

const { json } = await api(`/api/trips/${tripId}`);
const { trip, itinerary = [], flights = [], hotels = [], compliance, budget, essentials } = json ?? {};

console.log(`\n${"=".repeat(60)}`);
console.log(c.b("WHAT IT BUILT\n"));

console.log(`${c.b("Trip")}        ${trip?.destinationCity} · ${trip?.startDate} to ${trip?.endDate}`);
console.log(`${c.b("Party")}       ${trip?.partyAdults} adults${trip?.partyChildren?.length ? `, children aged ${trip.partyChildren.join(" and ")}` : ""}`);
console.log(`${c.b("Pace")}        ${trip?.pace}   ${c.b("State")} ${trip?.state}`);
if (trip?.assumptions?.length) {
  console.log(c.d(`\nAssumptions stated: ${trip.assumptions.join(" · ")}`));
}

const days = [...new Set(itinerary.map((i) => i.dayNumber))].sort((a, b) => a - b);
console.log(`\n${c.b("Itinerary")}   ${itinerary.length} items across ${days.length} days`);
for (const d of days.slice(0, 3)) {
  const items = itinerary.filter((i) => i.dayNumber === d);
  const walk = items.reduce((s, i) => s + (i.travelMode === "walk" ? (i.travelKm ?? 0) : 0), 0);
  console.log(c.d(`  Day ${d} — ${items.length} items, ${walk.toFixed(1)} km walking`));
  for (const i of items.slice(0, 4)) {
    const leg = i.travelMinutes ? c.d(`  ↳ ${i.travelMinutes} min ${i.travelMode}`) : "";
    console.log(`     ${String(i.startTime ?? "  —  ").padEnd(6)} ${i.title}${leg}`);
  }
}
if (days.length > 3) console.log(c.d(`  … and ${days.length - 3} more days`));

if (flights[0]) {
  console.log(`\n${c.b("Flight")}      ${flights[0].carrierName} ${flights[0].origin}→${flights[0].destination}, ₹${flights[0].price?.toLocaleString("en-IN")}`);
  console.log(c.d(`  why: ${flights[0].reason}`));
}
if (hotels[0]) {
  console.log(`${c.b("Stay")}        ${hotels[0].name}, ₹${hotels[0].total?.toLocaleString("en-IN")} total`);
  console.log(c.d(`  why: ${hotels[0].reason}`));
}

if (compliance) {
  console.log(`\n${c.b("Documents")}   ${compliance.summary.blocking} blocking · ${compliance.summary.required} to action · ${compliance.summary.satisfied} satisfied`);
  for (const t of compliance.travellers) {
    for (const d of t.documents.filter((x) => x.severity !== "info")) {
      const mark = d.severity === "blocking" ? c.r("●") : c.y("●");
      console.log(`  ${mark} ${t.name} — ${d.requirement.slice(0, 92)}`);
      console.log(c.d(`      source ${new URL(d.sourceUrl).hostname} · verified ${d.verifiedOn}${d.isStale ? " (stale)" : ""}`));
    }
  }
}

if (budget) {
  const over = budget.variance.overBy;
  console.log(`\n${c.b("Budget")}      ₹${budget.total.toLocaleString("en-IN")}${budget.cap ? ` of ₹${budget.cap.toLocaleString("en-IN")}` : ""}` +
    (over ? c.y(`  — ₹${over.toLocaleString("en-IN")} over, caused by ${budget.variance.causedBy}`) : c.g("  — within cap")));
  if (over) for (const s of budget.variance.suggestions) console.log(c.d(`  · ${s}`));
}

if (essentials) {
  console.log(`\n${c.b("Essentials")}  ${essentials.packing.length} packing items · weather ${essentials.isForecast ? "live forecast" : "climate normals"} · ${essentials.emergency.length} emergency contacts`);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Open it in the browser:  ${c.b(c.cy(`${BASE}/trips/${tripId}`))}`);
console.log(c.d(`Sign in with ${EMAIL} / ${PASSWORD}\n`));
