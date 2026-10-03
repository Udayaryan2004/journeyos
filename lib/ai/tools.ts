import type OpenAI from "openai";
import { q } from "@/lib/db";
import { generatePlan, addConstraints, loadTrip } from "@/lib/plan";
import { searchFlights, searchHotels, searchPlaces, searchEvents, getWeather, cityByKeyOrName } from "@/lib/providers";
import { checkCompliance, PASSPORT_GUIDANCE } from "@/lib/compliance";

/**
 * The tool registry. Every external fact the model states must come from here.
 * The orchestrator drops any claim with no matching provenance.
 */

export const TOOL_LABELS: Record<string, string> = {
  update_trip: "Updating the trip",
  generate_plan: "Building your plan",
  search_flights: "Searching airlines",
  search_hotels: "Finding places to stay",
  search_places: "Pulling opening hours and ticket rules",
  search_events: "Checking what's on",
  get_weather: "Checking the forecast",
  check_compliance: "Checking entry requirements",
  passport_guidance: "Looking up passport procedure",
};

const num = (d?: string) => ({ type: "number", description: d });
const str = (d?: string) => ({ type: "string", description: d });

export const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "update_trip",
      description:
        "Record facts the user has given or you have safely inferred: destination, duration, dates, party, " +
        "budget, pace, interests, hotel tier, and any standing constraint ('no museum day longer than 2 hours'). " +
        "Call this BEFORE generate_plan whenever you learn something new. Omit anything you do not know.",
      parameters: {
        type: "object",
        properties: {
          destinationCity: str("City name, e.g. London"),
          originCity: str("Departure city"),
          durationDays: num("Number of nights"),
          startDate: str("ISO date YYYY-MM-DD"),
          endDate: str("ISO date YYYY-MM-DD"),
          partyAdults: num("Number of adults"),
          partyChildren: { type: "array", items: { type: "number" }, description: "Ages of children, e.g. [6, 11]" },
          budgetTotal: num("Total budget in INR for the whole trip"),
          pace: { type: "string", enum: ["relaxed", "balanced", "packed"] },
          interests: { type: "array", items: { type: "string" } },
          hotelTier: { type: "string", enum: ["budget", "mid", "luxury"] },
          constraints: {
            type: "array",
            items: { type: "string" },
            description: "Standing constraints that apply to every future turn of this trip",
          },
          title: str("Short trip title"),
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_plan",
      description:
        "Build or rebuild the full plan: flights, stays, a routed day-by-day itinerary, budget and document " +
        "requirements. Requires destination, duration and party to be known. Anything the user locked is preserved. " +
        "Call this as soon as you have the three required facts -- do not wait for budget or dates.",
      parameters: {
        type: "object",
        properties: {
          reason: str("One short line on why you are rebuilding, e.g. 'dates changed'"),
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_compliance",
      description:
        "Passport, visa and insurance requirements for every traveller on this trip. This is the ONLY source " +
        "for visa answers -- never state an outcome that is not in the result. Always quote the source and the " +
        "verified date, and always add the guidance disclaimer.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "passport_guidance",
      description:
        "How to apply for or renew a passport in a given country: route, documents, fee band, processing time, " +
        "official link. Never asks for identity documents.",
      parameters: {
        type: "object",
        properties: { nationality: str("ISO-3166 alpha-2, e.g. IN") },
        required: ["nationality"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_flights",
      description: "Priced flight options with duration, stops, baggage and a value score.",
      parameters: {
        type: "object",
        properties: {
          origin: str("City or IATA"), destination: str("City or IATA"),
          departDate: str("YYYY-MM-DD"), returnDate: str("YYYY-MM-DD"),
        },
        required: ["destination"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_hotels",
      description: "Stays filtered to the party's occupancy, with all-in totals and distance to the plan centre.",
      parameters: {
        type: "object",
        properties: {
          city: str("City name"),
          tier: { type: "string", enum: ["budget", "mid", "luxury"] },
        },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_places",
      description: "Attractions with opening hours, typical duration, age suitability and ticket rules.",
      parameters: {
        type: "object",
        properties: {
          city: str("City name"),
          interests: { type: "array", items: { type: "string" } },
          hiddenGems: { type: "boolean", description: "Only well-rated places most visitors miss" },
        },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_events",
      description: "Events falling strictly inside the trip window.",
      parameters: {
        type: "object",
        properties: { city: str("City name") },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Live forecast inside 14 days, labelled climate normals beyond it.",
      parameters: {
        type: "object",
        properties: { city: str("City name") },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
];

/* ------------------------------------------------------------------ handlers */

export interface ToolContext {
  tripId: string;
  userId: string;
}

type Handler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

const provenance = (tool: string) => ({ tool, fetchedAt: new Date().toISOString() });

export const HANDLERS: Record<string, Handler> = {
  async update_trip(args, ctx) {
    const map: Record<string, string> = {
      destinationCity: "destination_city", originCity: "origin_city",
      durationDays: "duration_days", startDate: "start_date", endDate: "end_date",
      partyAdults: "party_adults", partyChildren: "party_children",
      budgetTotal: "budget_total", pace: "pace", interests: "interests",
      hotelTier: "hotel_tier", title: "title",
    };

    const sets: string[] = [];
    const vals: unknown[] = [ctx.tripId];

    for (const [key, col] of Object.entries(map)) {
      const v = args[key];
      if (v === undefined || v === null || v === "") continue;
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    }

    // resolving the destination also fixes the country, which compliance needs
    if (typeof args.destinationCity === "string") {
      const city = cityByKeyOrName(args.destinationCity);
      if (city) {
        vals.push(city.country);
        sets.push(`destination_country = $${vals.length}`);
      }
    }

    if (sets.length) {
      await q(`update trips set ${sets.join(", ")}, state = 'gathering' where id = $1`, vals);
    }

    const constraints = Array.isArray(args.constraints) ? (args.constraints as string[]) : [];
    const stored = await addConstraints(ctx.tripId, constraints);

    const trip = await loadTrip(ctx.tripId);
    return {
      ok: true,
      trip,
      constraints: stored,
      note: "Facts recorded. Call generate_plan once destination, duration and party are known.",
      provenance: provenance("update_trip"),
    };
  },

  async generate_plan(_args, ctx) {
    try {
      const res = await generatePlan(ctx.tripId);
      return {
        ok: true,
        assumptions: res.assumptions,
        counts: {
          flights: res.flightCount, hotels: res.hotelCount,
          places: res.placeCount, events: res.eventCount,
        },
        chosenFlight: res.flight && {
          carrier: res.flight.carrierName, price: res.flight.price, currency: res.flight.currency,
          stops: res.flight.stops, durationMin: res.flight.durationMin, reason: res.flight.reason,
        },
        chosenHotel: res.hotel && {
          name: res.hotel.name, total: res.hotel.total, currency: res.hotel.currency,
          area: res.hotel.area, rating: res.hotel.rating, reason: res.hotel.reason,
        },
        days: res.itinerary.reduce((n, i) => Math.max(n, i.dayNumber), 0),
        activities: res.itinerary.filter((i) => i.type === "activity").length,
        budget: {
          total: res.budget.total, cap: res.budget.cap,
          overBy: res.budget.variance.overBy, causedBy: res.budget.variance.causedBy,
          suggestions: res.budget.variance.suggestions,
        },
        compliance: res.compliance && {
          summary: res.compliance.summary,
          blockers: res.compliance.travellers.flatMap((t) =>
            t.documents
              .filter((d) => d.severity === "blocking")
              .map((d) => ({ traveller: t.name, requirement: d.requirement, source: d.sourceUrl })),
          ),
        },
        provenance: provenance("generate_plan"),
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("MISSING_SLOTS:")) {
        return {
          ok: false,
          missing: msg.split(":")[1].split(","),
          note: "Ask the user for these, at most two questions, then call generate_plan again.",
        };
      }
      return { ok: false, error: msg };
    }
  },

  async check_compliance(_args, ctx) {
    const trip = await loadTrip(ctx.tripId);
    if (!trip?.destinationCountry || !trip.startDate) {
      return { ok: false, note: "Destination and dates are needed before documents can be checked." };
    }
    const res = await checkCompliance({
      tripId: ctx.tripId,
      destinationCountry: trip.destinationCountry,
      departDate: trip.startDate,
      returnDate: trip.endDate ?? trip.startDate,
    });
    return { ok: true, ...res };
  },

  async passport_guidance(args) {
    const code = String(args.nationality ?? "IN").toUpperCase();
    const g = PASSPORT_GUIDANCE[code];
    if (!g) {
      return {
        ok: false,
        note: `No procedure on file for ${code}. Point the user at their passport authority rather than guessing.`,
      };
    }
    return { ok: true, nationality: code, ...g, provenance: provenance("passport_guidance") };
  },

  async search_flights(args, ctx) {
    const trip = await loadTrip(ctx.tripId);
    const data = await searchFlights({
      origin: String(args.origin ?? trip?.originCity ?? "Bengaluru"),
      destination: String(args.destination ?? trip?.destinationCity ?? ""),
      departDate: String(args.departDate ?? trip?.startDate ?? new Date().toISOString().slice(0, 10)),
      returnDate: String(args.returnDate ?? trip?.endDate ?? ""),
      adults: trip?.partyAdults ?? 1,
      childAges: trip?.partyChildren ?? [],
    });
    return { ok: true, count: data.length, offers: data.slice(0, 5), provenance: provenance("search_flights") };
  },

  async search_hotels(args, ctx) {
    const trip = await loadTrip(ctx.tripId);
    const data = await searchHotels({
      city: String(args.city ?? trip?.destinationCity ?? ""),
      checkIn: trip?.startDate ?? new Date().toISOString().slice(0, 10),
      checkOut: trip?.endDate ?? new Date().toISOString().slice(0, 10),
      adults: trip?.partyAdults ?? 1,
      childAges: trip?.partyChildren ?? [],
      tier: (args.tier as never) ?? trip?.hotelTier ?? null,
    });
    return { ok: true, count: data.length, offers: data.slice(0, 5), provenance: provenance("search_hotels") };
  },

  async search_places(args, ctx) {
    const trip = await loadTrip(ctx.tripId);
    const data = await searchPlaces({
      city: String(args.city ?? trip?.destinationCity ?? ""),
      interests: (args.interests as string[]) ?? trip?.interests ?? [],
      childAges: trip?.partyChildren ?? [],
      hiddenGems: Boolean(args.hiddenGems),
      limit: 12,
    });
    return {
      ok: true,
      count: data.length,
      places: data.map((p) => ({
        name: p.name, category: p.category, durationMin: p.durationMin,
        price: p.price, ticketRequired: p.ticketRequired, sellsOut: p.sellsOut,
        ageBands: p.ageBands, note: p.note,
      })),
      provenance: provenance("search_places"),
    };
  },

  async search_events(args, ctx) {
    const trip = await loadTrip(ctx.tripId);
    if (!trip?.startDate) return { ok: false, note: "Dates are needed before events can be checked." };
    const data = await searchEvents(
      String(args.city ?? trip.destinationCity ?? ""),
      trip.startDate,
      trip.endDate ?? trip.startDate,
    );
    return { ok: true, count: data.length, events: data, provenance: provenance("search_events") };
  },

  async get_weather(args, ctx) {
    const trip = await loadTrip(ctx.tripId);
    if (!trip?.startDate) return { ok: false, note: "Dates are needed before weather can be checked." };
    const data = await getWeather(
      String(args.city ?? trip.destinationCity ?? ""),
      trip.startDate,
      trip.endDate ?? trip.startDate,
    );
    return {
      ok: true,
      isForecast: data.isForecast,
      label: data.isForecast ? "live forecast" : "climate normals (beyond the forecast window)",
      daily: data.daily,
      provenance: provenance("get_weather"),
    };
  },
};

/** Which artifact panel a tool result should refresh in the UI. */
export const TOOL_SCOPE: Record<string, "trip" | "itinerary" | "options" | "compliance" | "budget" | "essentials"> = {
  update_trip: "trip",
  generate_plan: "itinerary",
  check_compliance: "compliance",
  search_flights: "options",
  search_hotels: "options",
  search_events: "options",
  get_weather: "essentials",
};
