import { q, one, tx } from "@/lib/db";
import { searchFlights, searchHotels, searchPlaces, searchEvents, cityByKeyOrName } from "@/lib/providers";
import { buildItinerary } from "@/lib/itinerary/build";
import { computeBudget } from "@/lib/budget";
import { checkCompliance } from "@/lib/compliance";
import { buildEssentials } from "@/lib/essentials";
import type { FlightOffer, HotelOffer, ItineraryItem, Trip, TripState } from "@/lib/types";

/* ------------------------------------------------------------------ loading */

export interface TripRow {
  id: string; user_id: string; title: string;
  destination_city: string | null; destination_country: string | null;
  // DATE columns arrive as 'YYYY-MM-DD' strings -- see the type parser in lib/db.ts
  origin_city: string | null; start_date: string | null; end_date: string | null;
  duration_days: number | null; party_adults: number; party_children: number[];
  budget_total: string | null; currency: string; pace: Trip["pace"];
  interests: string[]; hotel_tier: Trip["hotelTier"]; assumptions: string[];
  status: Trip["status"]; state: TripState; share_token: string | null;
  created_at: Date; updated_at: Date;
}

/** Dates are already 'YYYY-MM-DD'; timestamps still arrive as Date. */
const iso = (d: Date | string | null): string | null =>
  d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

