import type { ItineraryItem, Pace } from "@/lib/types";
import type { SeedPlace } from "@/data/seed";

/**
 * The itinerary engine. NO LLM CALLS IN THIS FILE.
 *
 * Routing, opening-hours validation and time arithmetic are the two places a
 * probabilistic answer is never acceptable. Everything here is pure and testable.
 */

const MAX_ANCHORS: Record<Pace, number> = { relaxed: 2, balanced: 3, packed: 4 };
const WALK_CAP_DEFAULT_KM = 8;
const WALK_CAP_YOUNG_CHILD_KM = 5;
const MUSEUM_CAP_YOUNG_CHILD_MIN = 120;

type Place = SeedPlace & { id: string; city: string };

export interface BuildInput {
  tripId: string;
  city: string;
  startDate: string;          // ISO date
  durationDays: number;
  childAges: number[];
  pace: Pace;
  places: Place[];
  /** honoured exactly -- these days are left free */
  freeDayNumbers?: number[];
  arrival?: { timeHHMM: string; airport: string; carrier: string } | null;
  departure?: { timeHHMM: string; airport: string; carrier: string } | null;
  hotelName?: string | null;
  /** standing constraints, e.g. "no museum day longer than 2 hours" */
  constraints?: string[];
}

/* ------------------------------------------------------------------ geometry */

export function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function travelLeg(from: Place, to: Place) {
  const km = haversineKm([from.lat, from.lng], [to.lat, to.lng]);
  let mode: "walk" | "transit" | "taxi";
  let minutes: number;
  if (km <= 1.2) {
    mode = "walk";
    minutes = Math.round(km * 12 + 2);
  } else if (km <= 9) {
    mode = "transit";
    minutes = Math.round(km * 4 + 8);
  } else {
    mode = "taxi";
    minutes = Math.round(km * 3 + 5);
  }
  return { mode, minutes, km: Number(km.toFixed(2)) };
}

/* ------------------------------------------------------- clustering + routing */

/** Lightweight k-means over lat/lng, seeded deterministically so runs repeat. */
export function clusterByGeo(places: Place[], k: number): Place[][] {
  if (k <= 1 || places.length <= k) return [places];

  const sorted = [...places].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  let centroids = Array.from({ length: k }, (_, i) => {
    const p = sorted[Math.floor((i * sorted.length) / k)];
    return [p.lat, p.lng] as [number, number];
  });

  let groups: Place[][] = [];
  for (let iter = 0; iter < 12; iter++) {
    groups = Array.from({ length: k }, () => [] as Place[]);
    for (const p of places) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < k; i++) {
        const d = haversineKm([p.lat, p.lng], centroids[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      groups[best].push(p);
    }
    const next = groups.map((g, i) =>
      g.length
        ? ([g.reduce((s, p) => s + p.lat, 0) / g.length, g.reduce((s, p) => s + p.lng, 0) / g.length] as [number, number])
        : centroids[i],
    );
    if (next.every((c, i) => c[0] === centroids[i][0] && c[1] === centroids[i][1])) break;
    centroids = next;
  }
  return groups;
}

export function routeDistanceKm(order: Place[]) {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    total += haversineKm([order[i - 1].lat, order[i - 1].lng], [order[i].lat, order[i].lng]);
  }
  return total;
}

export function nearestNeighbour(places: Place[]): Place[] {
  if (places.length < 3) return [...places];
  const remaining = [...places];
  const out = [remaining.shift()!];
  while (remaining.length) {
    const last = out[out.length - 1];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm([last.lat, last.lng], [remaining[i].lat, remaining[i].lng]);
      if (d < bd) { bd = d; bi = i; }
    }
    out.push(remaining.splice(bi, 1)[0]);
  }
  return out;
}

