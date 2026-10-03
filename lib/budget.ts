import type { Budget, BudgetCategory, ItineraryItem, FlightOffer, HotelOffer } from "@/lib/types";

/**
 * Budget allocation. NO LLM CALLS IN THIS FILE.
 *
 * The rule that matters: when a plan cannot fit the cap we return the plan AND
 * the variance, naming the category that caused it. We never silently exceed a
 * cap and never return an empty plan.
 */

const FOOD_PER_PERSON_PER_DAY = 1000;   // INR, mid-range
const TRANSPORT_PER_PERSON_PER_DAY = 700;

export interface BudgetInput {
  cap: number | null;
  currency: string;
  adults: number;
  childAges: number[];
  durationDays: number;
  flight: FlightOffer | null;
  hotel: HotelOffer | null;
  items: ItineraryItem[];
  /** e.g. visa fees -- real costs the user cannot avoid */
  extras?: { label: string; amount: number }[];
}

export function computeBudget(input: BudgetInput): Budget {
  const people = input.adults + input.childAges.length;
  const days = Math.max(1, input.durationDays);

  const activities = input.items
    .filter((i) => i.type === "activity")
    .reduce((s, i) => s + (i.cost ?? 0), 0);

  const foodFromItems = input.items
    .filter((i) => i.type === "meal")
    .reduce((s, i) => s + (i.cost ?? 0), 0);

  const categories: Record<BudgetCategory, { planned: number; perPerson: number }> = {
    flights:    { planned: input.flight?.price ?? 0, perPerson: 0 },
    lodging:    { planned: input.hotel?.total ?? 0, perPerson: 0 },
    activities: { planned: activities, perPerson: 0 },
    food:       { planned: foodFromItems || FOOD_PER_PERSON_PER_DAY * people * days, perPerson: 0 },
    transport:  { planned: TRANSPORT_PER_PERSON_PER_DAY * people * days, perPerson: 0 },
    other:      { planned: (input.extras ?? []).reduce((s, e) => s + e.amount, 0), perPerson: 0 },
  };

  for (const k of Object.keys(categories) as BudgetCategory[]) {
    categories[k].perPerson = Math.round(categories[k].planned / people);
  }

  const subtotal = (Object.values(categories) as { planned: number }[]).reduce((s, c) => s + c.planned, 0);
  const buffer = Math.round(subtotal * 0.1);
  const total = subtotal + buffer;

  let overBy: number | null = null;
  let causedBy: BudgetCategory | null = null;
  const suggestions: string[] = [];

  if (input.cap && total > input.cap) {
    overBy = total - input.cap;

    // the category that pushed it over is the one whose removal would fix it,
    // preferring the smallest such category -- that is the honest culprit
    const entries = (Object.entries(categories) as [BudgetCategory, { planned: number }][])
      .filter(([, v]) => v.planned > 0)
      .sort((a, b) => a[1].planned - b[1].planned);
    causedBy = entries.find(([, v]) => v.planned >= overBy!)?.[0] ?? entries[entries.length - 1]?.[0] ?? null;

    if (categories.flights.planned > 0) {
      suggestions.push("Switch to a one-stop flight — usually the single biggest saving, at the cost of a long layover.");
    }
    if (categories.lodging.planned > 0) {
      suggestions.push("Drop one hotel tier, or move slightly further from the centre.");
    }
    if (!suggestions.length) suggestions.push("Shorten the trip by one night.");
    suggestions.push(`Or raise the cap to ₹${Math.ceil(total / 10000) * 10000}.`);
  }

  return {
    currency: input.currency || "INR",
    cap: input.cap,
    total,
    buffer,
    categories,
    variance: {
      amount: input.cap ? total - input.cap : 0,
      overBy,
      causedBy,
      suggestions: suggestions.slice(0, 2),
    },
  };
}
