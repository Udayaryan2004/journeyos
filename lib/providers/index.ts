import {
  CITIES, ORIGINS, FLIGHTS, HOTELS, PLACES, EVENTS, FX_TO_INR, findCity,
  type City, type SeedPlace,
} from "@/data/seed";
import type { FlightOffer, HotelOffer, EventOffer, HotelTier } from "@/lib/types";

const now = () => new Date().toISOString();

export function resolveCity(text: string | null | undefined): City | null {
  return text ? findCity(text) : null;
}

export function cityByKeyOrName(v: string): City | null {
  const all = [...CITIES, ...ORIGINS];
  return all.find((c) => c.key === v.toLowerCase()) ?? findCity(v);
}

/* ------------------------------------------------------------------ flights */

function addMinutes(iso: string, min: number) {
  return new Date(new Date(iso).getTime() + min * 60_000).toISOString();
}

export interface FlightQuery {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string | null;
  adults: number;
  childAges: number[];
}

export async function searchFlights(qy: FlightQuery): Promise<FlightOffer[]> {
  const dest = cityByKeyOrName(qy.destination);
  const orig = cityByKeyOrName(qy.origin) ?? ORIGINS[0];
  if (!dest) return [];

  const seeds = FLIGHTS[dest.key] ?? [];
  if (!seeds.length) return [];

  // children 2-11 are typically ~75% of an adult fare; infants are nominal
  const paxMultiplier =
    qy.adults + qy.childAges.reduce((n, age) => n + (age < 2 ? 0.1 : age < 12 ? 0.75 : 1), 0);

  const raw = seeds.map((s, i) => {
    const departAt = `${qy.departDate}T${s.depart}:00`;
    const price = Math.round(s.farePerAdult * paxMultiplier);
    return {
      id: `fl_${dest.key}_${s.carrier}_${i}`,
      kind: "flight" as const,
      provider: "seed",
      carrier: s.carrier,
      carrierName: s.carrierName,
      origin: orig.iata,
      destination: dest.iata,
      departAt,
      arriveAt: addMinutes(departAt, s.durationMin),
      durationMin: s.durationMin,
      stops: s.stops,
      layovers: s.layover ? [s.layover] : [],
      baggage: { cabin: s.cabin, checked: s.checked },
      price,
      currency: "INR",
      perGroup: true,
      valueScore: 0,
      reason: "",
      deepLink: `https://www.google.com/travel/flights?q=${orig.iata}+to+${dest.iata}`,
      fetchedAt: now(),
    } satisfies FlightOffer;
  });

  // Value score: deterministic, explainable, and weighted for who is travelling.
  const prices = raw.map((r) => r.price);
  const durs = raw.map((r) => r.durationMin);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minD = Math.min(...durs), maxD = Math.max(...durs);
  const hasYoungChild = qy.childAges.some((a) => a < 10);

  for (const f of raw) {
    const priceScore = maxP === minP ? 1 : 1 - (f.price - minP) / (maxP - minP);
    const durScore = maxD === minD ? 1 : 1 - (f.durationMin - minD) / (maxD - minD);
    const stopScore = f.stops === 0 ? 1 : f.stops === 1 ? 0.55 : 0.2;
    const bagScore = Math.min(1, f.baggage.checked / 2);
    const layoverPain = f.layovers.reduce((n, l) => n + Math.min(1, l.minutes / 600), 0);
    const childPenalty = hasYoungChild ? layoverPain * 0.25 : layoverPain * 0.1;

    f.valueScore = Math.round(
      Math.max(0, Math.min(1, 0.36 * priceScore + 0.22 * durScore + 0.28 * stopScore + 0.14 * bagScore - childPenalty)) * 100,
    );
  }

  raw.sort((a, b) => b.valueScore - a.valueScore);

  const cheapest = [...raw].sort((a, b) => a.price - b.price)[0];
  for (const f of raw) {
    if (f.id === raw[0].id) {
      if (f.id === cheapest.id) {
        f.reason = `Cheapest and ${f.stops === 0 ? "direct" : "fewest stops"} — nothing to trade off here.`;
      } else {
        const saving = f.price - cheapest.price;
        const worstLayover = cheapest.layovers[0];
        f.reason = worstLayover
          ? `Not the cheapest, but the cheap one has a ${Math.round(worstLayover.minutes / 60)}-hour ${worstLayover.airport} layover${hasYoungChild ? ", which with a young child is a false economy" : ""}.`
          : `₹${Math.abs(saving).toLocaleString("en-IN")} more than the cheapest, for ${Math.round((cheapest.durationMin - f.durationMin) / 60)}h less flying.`;
      }
    } else if (f.stops === 0) {
      f.reason = `Direct, ${Math.floor(f.durationMin / 60)}h ${f.durationMin % 60}m, ${f.baggage.checked} checked bag${f.baggage.checked === 1 ? "" : "s"}.`;
    } else {
      const l = f.layovers[0];
      f.reason = `₹${(raw[0].price - f.price).toLocaleString("en-IN")} cheaper, but ${Math.round((l?.minutes ?? 0) / 60)}h in ${l?.airport ?? "transit"} each way.`;
    }
  }

  return raw;
}

