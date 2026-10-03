#!/usr/bin/env node
/**
 * JourneyOS pressure test.
 *
 *   node scripts/smoke.mjs [baseUrl]
 *
 * Exercises the whole product against a running dev server: auth, trip
 * creation, the chat orchestrator (SSE), the itinerary engine's hard rules,
 * compliance, budget, sharing privacy, and the authorisation boundaries.
 *
 * Exits non-zero if any check fails.
 */

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";

let pass = 0, fail = 0, skip = 0;
const failures = [];

const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ${c.g("PASS")} ${name}`); }
  else { fail++; failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ${c.r("FAIL")} ${name}${detail ? c.d(" — " + detail) : ""}`); }
}
function warn(name, detail = "") { skip++; console.log(`  ${c.y("SKIP")} ${name}${detail ? c.d(" — " + detail) : ""}`); }
function section(t) { console.log(`\n${c.b(t)}`); }

/* ------------------------------------------------------------ cookie jar */

function makeJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (res) => {
      const raw = res.headers.getSetCookie?.() ?? [];
      for (const line of raw) {
        const [pair] = line.split(";");
        const idx = pair.indexOf("=");
        if (idx > 0) {
          const k = pair.slice(0, idx).trim();
          const v = pair.slice(idx + 1).trim();
          if (v === "" ) jar.delete(k); else jar.set(k, v);
        }
      }
    },
  };
}

