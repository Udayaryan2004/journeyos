import { HANDLERS, TOOL_LABELS, type ToolContext } from "./tools";
import { loadTrip, loadConstraints } from "@/lib/plan";
import { cityByKeyOrName } from "@/lib/providers";
import type { ChatEvent } from "@/lib/types";

/**
 * Deterministic planner used when OPENAI_API_KEY is absent.
 *
 * It drives exactly the same tools as the model, so the product works end to
 * end -- you can plan a trip, see documents, and export a package -- without
 * spending a token. Set a key and the real model takes over with no code change.
 */

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

export interface Extracted {
  destinationCity?: string;
  durationDays?: number;
  partyAdults?: number;
  partyChildren?: number[];
  childCount?: number;
  startDate?: string;
  budgetTotal?: number;
  interests?: string[];
  constraints?: string[];
  intent: "plan" | "compliance" | "cheaper" | "package" | "weather" | "events" | "question";
}

export function extractSlots(text: string): Extracted {
  const t = text.toLowerCase();
  const out: Extracted = { intent: "plan" };

  /* destination */
  const city = cityByKeyOrName(t);
  if (city) out.destinationCity = city.name;

  /* duration: "7-day", "7 days", "a week", "long weekend" */
  const dayMatch = t.match(/(\d+)[\s-]*(?:day|night)/);
  if (dayMatch) out.durationDays = Number(dayMatch[1]);
  else if (/\b(a|one)\s+week\b/.test(t)) out.durationDays = 7;
  else if (/\btwo\s+weeks?\b/.test(t)) out.durationDays = 14;
  else if (/long weekend/.test(t)) out.durationDays = 3;
  else {
    const wordDay = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]+(?:day|night)/);
    if (wordDay) out.durationDays = WORD_NUM[wordDay[1]];
  }

  /*
   * Party. The sentence that defines the product:
   * "me, my wife and two kids" must yield 2 adults + 2 children with no follow-up.
   */
  let adults = 0;
  if (/\bme\b|\bmyself\b|\bi\b/.test(t)) adults += 1;
  if (/\b(my\s+)?(wife|husband|partner|spouse)\b/.test(t)) adults += 1;
  const adultMatch = t.match(/(\d+|one|two|three|four|five|six)\s+adults?/);
  if (adultMatch) adults = Number(adultMatch[1]) || WORD_NUM[adultMatch[1]] || adults;
  if (/\b(we|us)\b/.test(t) && adults === 0) adults = 2;
  if (adults > 0) out.partyAdults = adults;

  const kidMatch = t.match(/(\d+|one|two|three|four|five|six)\s+(?:kids?|children|child)/);
  if (kidMatch) out.childCount = Number(kidMatch[1]) || WORD_NUM[kidMatch[1]];
  else if (/\b(my\s+)?(kid|child|son|daughter)\b/.test(t) && !/\bkids\b/.test(t)) out.childCount = 1;

  /* explicit ages: "6 and 11", "aged 6 and 11", "kids are 6 and 11" */
  const ages = t.match(/\b(\d{1,2})\s*(?:,|and|&)\s*(\d{1,2})\b/);
  if (ages && Number(ages[1]) <= 18 && Number(ages[2]) <= 18) {
    out.partyChildren = [Number(ages[1]), Number(ages[2])];
  } else {
    const single = t.match(/(?:aged?|is|are)\s+(\d{1,2})\b/);
    if (single && Number(single[1]) <= 18) out.partyChildren = [Number(single[1])];
  }

  /* dates: "second week of April", "in April", "11 April" */
  const monthIdx = MONTHS.findIndex((m) => t.includes(m));
  if (monthIdx >= 0) {
    const year = new Date().getUTCFullYear() + (monthIdx < new Date().getUTCMonth() ? 1 : 0);
    let day = 1;
    if (/second week/.test(t)) day = 8;
    else if (/third week/.test(t)) day = 15;
    else if (/last week/.test(t)) day = 22;
    else if (/first week/.test(t)) day = 1;
    const explicit = t.match(new RegExp(`(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s+${MONTHS[monthIdx]}`));
    if (explicit) day = Number(explicit[1]);
    out.startDate = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  /* budget: "under 4 lakh", "₹5,00,000", "$5000" */
  const lakh = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|l\b)/);
  if (lakh) out.budgetTotal = Math.round(Number(lakh[1]) * 100_000);
  else {
    const rupees = t.match(/(?:₹|rs\.?|inr)\s*([\d,]{4,})/);
    if (rupees) out.budgetTotal = Number(rupees[1].replace(/,/g, ""));
  }

  /* interests */
  const INTEREST_WORDS = ["museum","food","history","shopping","beach","temple","art","nature","nightlife","kids","adventure"];
  const found = INTEREST_WORDS.filter((w) => t.includes(w));
  if (found.length) out.interests = found;

  /* standing constraints */
  const constraints: string[] = [];
  if (/hates? long museum|no long museum|short museum/.test(t)) {
    constraints.push("No museum visit longer than 2 hours");
  }
  if (/no early (flight|morning)/.test(t)) constraints.push("No early-morning departures");
  if (/vegetarian|vegan/.test(t)) constraints.push("Vegetarian food options needed");
  if (/wheelchair|step-free|accessible/.test(t)) constraints.push("Step-free access required");
  if (constraints.length) out.constraints = constraints;

  /* intent */
  if (/passport|visa|document|paperwork/.test(t)) out.intent = "compliance";
  else if (/cheaper|reduce|lower the (cost|budget)|too expensive/.test(t)) out.intent = "cheaper";
  else if (/generate|final package|download|finish|package it/.test(t)) out.intent = "package";
  else if (/weather|forecast|rain|temperature/.test(t)) out.intent = "weather";
  else if (/event|concert|festival|what'?s on/.test(t)) out.intent = "events";
  else if (!out.destinationCity && !out.durationDays && !out.partyAdults && /\?$/.test(text.trim())) {
    out.intent = "question";
  }

  return out;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type Persist = (
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  extra?: Record<string, unknown>,
) => Promise<void>;

export async function* runFallbackTurn(
  input: { tripId: string; userId: string; conversationId: string; userMessage: string },
  persist: Persist,
): AsyncGenerator<ChatEvent> {
  const ctx: ToolContext = { tripId: input.tripId, userId: input.userId };
  const ex = extractSlots(input.userMessage);
  const parts: string[] = [];
  const emit = async function* (text: string): AsyncGenerator<ChatEvent> {
    parts.push(text);
    // stream in word chunks so it reads like generation rather than a wall
    const tokens = text.split(/(\s+)/);
    for (let i = 0; i < tokens.length; i += 3) {
      yield { type: "token", text: tokens.slice(i, i + 3).join("") };
      await new Promise((r) => setTimeout(r, 12));
    }
  };

  const runTool = async function* (name: string, args: Record<string, unknown>) {
    const label = TOOL_LABELS[name] ?? name;
    yield { type: "tool_start", tool: name, label } as ChatEvent;
    const started = Date.now();
    const payload = await HANDLERS[name](args, ctx).catch((e) => ({ ok: false, error: (e as Error).message }));
    const p = payload as { count?: number };
    yield { type: "tool_end", tool: name, label, count: p?.count, ms: Date.now() - started } as ChatEvent;
    return payload;
  };

  /* ---- record whatever we just learned ---- */
  const update: Record<string, unknown> = {};
  if (ex.destinationCity) update.destinationCity = ex.destinationCity;
  if (ex.durationDays) update.durationDays = ex.durationDays;
  if (ex.partyAdults) update.partyAdults = ex.partyAdults;
  if (ex.partyChildren) update.partyChildren = ex.partyChildren;
  if (ex.startDate) update.startDate = ex.startDate;
  if (ex.budgetTotal) update.budgetTotal = ex.budgetTotal;
  if (ex.interests) update.interests = ex.interests;
  if (ex.constraints) update.constraints = ex.constraints;

  if (Object.keys(update).length) {
    const gen = runTool("update_trip", update);
    let r = await gen.next();
    while (!r.done) { yield r.value; r = await gen.next(); }
    yield { type: "patch", scope: "trip" };
  }

  const trip = await loadTrip(input.tripId);
  const constraints = await loadConstraints(input.tripId);

  /* ---- compliance branch ---- */
  if (ex.intent === "compliance" && trip?.destinationCountry) {
    const gen = runTool("check_compliance", {});
    let r = await gen.next();
    let payload: unknown = null;
    while (!r.done) { yield r.value; r = await gen.next(); }
    payload = r.value;
    yield { type: "patch", scope: "compliance" };

    const c = payload as { ok: boolean; travellers?: { name: string; documents: { requirement: string; severity: string; sourceUrl: string; verifiedOn: string; documentType: string }[] }[]; summary?: { blocking: number; required: number } };
    if (c?.ok && c.travellers?.length) {
      const blockers = c.travellers.flatMap((t) =>
        t.documents.filter((d) => d.severity === "blocking").map((d) => `**${t.name}** — ${d.requirement}`),
      );
      const needs = c.travellers.flatMap((t) =>
        t.documents.filter((d) => d.documentType === "visa" && d.severity !== "info").map((d) => `**${t.name}** — ${d.requirement}`),
      );
      yield* emit(
        `Here's where each traveller stands for **${trip.destinationCity}**, travelling ${trip.startDate}.\n\n` +
        (blockers.length
          ? `**${blockers.length} blocking issue${blockers.length === 1 ? "" : "s"}:**\n${blockers.map((b) => `- ${b}`).join("\n")}\n\n`
          : "**No blocking passport issues.**\n\n") +
        (needs.length ? `**Visas:**\n${needs.map((n) => `- ${n}`).join("\n")}\n\n` : "") +
        `Full detail, with sources and verification dates, is in the **Documents** tab.\n\n` +
        `*Guidance only — confirm with the official source before you apply.*`,
      );
    } else {
      yield* emit("I need the destination and dates before I can check documents. Which country, and roughly when?");
    }
    await persist(input.conversationId, "assistant", parts.join(""), {});
    yield { type: "done", state: (await loadTrip(input.tripId))?.state ?? "gathering", costUsd: 0, tokensIn: 0, tokensOut: 0 };
    return;
  }

  /* ---- do we have enough to draft? ---- */
  const missing: string[] = [];
  if (!trip?.destinationCity) missing.push("destination");
  if (!trip?.durationDays) missing.push("duration");
  if (!trip?.partyAdults) missing.push("party");

  if (missing.length) {
    const asks: string[] = [];
    if (missing.includes("destination")) asks.push("**Where** would you like to go?");
    if (missing.includes("duration")) asks.push("**How long** are you thinking?");
    if (missing.includes("party")) asks.push("**Who's travelling** with you?");
    yield* emit(
      `Happy to plan that. ${asks.length === 1 ? "One thing" : "Two things"} and I'll have a plan on screen:\n\n` +
      asks.slice(0, 2).map((a, i) => `${i + 1}. ${a}`).join("\n"),
    );
    await persist(input.conversationId, "assistant", parts.join(""), {});
    yield { type: "question", chips: ["7 days in London", "A week in Singapore", "5 days in Dubai"] };
    yield { type: "done", state: "gathering", costUsd: 0, tokensIn: 0, tokensOut: 0 };
    return;
  }

  /* ---- ask for child ages once, because they change everything ---- */
  if (ex.childCount && !trip!.partyChildren.length) {
    yield* emit(
      `Lovely — ${trip!.durationDays} days in ${trip!.destinationCity} for ${trip!.partyAdults} adult${trip!.partyAdults === 1 ? "" : "s"} ` +
      `and ${ex.childCount} ${ex.childCount === 1 ? "child" : "children"}.\n\n` +
      `One thing before I build it: **how old are the kids?** It genuinely changes the plan — walking distances, ` +
      `which museums, and hotel room rules.`,
    );
    await persist(input.conversationId, "assistant", parts.join(""), {});
    yield { type: "question", chips: ["They're 6 and 11", "Both teenagers", "One is 4"] };
    yield { type: "done", state: "gathering", costUsd: 0, tokensIn: 0, tokensOut: 0 };
    return;
  }

  /* ---- build the plan ---- */
  const gen = runTool("generate_plan", {});
  let r = await gen.next();
  while (!r.done) { yield r.value; r = await gen.next(); }
  const result = r.value as {
    ok: boolean; assumptions?: string[]; counts?: Record<string, number>;
    chosenFlight?: { carrier: string; price: number; reason: string; stops: number } | null;
    chosenHotel?: { name: string; total: number; area: string; reason: string } | null;
    days?: number; activities?: number;
    budget?: { total: number; cap: number | null; overBy: number | null; causedBy: string | null; suggestions: string[] };
    compliance?: { summary: { blocking: number; required: number }; blockers: { traveller: string; requirement: string }[] } | null;
  };

  for (const scope of ["itinerary", "options", "budget", "compliance", "essentials"] as const) {
    yield { type: "patch", scope };
  }

  if (!result?.ok) {
    yield* emit("I couldn't finish that plan. Tell me the destination and dates again and I'll retry.");
    await persist(input.conversationId, "assistant", parts.join(""), {});
    yield { type: "done", state: "gathering", costUsd: 0, tokensIn: 0, tokensOut: 0 };
    return;
  }

  const fresh = (await loadTrip(input.tripId))!;
  const youngest = fresh.partyChildren.length ? Math.min(...fresh.partyChildren) : null;

  const lines: string[] = [];
  lines.push(
    `Here's your week in **${fresh.destinationCity}**, ${fresh.startDate} to ${fresh.endDate}, ` +
    `for ${fresh.partyAdults} adult${fresh.partyAdults === 1 ? "" : "s"}` +
    (fresh.partyChildren.length ? ` and ${fresh.partyChildren.length} child${fresh.partyChildren.length === 1 ? "" : "ren"} aged ${fresh.partyChildren.join(" and ")}` : "") +
    `.\n`,
  );

  if (youngest !== null && youngest < 10) {
    lines.push(
      `I've kept it to **three anchors a day** with a **5 km walking cap** because of your ${youngest}-year-old, ` +
      `and left one day deliberately light — day four of a family trip is when everyone gets tired.\n`,
    );
  }
  if (constraints.length) {
    lines.push(`Honouring what you told me earlier: ${constraints.map((c) => `*${c.toLowerCase()}*`).join(", ")}.\n`);
  }

  lines.push("**The headlines:**\n");
  if (result.chosenFlight) {
    lines.push(`- **Flights** — ${result.chosenFlight.carrier}, ${inr(result.chosenFlight.price)} for the group. ${result.chosenFlight.reason}`);
  }
  if (result.chosenHotel) {
    lines.push(`- **Stay** — ${result.chosenHotel.name} in ${result.chosenHotel.area}, ${inr(result.chosenHotel.total)} all in. ${result.chosenHotel.reason}`);
  }
  if (result.budget) {
    lines.push(
      result.budget.overBy
        ? `- **Budget** — ${inr(result.budget.total)} against your ${inr(result.budget.cap ?? 0)} cap. ` +
          `That's ${inr(result.budget.overBy)} over, caused by **${result.budget.causedBy}**. I won't pretend otherwise.`
        : `- **Budget** — ${inr(result.budget.total)} of your ${inr(result.budget.cap ?? result.budget.total)}, buffer intact.`,
    );
  }
  if (result.compliance?.summary.blocking) {
    lines.push(`- **⚠ ${result.compliance.summary.blocking} document issue${result.compliance.summary.blocking === 1 ? "" : "s"} need${result.compliance.summary.blocking === 1 ? "s" : ""} your attention** — pinned to the top of the Documents tab.`);
  } else if (result.compliance?.summary.required) {
    lines.push(`- **Documents** — ${result.compliance.summary.required} thing${result.compliance.summary.required === 1 ? "" : "s"} to sort before you go. See the Documents tab.`);
  }

  if (result.assumptions?.length) {
    lines.push(`\n*Assumptions I made, tell me if any are wrong: ${result.assumptions.join("; ")}.*`);
  }

  if (result.budget?.overBy && result.budget.suggestions.length) {
    lines.push(`\nTwo ways to close the gap: ${result.budget.suggestions.join(" Or: ")}`);
  }

  lines.push(
    `\n${result.compliance?.summary.blocking ? "Want me to walk you through the document issue first, or look at the week?" : "Want to look at the week, or shall I cover documents and the practical bits?"}`,
  );

  yield* emit(lines.join("\n"));
  await persist(input.conversationId, "assistant", parts.join(""), {});

  yield {
    type: "question",
    chips: result.compliance?.summary.blocking
      ? ["The document issue", "Show me the week", "Make it cheaper"]
      : ["What else do I need to sort out?", "Make it cheaper", "Generate my travel package"],
  };
  yield { type: "done", state: (await loadTrip(input.tripId))!.state, costUsd: 0, tokensIn: 0, tokensOut: 0 };
}