/* ------------------------------------------------------------------- hotels */

export interface HotelQuery {
  city: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childAges: number[];
  tier?: HotelTier | null;
}

function nights(a: string, b: string) {
  const n = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
  return Math.max(1, n);
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function searchHotels(qy: HotelQuery): Promise<HotelOffer[]> {
  const city = cityByKeyOrName(qy.city);
  if (!city) return [];
  const seeds = HOTELS[city.key] ?? [];
  const n = nights(qy.checkIn, qy.checkOut);
  const kids = qy.childAges.length;
  const hasYoungChild = qy.childAges.some((a) => a < 10);

  const offers = seeds
    // occupancy legality is a filter, not a preference
    .filter((h) => h.maxAdults >= qy.adults && h.maxChildren >= kids)
    .filter((h) => (qy.tier ? h.tier === qy.tier : true))
    .map((h, i) => {
      const distanceToCentreKm = Number(haversineKm(city.lat, city.lng, h.lat, h.lng).toFixed(1));
      return {
        id: `ht_${city.key}_${i}`,
        kind: "hotel" as const,
        provider: "seed",
        name: h.name,
        tier: h.tier,
        stars: h.stars || null,
        rating: { score: h.rating, count: h.reviews },
        area: h.area,
        lat: h.lat,
        lng: h.lng,
        distanceToCentreKm,
        nightly: h.nightly,
        total: h.nightly * n,
        currency: "INR",
        maxAdults: h.maxAdults,
        maxChildren: h.maxChildren,
        amenities: h.amenities,
        familyFriendly: h.familyFriendly,
        stepFree: h.stepFree,
        valueScore: 0,
        reason: "",
        deepLink: `https://www.google.com/travel/hotels/${encodeURIComponent(h.name)}`,
        fetchedAt: now(),
      } satisfies HotelOffer;
    });

  if (!offers.length) return [];

  const totals = offers.map((o) => o.total);
  const minT = Math.min(...totals), maxT = Math.max(...totals);
  const maxDist = Math.max(...offers.map((o) => o.distanceToCentreKm), 1);

  for (const o of offers) {
    const priceScore = maxT === minT ? 1 : 1 - (o.total - minT) / (maxT - minT);
    const ratingScore = (o.rating.score - 3.5) / 1.5;
    const locScore = 1 - o.distanceToCentreKm / maxDist;
    const familyScore = kids > 0 ? (o.familyFriendly ? 1 : 0.3) : 0.6;
    const kitchen = o.amenities.some((a) => /kitchen/i.test(a)) ? 1 : 0;

    o.valueScore = Math.round(
      Math.max(0, Math.min(1,
        0.3 * priceScore + 0.24 * Math.max(0, Math.min(1, ratingScore)) +
        0.26 * locScore + 0.14 * familyScore + 0.06 * kitchen,
      )) * 100,
    );
  }

  offers.sort((a, b) => b.valueScore - a.valueScore);

  for (const [i, o] of offers.entries()) {
    const kitchen = o.amenities.some((a) => /kitchen/i.test(a));
    if (i === 0) {
      o.reason = [
        `${o.distanceToCentreKm} km from the centre of your plan`,
        kitchen && hasYoungChild ? "and a kitchen, which matters more than you'd think with young kids" : null,
        !kitchen && o.familyFriendly ? "and it takes your whole party in one room" : null,
      ].filter(Boolean).join(", ") + ".";
    } else {
      const diff = o.total - offers[0].total;
      o.reason = diff < 0
        ? `₹${Math.abs(diff).toLocaleString("en-IN")} cheaper, but ${(o.distanceToCentreKm - offers[0].distanceToCentreKm).toFixed(1)} km further from your days.`
        : `₹${diff.toLocaleString("en-IN")} more. ${o.rating.score}★ from ${o.rating.count.toLocaleString("en-IN")} reviews.`;
    }
  }

  return offers;
}

/* ------------------------------------------------------------------- places */

export interface PlaceQuery {
  city: string;
  interests?: string[];
  childAges?: number[];
  hiddenGems?: boolean;
  limit?: number;
}

export function bandsForAges(childAges: number[]): string[] {
  if (!childAges.length) return ["adult"];
  return childAges.map((a) => (a < 3 ? "toddler" : a < 13 ? "child" : "teen"));
}

export async function searchPlaces(qy: PlaceQuery): Promise<(SeedPlace & { id: string; city: string })[]> {
  const city = cityByKeyOrName(qy.city);
  if (!city) return [];
  const seeds = PLACES[city.key] ?? [];
  const needed = bandsForAges(qy.childAges ?? []);

  let out = seeds.filter((p) =>
    // every child in the party must be able to enjoy it
    needed.every((b) => p.ageBands.includes(b as SeedPlace["ageBands"][number])),
  );

  if (qy.hiddenGems) out = out.filter((p) => p.hiddenGem);

  if (qy.interests?.length) {
    const want = qy.interests.map((s) => s.toLowerCase());
    const scored = out.map((p) => ({
      p,
      hits: p.tags.filter((t) => want.some((w) => t.includes(w) || w.includes(t))).length +
            (want.some((w) => p.category.includes(w)) ? 1 : 0),
    }));
    if (scored.some((s) => s.hits > 0)) {
      scored.sort((a, b) => b.hits - a.hits);
      out = scored.map((s) => s.p);
    }
  }

  return out
    .slice(0, qy.limit ?? 40)
    .map((p, i) => ({ ...p, id: `pl_${city.key}_${i}`, city: city.key }));
}

/* ------------------------------------------------------------------- events */

export async function searchEvents(city: string, from: string, to: string): Promise<EventOffer[]> {
  const c = cityByKeyOrName(city);
  if (!c) return [];
  const seeds = EVENTS[c.key] ?? [];
  const start = new Date(from), end = new Date(to);
  const years = [start.getUTCFullYear(), end.getUTCFullYear()];

  const out: EventOffer[] = [];
  for (const [i, e] of seeds.entries()) {
    for (const y of [...new Set(years)]) {
      const date = `${y}-${e.monthDay}`;
      const d = new Date(date);
      // only events that actually fall inside the trip window
      if (d >= start && d <= end) {
        out.push({
          id: `ev_${c.key}_${i}_${y}`,
          kind: "event",
          name: e.name,
          category: e.category,
          venue: e.venue,
          date,
          time: e.time,
          priceBand: e.priceBand,
          familyFriendly: e.familyFriendly,
          url: e.url,
          fetchedAt: now(),
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ weather */

/** Climate normals: [avgTempC, rainChance%] by month index 0-11. */
const NORMALS: Record<string, [number, number][]> = {
  london:    [[5,55],[6,48],[8,45],[11,42],[14,40],[17,38],[19,37],[19,40],[16,42],[12,50],[8,55],[6,58]],
  dubai:     [[19,8],[21,6],[24,4],[28,2],[32,1],[34,0],[36,0],[36,0],[33,1],[30,2],[25,4],[21,7]],
  singapore: [[26,52],[27,42],[27,46],[28,52],[28,52],[28,48],[27,48],[27,50],[27,48],[27,52],[27,62],[27,62]],
  bangkok:   [[27,6],[29,12],[30,20],[31,32],[30,52],[29,58],[29,58],[29,62],[28,72],[28,58],[27,22],[26,8]],
  paris:     [[5,50],[6,45],[9,45],[12,42],[16,45],[19,42],[21,38],[21,40],[18,42],[13,50],[8,52],[6,55]],
  tokyo:     [[6,28],[7,32],[10,40],[15,42],[19,45],[22,55],[26,48],[27,45],[24,52],[18,45],[13,35],[8,28]],
};

export interface WeatherDay { date: string; tempC: number; summary: string; rainChance: number }

function summarise(temp: number, rain: number) {
  if (rain >= 60) return "rain likely";
  if (rain >= 40) return "showers possible";
  if (temp >= 30) return "hot and clear";
  if (temp >= 20) return "warm and clear";
  if (temp >= 12) return "mild";
  return "cold";
}

/**
 * Live forecast inside the Open-Meteo window, climate normals beyond it.
 * The caller is told which it got, and the UI labels normals as normals.
 */
export async function getWeather(
  city: string, from: string, to: string,
): Promise<{ daily: WeatherDay[]; isForecast: boolean }> {
  const c = cityByKeyOrName(city);
  if (!c) return { daily: [], isForecast: false };

  const days: string[] = [];
  for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
    if (days.length > 45) break;
  }

  const withinForecast =
    (new Date(from).getTime() - Date.now()) / 86_400_000 < 14 &&
    new Date(from).getTime() > Date.now() - 2 * 86_400_000;

  if (withinForecast) {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&start_date=${from}&end_date=${to}&timezone=auto`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const j = (await res.json()) as {
          daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
        };
        if (j.daily?.time?.length) {
          return {
            isForecast: true,
            daily: j.daily.time.map((date, i) => {
              const tempC = Math.round(((j.daily!.temperature_2m_max[i] ?? 0) + (j.daily!.temperature_2m_min[i] ?? 0)) / 2);
              const rainChance = j.daily!.precipitation_probability_max[i] ?? 0;
              return { date, tempC, rainChance, summary: summarise(tempC, rainChance) };
            }),
          };
        }
      }
    } catch {
      // fall through to normals -- a dead weather API must not break the plan
    }
  }

  const table = NORMALS[c.key] ?? NORMALS.london;
  return {
    isForecast: false,
    daily: days.map((date) => {
      const m = Number(date.slice(5, 7)) - 1;
      const [tempC, rainChance] = table[m];
      return { date, tempC, rainChance, summary: summarise(tempC, rainChance) };
    }),
  };
}

/* ------------------------------------------------------------------ currency */

export function convertToInr(amount: number, from: string) {
  return Math.round(amount * (FX_TO_INR[from] ?? 1));
}

export function fxRate(from: string) {
  return FX_TO_INR[from] ?? 1;
}