async function api(jar, path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(jar ? { Cookie: jar.header() } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  if (jar) jar.absorb(res);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { res, json, text };
}

/** POST a chat message and collect every SSE event. */
async function chat(jar, tripId, message) {
  const res = await fetch(`${BASE}/api/trips/${tripId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ message, inputMode: "text" }),
  });
  if (!res.ok || !res.body) return { events: [], text: "", status: res.status };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        const payload = JSON.parse(dataLine.slice(6));
        events.push(payload);
        if (payload.type === "token") text += payload.text;
      } catch { /* partial frame */ }
    }
  }
  return { events, text, status: res.status };
}

/* --------------------------------------------------------------- the run */

const run = async () => {
  console.log(c.b(`\nJourneyOS pressure test → ${BASE}\n${"=".repeat(52)}`));

  /* ---------- 0. server up ---------- */
  section("0 · Server");
  try {
    const { res } = await api(null, "/");
    check("Server responds", res.status < 500, `status ${res.status}`);
  } catch {
    console.log(c.r(`\nServer unreachable at ${BASE} — start it with: npm run dev\n`));
    process.exit(1);
  }

  /* ---------- 1. auth ---------- */
  section("1 · Authentication");
  const jar = makeJar();
  const email = `test_${Date.now()}@journeyos.test`;

  const weak = await api(jar, "/api/auth/signup", {
    method: "POST", body: JSON.stringify({ email, password: "short" }),
  });
  check("Weak password rejected", weak.res.status === 400, `got ${weak.res.status}`);

  const signup = await api(jar, "/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "a-strong-passphrase-99", fullName: "Test Traveller" }),
  });
  check("Signup succeeds", signup.res.status === 201, `got ${signup.res.status} ${signup.text.slice(0, 120)}`);
  check("Session cookie set", jar.header().includes("jos_at"), jar.header() || "no cookies");

  const dupe = await api(makeJar(), "/api/auth/signup", {
    method: "POST", body: JSON.stringify({ email, password: "a-strong-passphrase-99" }),
  });
  check("Duplicate email does not leak account existence",
    dupe.res.status === 200 && !/exists|taken|registered already/i.test(dupe.text),
    dupe.text.slice(0, 120));

  const badLogin = await api(makeJar(), "/api/auth/login", {
    method: "POST", body: JSON.stringify({ email, password: "wrong-password-here" }),
  });
  check("Wrong password rejected with 401", badLogin.res.status === 401, `got ${badLogin.res.status}`);

  const unknown = await api(makeJar(), "/api/auth/login", {
    method: "POST", body: JSON.stringify({ email: "nobody@nowhere.test", password: "wrong-password-here" }),
  });
  check("Unknown email gives the same error as wrong password",
    unknown.res.status === badLogin.res.status &&
    unknown.json?.error?.message === badLogin.json?.error?.message);

  const anon = await api(makeJar(), "/api/trips");
  check("Unauthenticated API access refused", anon.res.status === 401, `got ${anon.res.status}`);

  /* ---------- 2. trip creation + chat ---------- */
  section("2 · Chat orchestrator");
  const created = await api(jar, "/api/trips", { method: "POST", body: "{}" });
  check("Trip created", created.res.status === 201 && Boolean(created.json?.trip?.id));
  const tripId = created.json?.trip?.id;
  if (!tripId) { console.log(c.r("\nCannot continue without a trip id.\n")); process.exit(1); }

  // CB-1: the sentence that defines the product
  const turn1 = await chat(jar, tripId, "Plan a 7-day London vacation for me, my wife and two kids");
  check("Chat stream returns events", turn1.events.length > 0, `status ${turn1.status}`);
  check("Stream terminates with done", turn1.events.some((e) => e.type === "done"));
  check("Assistant produced text", turn1.text.trim().length > 20, `"${turn1.text.slice(0, 80)}"`);

  const afterTurn1 = await api(jar, `/api/trips/${tripId}`);
  const t1 = afterTurn1.json?.trip;
  check("CB-1 destination extracted", t1?.destinationCity === "London", `got ${t1?.destinationCity}`);
  check("CB-1 duration extracted", t1?.durationDays === 7, `got ${t1?.durationDays}`);
  check("CB-1 adults inferred as 2 from 'me, my wife'", t1?.partyAdults === 2, `got ${t1?.partyAdults}`);
  check("CB-1 never asks for headcount",
    !/how many (people|travellers|adults|of you)/i.test(turn1.text),
    turn1.text.slice(0, 160));

  // turn 2: ages
  const turn2 = await chat(jar, tripId, "Second week of April. Kids are 6 and 11.");
  check("Turn 2 streams", turn2.events.some((e) => e.type === "done"));

  const afterTurn2 = await api(jar, `/api/trips/${tripId}`);
  const trip = afterTurn2.json?.trip;
  const itinerary = afterTurn2.json?.itinerary ?? [];
  check("Child ages recorded", JSON.stringify(trip?.partyChildren) === "[6,11]", JSON.stringify(trip?.partyChildren));
  check("Plan generated", itinerary.length > 0, `${itinerary.length} items`);
  check("Tool activity was reported to the UI",
    turn1.events.concat(turn2.events).some((e) => e.type === "tool_start"));

  /* ---------- 3. itinerary hard rules ---------- */
  section("3 · Itinerary engine (deterministic rules)");
  const days = [...new Set(itinerary.map((i) => i.dayNumber))].sort((a, b) => a - b);
  check("Itinerary spans multiple days", days.length >= 3, `${days.length} days`);

  let worstAnchors = 0, worstWalk = 0;
  for (const d of days) {
    const items = itinerary.filter((i) => i.dayNumber === d);
    const anchors = items.filter((i) => i.type === "activity").length;
    const walk = items.reduce((s, i) => s + (i.travelMode === "walk" ? (i.travelKm ?? 0) : 0), 0);
    worstAnchors = Math.max(worstAnchors, anchors);
    worstWalk = Math.max(worstWalk, walk);
  }
  check("FR-8.1 at most 4 anchors a day", worstAnchors <= 4, `worst day had ${worstAnchors}`);
  check("FR-8.6 walking cap respected (5 km, child under 10)", worstWalk <= 5.01, `worst day ${worstWalk.toFixed(1)} km`);

  const timed = itinerary.filter((i) => i.startTime);
  check("Items are scheduled with times", timed.length > 0);
  const outOfHours = timed.filter((i) => {
    const h = Number(i.startTime.slice(0, 2));
    return h < 5 || h > 23;
  });
  check("FR-8.4 nothing scheduled at an absurd hour", outOfHours.length === 0,
    outOfHours.map((i) => `${i.title}@${i.startTime}`).join(", "));

  const withTravel = itinerary.filter((i) => i.travelMinutes != null);
  check("Travel time shown between stops", withTravel.length > 0, `${withTravel.length} legs`);

  const sourced = itinerary.every((i) => Boolean(i.sourceTool));
  check("NFR-14 every item carries provenance", sourced);

  /* ---------- 4. compliance ---------- */
  section("4 · Compliance engine");
  const compliance = afterTurn2.json?.compliance;
  if (!compliance) {
    warn("Compliance ran", "no travellers attached to this test account");
  } else {
    check("Compliance resolved for travellers", compliance.travellers.length > 0);
    const allDocs = compliance.travellers.flatMap((t) => t.documents);
    check("Every document cites a source", allDocs.every((d) => Boolean(d.sourceUrl)));
    check("Every document carries a verified date", allDocs.every((d) => Boolean(d.verifiedOn)));
    check("Disclaimer present", /guidance only/i.test(compliance.disclaimer ?? ""));
    check("Visa outcomes come from the rules table",
      allDocs.filter((d) => d.documentType === "visa").every((d) => Boolean(d.requirement)));
  }

  /* ---------- 5. budget ---------- */
  section("5 · Budget");
  const budget = afterTurn2.json?.budget;
  check("Budget computed", Boolean(budget));
  if (budget) {
    const sum = Object.values(budget.categories).reduce((s, v) => s + v.planned, 0);
    check("Total equals categories plus buffer",
      Math.abs(budget.total - (sum + budget.buffer)) < 1,
      `total ${budget.total} vs ${sum + budget.buffer}`);
    check("Buffer is 10% of subtotal", Math.abs(budget.buffer - Math.round(sum * 0.1)) <= 1);
    if (budget.cap && budget.total > budget.cap) {
      check("Overrun names the category that caused it", Boolean(budget.variance.causedBy));
      check("Overrun offers concrete reductions", budget.variance.suggestions.length > 0);
    } else {
      warn("Overrun path", "plan came in under cap");
    }
  }

  /* ---------- 6. essentials ---------- */
  section("6 · Essentials");
  const ess = afterTurn2.json?.essentials;
  if (!ess) warn("Essentials built", "null");
  else {
    check("Packing list generated", ess.packing.length > 5, `${ess.packing.length} items`);
    check("Weather labelled forecast or normals", typeof ess.isForecast === "boolean");
    check("Emergency contacts present", ess.emergency.length > 0);
    check("Child-specific packing items included",
      ess.packing.some((p) => /child/i.test(p.group)), JSON.stringify(ess.packing.slice(0, 3)));
  }

  /* ---------- 7. authorisation ---------- */
  section("7 · Authorisation boundaries");
  const jar2 = makeJar();
  const other = await api(jar2, "/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email: `other_${Date.now()}@journeyos.test`, password: "another-strong-pass-1" }),
  });
  check("Second account created", other.res.status === 201);

  const idor = await api(jar2, `/api/trips/${tripId}`);
  check("IDOR blocked — another user cannot read the trip", idor.res.status === 404, `got ${idor.res.status}`);

  const idorChat = await api(jar2, `/api/trips/${tripId}/chat`, {
    method: "POST", body: JSON.stringify({ message: "hello" }),
  });
  check("IDOR blocked on chat", idorChat.res.status === 404, `got ${idorChat.res.status}`);

  const adminAsUser = await api(jar2, "/api/admin/metrics");
  check("Admin API refused to a normal user", adminAsUser.res.status === 403, `got ${adminAsUser.res.status}`);

  /* ---------- 8. sharing privacy ---------- */
  section("8 · Share link privacy");
  const share = await api(jar, `/api/trips/${tripId}/share`, { method: "POST" });
  check("Share link created", share.res.status === 200 && Boolean(share.json?.token));
  if (share.json?.token) {
    const pub = await api(null, `/api/share/${share.json.token}`);
    if (pub.res.status === 404) {
      warn("Public share endpoint", "route not present");
    } else {
      check("Public share readable without auth", pub.res.status === 200, `got ${pub.res.status}`);
      const blob = pub.text.toLowerCase();
      check("Share excludes budget", !blob.includes("budgettotal") && !blob.includes("\"budget\""));
      check("Share excludes documents", !blob.includes("compliance") && !blob.includes("passport"));
      check("Share excludes the owner's email", !blob.includes("@journeyos.test"));
    }
    const revoke = await api(jar, `/api/trips/${tripId}/share`, { method: "DELETE" });
    check("Share link revocable", revoke.res.status === 200);
    const afterRevoke = await api(null, `/api/share/${share.json.token}`);
    check("Revoked link stops working", afterRevoke.res.status === 404, `got ${afterRevoke.res.status}`);
  }

  /* ---------- 9. admin ---------- */
  section("9 · Admin");
  const adminJar = makeJar();
  const adminLogin = await api(adminJar, "/api/auth/login", {
    method: "POST", body: JSON.stringify({ email: "admin@journeyos.local", password: "Admin@12345" }),
  });
  check("Seeded admin can log in", adminLogin.res.status === 200, `got ${adminLogin.res.status}`);
  if (adminLogin.res.status === 200) {
    const metrics = await api(adminJar, "/api/admin/metrics");
    check("Admin metrics reachable", metrics.res.status === 200, `got ${metrics.res.status}`);
    check("Metrics report the AI mode", Boolean(metrics.json?.aiProvider?.mode));
    check("Metrics count trips", typeof metrics.json?.totals?.trips === "number");
  }

  /* ---------- 10. rate limiting ---------- */
  section("10 · Rate limiting");
  const burst = [];
  for (let i = 0; i < 24; i++) {
    burst.push(api(jar, `/api/trips/${tripId}/chat`, {
      method: "POST", body: JSON.stringify({ message: "ping" }),
    }));
  }
  const settled = await Promise.all(burst);
  const limited = settled.filter((r) => r.res.status === 429).length;
  check("Chat endpoint rate-limits a burst", limited > 0, `${limited}/24 limited`);

  /* ---------- 11. input validation ---------- */
  section("11 · Input validation");
  const empty = await api(jar, `/api/trips/${tripId}/chat`, { method: "POST", body: JSON.stringify({ message: "" }) });
  check("Empty message rejected", [400, 429].includes(empty.res.status), `got ${empty.res.status}`);

  const huge = await api(jar, `/api/trips/${tripId}/chat`, {
    method: "POST", body: JSON.stringify({ message: "x".repeat(5000) }),
  });
  check("Oversized message rejected", [400, 429].includes(huge.res.status), `got ${huge.res.status}`);

  const badJson = await fetch(`${BASE}/api/trips`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: jar.header() }, body: "{not json",
  });
  check("Malformed JSON handled without a 500", badJson.status < 500, `got ${badJson.status}`);

  const badId = await api(jar, "/api/trips/not-a-uuid");
  check("Invalid trip id handled without a 500", badId.res.status < 500, `got ${badId.res.status}`);

  /* ---------- summary ---------- */
  console.log(`\n${"=".repeat(52)}`);
  console.log(`${c.b("Result")}  ${c.g(pass + " passed")}  ${fail ? c.r(fail + " failed") : "0 failed"}  ${skip ? c.y(skip + " skipped") : ""}`);
  if (failures.length) {
    console.log(c.r("\nFailures:"));
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log("");
  process.exit(fail ? 1 : 0);
};

run().catch((err) => {
  console.error(c.r("\nHarness crashed: " + err.message));
  console.error(err);
  process.exit(1);
});