export function twoOpt(order: Place[]): Place[] {
  if (order.length < 4) return order;
  let best = [...order];
  let bestD = routeDistanceKm(best);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const d = routeDistanceKm(candidate);
        if (d < bestD - 1e-9) { best = candidate; bestD = d; improved = true; }
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------ opening hours */

export function isOpenOn(p: Place, date: Date): boolean {
  const dow = date.getUTCDay();
  if (p.closedDays.includes(dow)) return false;
  return Boolean(p.hours[dow]);
}

function opensAt(p: Place, date: Date): number {
  return p.hours[date.getUTCDay()]?.[0] ?? 9;
}
function closesAt(p: Place, date: Date): number {
  return p.hours[date.getUTCDay()]?.[1] ?? 18;
}

const hhmm = (decimal: number) => {
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

const slotFor = (hour: number): ItineraryItem["slot"] =>
  hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

/* ------------------------------------------------------------------- builder */

export function buildItinerary(input: BuildInput): ItineraryItem[] {
  const youngest = input.childAges.length ? Math.min(...input.childAges) : 99;
  const hasYoungChild = youngest < 10;
  const walkCap = hasYoungChild ? WALK_CAP_YOUNG_CHILD_KM : WALK_CAP_DEFAULT_KM;
  const anchorsPerDay = MAX_ANCHORS[input.pace] ?? 3;

  const capMuseums =
    hasYoungChild ||
    (input.constraints ?? []).some((c) => /museum/i.test(c) && /(short|hour|long|hate)/i.test(c));

  const freeDays = new Set(input.freeDayNumbers ?? []);
  // one genuinely light day mid-trip, unless the user already asked for free days
  if (!freeDays.size && input.durationDays >= 5) freeDays.add(Math.ceil(input.durationDays / 2));

  const activeDays = Array.from({ length: input.durationDays }, (_, i) => i + 1).filter(
    (d) => !freeDays.has(d) && d !== 1 && d !== input.durationDays,
  );

  const clusters = clusterByGeo(input.places, Math.max(1, activeDays.length));
  clusters.sort((a, b) => b.length - a.length);

  const items: ItineraryItem[] = [];
  const now = new Date().toISOString();
  let sort = 0;

  const push = (partial: Partial<ItineraryItem> & Pick<ItineraryItem, "dayNumber" | "title" | "type">) => {
    const date = addDays(input.startDate, partial.dayNumber - 1).toISOString().slice(0, 10);
    items.push({
      id: `it_${partial.dayNumber}_${sort}`,
      tripId: input.tripId,
      date,
      slot: partial.slot ?? "morning",
      sortOrder: sort++,
      description: null,
      placeName: null,
      lat: null,
      lng: null,
      startTime: null,
      durationMin: null,
      cost: null,
      costCurrency: "INR",
      travelMode: null,
      travelMinutes: null,
      travelKm: null,
      ageBands: [],
      ticketRequired: false,
      bookingUrl: null,
      locked: false,
      sourceTool: "build_itinerary",
      fetchedAt: now,
      ...partial,
    } as ItineraryItem);
  };

  /* ---- Day 1: arrival ---- */
  if (input.arrival) {
    const landH = Number(input.arrival.timeHHMM.slice(0, 2)) + Number(input.arrival.timeHHMM.slice(3)) / 60;
    push({
      dayNumber: 1, type: "flight", slot: slotFor(landH),
      title: `Land at ${input.arrival.airport}`,
      description: `${input.arrival.carrier} · immigration and baggage, allow 40 minutes`,
      startTime: input.arrival.timeHHMM, durationMin: 40,
    });
    const checkIn = landH + 2;
    push({
      dayNumber: 1, type: "checkin", slot: slotFor(checkIn),
      title: `Check in — ${input.hotelName ?? "your stay"}`,
      description: "Settle in, then something low-effort nearby",
      startTime: hhmm(checkIn), durationMin: 45,
      travelMode: "transit", travelMinutes: 55, travelKm: 24,
    });
    push({
      dayNumber: 1, type: "meal", slot: "evening",
      title: "Dinner near your stay",
      description: "Deliberately close by — nobody wants a trek on arrival day",
      startTime: hhmm(Math.min(20, checkIn + 2)), durationMin: 75, cost: 4200,
    });
  }

  /* ---- Active days ---- */
  for (const [idx, dayNumber] of activeDays.entries()) {
    const date = addDays(input.startDate, dayNumber - 1);
    const pool = (clusters[idx] ?? []).filter((p) => isOpenOn(p, date));

    let chosen = twoOpt(nearestNeighbour(pool)).slice(0, anchorsPerDay);

    // walking cap: drop the furthest tail stop until the day fits
    while (chosen.length > 1 && routeDistanceKm(chosen) > walkCap) chosen = chosen.slice(0, -1);

    if (!chosen.length) {
      push({
        dayNumber, type: "free", slot: "morning",
        title: "Open day",
        description: "Nothing in range was open today — tell me what you fancy and I'll fill it.",
      });
      continue;
    }

    let clock = Math.max(9.5, opensAt(chosen[0], date));
    let prev: Place | null = null;
    let mealDone = false;

    for (const p of chosen) {
      if (prev) {
        const leg = travelLeg(prev, p);
        clock += leg.minutes / 60;
        // lunch in the gap once we pass midday
        if (!mealDone && clock >= 12.5) {
          push({
            dayNumber, type: "meal", slot: "afternoon",
            title: `Lunch near ${p.name}`,
            startTime: hhmm(clock), durationMin: 45, cost: 2600,
            travelMode: leg.mode, travelMinutes: leg.minutes, travelKm: leg.km,
          });
          clock += 0.75;
          mealDone = true;
        }
      }

      const open = opensAt(p, date);
      if (clock < open) clock = open;

      let dur = p.durationMin;
      if (capMuseums && /museum/i.test(p.category)) dur = Math.min(dur, MUSEUM_CAP_YOUNG_CHILD_MIN);

      // never schedule past closing
      const close = closesAt(p, date);
      if (clock + dur / 60 > close) {
        if (close - clock < 0.5) continue;
        dur = Math.floor((close - clock) * 60);
      }

      const leg = prev ? travelLeg(prev, p) : null;
      push({
        dayNumber, type: "activity", slot: slotFor(clock),
        title: p.name,
        description: p.note,
        placeName: p.name, lat: p.lat, lng: p.lng,
        startTime: hhmm(clock), durationMin: dur,
        cost: p.price || null,
        ticketRequired: p.ticketRequired,
        ageBands: p.ageBands as string[],
        travelMode: leg?.mode ?? null,
        travelMinutes: leg?.minutes ?? null,
        travelKm: leg?.km ?? null,
      });

      clock += dur / 60;
      prev = p;
    }

    push({
      dayNumber, type: "meal", slot: "evening",
      title: "Dinner",
      description: hasYoungChild ? "Early, because of the six-year-old" : "Somewhere near where the day ends",
      startTime: hhmm(hasYoungChild ? 18.5 : 19.5), durationMin: 90, cost: 4800,
    });
  }

  /* ---- Free days ---- */
  for (const d of freeDays) {
    if (d === 1 || d === input.durationDays) continue;
    push({
      dayNumber: d, type: "free", slot: "morning",
      title: "Deliberately free",
      description:
        "Day four of a family trip is when everyone gets tired. Nothing booked — say the word and I'll fill it.",
    });
  }

  /* ---- Last day: departure ---- */
  if (input.departure && input.durationDays > 1) {
    const depH = Number(input.departure.timeHHMM.slice(0, 2)) + Number(input.departure.timeHHMM.slice(3)) / 60;
    const leaveFor = depH - 3;
    push({
      dayNumber: input.durationDays, type: "activity", slot: "morning",
      title: "Last morning — somewhere close",
      description: "Nothing far from your bags",
      startTime: "09:30", durationMin: 120, cost: 1800,
    });
    push({
      dayNumber: input.durationDays, type: "checkin", slot: "afternoon",
      title: "Check out and pack",
      startTime: hhmm(Math.max(11, leaveFor - 2)), durationMin: 60,
    });
    push({
      dayNumber: input.durationDays, type: "flight", slot: slotFor(leaveFor),
      title: `${input.departure.airport} — ${input.departure.carrier} departs ${input.departure.timeHHMM}`,
      description: "Three hours before departure with children",
      startTime: hhmm(leaveFor), durationMin: 180,
      travelMode: "transit", travelMinutes: 55, travelKm: 24,
    });
  }

  // stable ordering: day, then clock
  items.sort((a, b) =>
    a.dayNumber - b.dayNumber || (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"),
  );
  items.forEach((it, i) => { it.sortOrder = i; });

  return items;
}

/* ------------------------------------------------------------------ summary */

export function dayStats(items: ItineraryItem[], dayNumber: number) {
  const day = items.filter((i) => i.dayNumber === dayNumber);
  return {
    walkingKm: Number(
      day.filter((i) => i.travelMode === "walk").reduce((s, i) => s + (i.travelKm ?? 0), 0).toFixed(1),
    ),
    cost: day.reduce((s, i) => s + (i.cost ?? 0), 0),
    anchors: day.filter((i) => i.type === "activity").length,
  };
}