export function toTrip(r: TripRow): Trip {
  return {
    id: r.id, userId: r.user_id, title: r.title,
    status: r.status, state: r.state,
    destinationCity: r.destination_city, destinationCountry: r.destination_country,
    originCity: r.origin_city,
    startDate: iso(r.start_date), endDate: iso(r.end_date),
    durationDays: r.duration_days,
    partyAdults: r.party_adults, partyChildren: r.party_children ?? [],
    budgetTotal: r.budget_total ? Number(r.budget_total) : null,
    currency: r.currency, pace: r.pace, interests: r.interests ?? [],
    hotelTier: r.hotel_tier, assumptions: r.assumptions ?? [],
    shareToken: r.share_token,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

export async function loadTrip(tripId: string): Promise<Trip | null> {
  const row = await one<TripRow>(`select * from trips where id = $1`, [tripId]);
  return row ? toTrip(row) : null;
}

/* --------------------------------------------------------------- defaults */

/** Never block on perfect information: default, and say so out loud. */
export function applyDefaults(trip: Trip, homeCity: string | null): { trip: Trip; assumptions: string[] } {
  const assumptions: string[] = [];
  const next = { ...trip };

  if (!next.originCity && homeCity) {
    next.originCity = homeCity;
    assumptions.push(`Departing from ${homeCity} (from your profile)`);
  }

  if (!next.startDate && next.durationDays) {
    // next sensible window: six weeks out, starting on a Saturday
    const d = new Date();
    d.setDate(d.getDate() + 42);
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    next.startDate = d.toISOString().slice(0, 10);
    assumptions.push(`Dates starting ${next.startDate} — tell me your real dates and I'll re-plan`);
  }

  /*
   * Derive the end date whenever it is missing, not only when we invented the
   * start. A user-supplied start with no end used to leave endDate null, which
   * collapsed the stay to a single night and silently wrecked the budget.
   * A "7-day trip" means 7 days on the ground: 7 calendar days, 6 nights.
   */
  if (next.startDate && next.durationDays && !next.endDate) {
    const end = new Date(next.startDate + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() + next.durationDays - 1);
    next.endDate = end.toISOString().slice(0, 10);
  }

  /*
   * A flat per-person-per-day default made every long-haul trip open on an
   * overrun, because the flights alone can exceed it. Scale by whether the
   * trip crosses a border: a London week from India starts at roughly
   * Rs 46,000 a head in airfare before anything else.
   */
  if (!next.budgetTotal && next.durationDays) {
    const people = next.partyAdults + next.partyChildren.length;
    const origin = next.originCity ? cityByKeyOrName(next.originCity) : null;
    const international =
      Boolean(next.destinationCountry) && next.destinationCountry !== (origin?.country ?? "IN");
    const perPersonPerDay = international ? 18_000 : 8_000;
    next.budgetTotal = Math.round((people * next.durationDays * perPersonPerDay) / 10000) * 10000;
    assumptions.push(
      `A mid-range budget of ₹${next.budgetTotal.toLocaleString("en-IN")} — say the word if that's wrong`,
    );
  }

  /*
   * Hotel tier is about the ROOM rate, not a per-person share -- four people in
   * one room cost the same as two. Roughly 30% of a trip budget goes on lodging,
   * so compare that per night against real room rates.
   */
  if (!next.hotelTier && next.budgetTotal && next.durationDays) {
    const nights = Math.max(1, next.durationDays - 1);
    const perNight = (next.budgetTotal * 0.3) / nights;
    /*
     * Thresholds are calibrated against the actual room rates in the catalogue,
     * not round numbers: a genuine five-star night runs Rs 46,000-68,000, so
     * anything under that has to land on mid or the stay alone eats the budget.
     */
    next.hotelTier = perNight >= 45_000 ? "luxury" : perNight >= 12_000 ? "mid" : "budget";
  }

  if (next.partyChildren.some((a) => a < 7) && next.pace === "balanced") {
    next.pace = "relaxed";
    assumptions.push("A relaxed pace, because of the youngest traveller");
  }

  return { trip: next, assumptions };
}

/** Everything needed to draft: destination, duration, party. */
export function missingSlots(trip: Trip): string[] {
  const missing: string[] = [];
  if (!trip.destinationCity) missing.push("destination");
  if (!trip.durationDays) missing.push("durationDays");
  if (!trip.partyAdults) missing.push("party");
  return missing;
}

/* ------------------------------------------------------------- generation */

export interface PlanResult {
  trip: Trip;
  flight: FlightOffer | null;
  hotel: HotelOffer | null;
  itinerary: ItineraryItem[];
  flightCount: number;
  hotelCount: number;
  placeCount: number;
  eventCount: number;
  compliance: Awaited<ReturnType<typeof checkCompliance>> | null;
  budget: ReturnType<typeof computeBudget>;
  assumptions: string[];
}

/**
 * The deterministic plan build. Discovery runs in parallel, then the itinerary
 * engine, budget and compliance run over the results. Persisted in one transaction.
 */
export async function generatePlan(tripId: string, opts?: { preserveLocked?: boolean }): Promise<PlanResult> {
  const base = await loadTrip(tripId);
  if (!base) throw new Error("TRIP_NOT_FOUND");

  const user = await one<{ home_city: string | null }>(
    `select home_city from users where id = $1`, [base.userId],
  );
  const { trip, assumptions } = applyDefaults(base, user?.home_city ?? null);

  if (missingSlots(trip).length) {
    throw new Error("MISSING_SLOTS:" + missingSlots(trip).join(","));
  }

  const city = cityByKeyOrName(trip.destinationCity!);
  if (!city) throw new Error("UNKNOWN_DESTINATION");

  const start = trip.startDate!;
  const end = trip.endDate ?? start;
  const childAges = trip.partyChildren;

  const [flights, hotels, places, events] = await Promise.all([
    searchFlights({
      origin: trip.originCity ?? "Bengaluru",
      destination: city.key,
      departDate: start,
      returnDate: end,
      adults: trip.partyAdults,
      childAges,
    }).catch(() => [] as FlightOffer[]),
    searchHotels({
      city: city.key, checkIn: start, checkOut: end,
      adults: trip.partyAdults, childAges, tier: trip.hotelTier,
    }).catch(() => [] as HotelOffer[]),
    searchPlaces({ city: city.key, interests: trip.interests, childAges, limit: 40 }).catch(() => []),
    searchEvents(city.key, start, end).catch(() => []),
  ]);

  const flight = flights[0] ?? null;
  const hotel = hotels[0] ?? null;

  const constraints = await loadConstraints(tripId);

  const arrival = flight
    ? {
        timeHHMM: new Date(flight.arriveAt).toISOString().slice(11, 16),
        airport: city.iata,
        carrier: flight.carrierName,
      }
    : null;
  const departure = flight
    ? { timeHHMM: "19:40", airport: city.iata, carrier: flight.carrierName }
    : null;

  const itinerary = buildItinerary({
    tripId,
    city: city.key,
    startDate: start,
    durationDays: trip.durationDays!,
    childAges,
    pace: trip.pace,
    places,
    arrival,
    departure,
    hotelName: hotel?.name ?? null,
    constraints,
  });

  let compliance = null;
  try {
    if (trip.destinationCountry ?? city.country) {
      compliance = await checkCompliance({
        tripId,
        destinationCountry: trip.destinationCountry ?? city.country,
        departDate: start,
        returnDate: end,
      });
    }
  } catch {
    // a compliance failure must not take the whole plan down
  }

  const visaExtra = compliance
    ? compliance.travellers.reduce(
        (sum, t) => sum + (t.documents.some((d) => d.documentType === "visa" && d.status === "required") ? 13400 : 0),
        0,
      )
    : 0;

  const budget = computeBudget({
    cap: trip.budgetTotal,
    currency: trip.currency,
    adults: trip.partyAdults,
    childAges,
    durationDays: trip.durationDays!,
    flight,
    hotel,
    items: itinerary,
    extras: visaExtra ? [{ label: "Visa fees", amount: visaExtra }] : [],
  });

  /* ---- persist ---- */
  await tx(async (c) => {
    await c.query(
      `update trips set
         destination_city = $2, destination_country = $3, origin_city = $4,
         start_date = $5, end_date = $6, duration_days = $7,
         budget_total = $8, hotel_tier = $9, pace = $10,
         assumptions = $11,
         status = case when status = 'draft' then 'planned' else status end,
         title = case when title = 'New trip' then $12 else title end
       where id = $1`,
      [
        tripId, city.name, city.country, trip.originCity,
        start, end, trip.durationDays,
        trip.budgetTotal, trip.hotelTier, trip.pace,
        [...new Set([...(trip.assumptions ?? []), ...assumptions])],
        `${city.name} · ${new Date(start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
      ],
    );

    if (opts?.preserveLocked !== false) {
      await c.query(`delete from itinerary_items where trip_id = $1 and locked = false`, [tripId]);
    } else {
      await c.query(`delete from itinerary_items where trip_id = $1`, [tripId]);
    }

    const locked = await c.query<{ day_number: number; title: string }>(
      `select day_number, title from itinerary_items where trip_id = $1`, [tripId],
    );
    const lockedKeys = new Set(locked.rows.map((r) => `${r.day_number}|${r.title}`));

    for (const it of itinerary) {
      if (lockedKeys.has(`${it.dayNumber}|${it.title}`)) continue;
      await c.query(
        `insert into itinerary_items
          (trip_id, day_number, item_date, slot, sort_order, item_type, title, description,
           place_name, lat, lng, start_time, duration_min, cost_amount, cost_currency,
           travel_mode, travel_minutes, travel_km, age_bands, ticket_required, source_tool)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          tripId, it.dayNumber, it.date, it.slot, it.sortOrder, it.type, it.title, it.description,
          it.placeName, it.lat, it.lng, it.startTime, it.durationMin, it.cost, it.costCurrency,
          it.travelMode, it.travelMinutes, it.travelKm, it.ageBands, it.ticketRequired, it.sourceTool,
        ],
      );
    }

    await c.query(`delete from trip_options where trip_id = $1`, [tripId]);
    const rows: [string, string, unknown, number, string, boolean][] = [
      ...flights.map((f, i) => ["flight", f.provider, f, f.valueScore, f.reason, i === 0] as const),
      ...hotels.map((h, i) => ["hotel", h.provider, h, h.valueScore, h.reason, i === 0] as const),
      ...events.map((e) => ["event", "seed", e, 50, "", false] as const),
    ].map((r) => [...r] as [string, string, unknown, number, string, boolean]);

    for (const [kind, provider, payload, score, reason, selected] of rows) {
      await c.query(
        `insert into trip_options (trip_id, kind, provider, payload, value_score, reason, selected)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [tripId, kind, provider, JSON.stringify(payload), score, reason, selected],
      );
    }
  });

  const fresh = (await loadTrip(tripId))!;

  return {
    trip: fresh,
    flight, hotel, itinerary,
    flightCount: flights.length,
    hotelCount: hotels.length,
    placeCount: places.length,
    eventCount: events.length,
    compliance,
    budget,
    assumptions,
  };
}

/* ------------------------------------------------------------ constraints */

/**
 * Standing constraints live in the conversation summary so they survive
 * context trimming -- "my son hates long museum days" must apply at turn 40.
 */
export async function loadConstraints(tripId: string): Promise<string[]> {
  const row = await one<{ summary: string | null }>(
    `select summary from conversations where trip_id = $1`, [tripId],
  );
  if (!row?.summary) return [];
  try {
    const parsed = JSON.parse(row.summary) as { constraints?: string[] };
    return parsed.constraints ?? [];
  } catch {
    return [];
  }
}

export async function addConstraints(tripId: string, add: string[]): Promise<string[]> {
  if (!add.length) return loadConstraints(tripId);
  const existing = await loadConstraints(tripId);
  const merged = [...new Set([...existing, ...add])].slice(0, 25);
  await q(
    `update conversations set summary = $2 where trip_id = $1`,
    [tripId, JSON.stringify({ constraints: merged })],
  );
  return merged;
}

/* ------------------------------------------------------------- reading back */

export async function loadItinerary(tripId: string): Promise<ItineraryItem[]> {
  const rows = await q<Record<string, unknown>>(
    `select * from itinerary_items where trip_id = $1 order by day_number, sort_order`,
    [tripId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    tripId: r.trip_id as string,
    dayNumber: r.day_number as number,
    date: iso(r.item_date as string | Date | null),
    slot: r.slot as ItineraryItem["slot"],
    sortOrder: r.sort_order as number,
    type: r.item_type as ItineraryItem["type"],
    title: r.title as string,
    description: (r.description as string) ?? null,
    placeName: (r.place_name as string) ?? null,
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : null,
    durationMin: (r.duration_min as number) ?? null,
    cost: r.cost_amount ? Number(r.cost_amount) : null,
    costCurrency: (r.cost_currency as string) ?? "INR",
    travelMode: (r.travel_mode as ItineraryItem["travelMode"]) ?? null,
    travelMinutes: (r.travel_minutes as number) ?? null,
    travelKm: r.travel_km ? Number(r.travel_km) : null,
    ageBands: (r.age_bands as string[]) ?? [],
    ticketRequired: Boolean(r.ticket_required),
    bookingUrl: (r.booking_url as string) ?? null,
    locked: Boolean(r.locked),
    sourceTool: (r.source_tool as string) ?? "build_itinerary",
    fetchedAt: (r.fetched_at as Date)?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function loadOptions<T>(tripId: string, kind: "flight" | "hotel" | "event"): Promise<T[]> {
  const rows = await q<{ payload: T; selected: boolean; value_score: string; reason: string }>(
    `select payload, selected, value_score, reason from trip_options
      where trip_id = $1 and kind = $2 order by selected desc, value_score desc`,
    [tripId, kind],
  );
  return rows.map((r) => ({ ...(r.payload as object), selected: r.selected } as T));
}

export async function tripEssentials(tripId: string) {
  const trip = await loadTrip(tripId);
  if (!trip?.destinationCity || !trip.startDate) return null;
  const items = await loadItinerary(tripId);
  return buildEssentials({
    city: trip.destinationCity,
    startDate: trip.startDate,
    endDate: trip.endDate ?? trip.startDate,
    adults: trip.partyAdults,
    childAges: trip.partyChildren,
    items,
  });
}

export async function tripBudget(tripId: string) {
  const trip = await loadTrip(tripId);
  if (!trip) return null;
  const [items, flights, hotels] = await Promise.all([
    loadItinerary(tripId),
    loadOptions<FlightOffer & { selected: boolean }>(tripId, "flight"),
    loadOptions<HotelOffer & { selected: boolean }>(tripId, "hotel"),
  ]);
  const compliance = await import("@/lib/compliance").then((m) => m.loadCompliance(tripId));
  const visaExtra = compliance
    ? compliance.travellers.reduce(
        (s, t) => s + (t.documents.some((d) => d.documentType === "visa" && d.status === "required") ? 13400 : 0),
        0,
      )
    : 0;

  return computeBudget({
    cap: trip.budgetTotal,
    currency: trip.currency,
    adults: trip.partyAdults,
    childAges: trip.partyChildren,
    durationDays: trip.durationDays ?? 1,
    flight: flights.find((f) => f.selected) ?? flights[0] ?? null,
    hotel: hotels.find((h) => h.selected) ?? hotels[0] ?? null,
    items,
    extras: visaExtra ? [{ label: "Visa fees", amount: visaExtra }] : [],
  });
}
