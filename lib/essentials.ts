import { getWeather, cityByKeyOrName, fxRate } from "@/lib/providers";
import { EMERGENCY, LOCAL_TIPS } from "@/data/seed";
import type { Essentials, PackingItem, ItineraryItem } from "@/lib/types";

/** Packing, weather, money, connectivity and emergency info. No LLM calls. */

export interface EssentialsInput {
  city: string;
  startDate: string;
  endDate: string;
  adults: number;
  childAges: number[];
  items: ItineraryItem[];
  travellerNames?: string[];
}

function packingList(opts: {
  tempC: number; rainDays: number; totalDays: number; childAges: number[];
  countryCode: string; outdoorHeavy: boolean; names: string[];
}): PackingItem[] {
  const list: PackingItem[] = [];
  const add = (group: string, label: string) => list.push({ group, label });

  add("Documents", "Passports and visa letters — print a copy");
  add("Documents", "Travel insurance policy number");
  add("Documents", "Booking confirmations, offline");

  const plugs: Record<string, string> = {
    GB: "Type G", AE: "Type G", SG: "Type G", TH: "Type A/B/C", FR: "Type E", JP: "Type A/B",
  };
  add("Everyone", `Power adapter — ${plugs[opts.countryCode] ?? "check the plug type"} ×2`);
  add("Everyone", "Refillable water bottle");
  add("Everyone", "Basic medicines and any prescriptions");

  if (opts.tempC < 16) {
    add("Clothing", "Layers, not one warm coat — indoor heating is aggressive");
    add("Clothing", "Warm hat and gloves");
  } else if (opts.tempC > 28) {
    add("Clothing", "Light, loose cotton — synthetic fabrics are miserable in this heat");
    add("Clothing", "Sun hat and high-SPF sunscreen");
  } else {
    add("Clothing", "Light layers and one warm top for the evenings");
  }

  if (opts.rainDays >= Math.max(2, opts.totalDays * 0.3)) {
    add("Clothing", `An actual umbrella — rain on ${opts.rainDays} of your ${opts.totalDays} days`);
    add("Clothing", "Waterproof outer layer");
  }

  if (opts.outdoorHeavy) add("Clothing", "Shoes you can genuinely walk 5 km a day in");

  if (opts.countryCode === "TH") add("Clothing", "Covered shoulders and knees for temples — children included");

  for (const age of opts.childAges) {
    const who = age < 7 ? `Child (${age})` : `Child (${age})`;
    add(who, age < 7 ? "Shoes they can walk in, already broken in" : "Comfortable trainers");
    add(who, "Snacks for queues and transit");
    if (age < 10) add(who, "Tablet with films downloaded for the flight");
    if (age < 5) add(who, "Pushchair or carrier");
  }

  return list;
}

export async function buildEssentials(input: EssentialsInput): Promise<Essentials> {
  const city = cityByKeyOrName(input.city);
  const weather = await getWeather(input.city, input.startDate, input.endDate);
  const days = weather.daily.length || 1;
  const avgTemp = Math.round(weather.daily.reduce((s, d) => s + d.tempC, 0) / days) || 18;
  const rainDays = weather.daily.filter((d) => d.rainChance >= 50).length;
  const outdoorHeavy = input.items.filter((i) => i.travelMode === "walk").length >= 3;

  const rate = city ? fxRate(city.currency) : 1;
  const totalDays = Math.max(1, days);

  return {
    weather: weather.daily,
    isForecast: weather.isForecast,
    packing: packingList({
      tempC: avgTemp,
      rainDays,
      totalDays,
      childAges: input.childAges,
      countryCode: city?.country ?? "GB",
      outdoorHeavy,
      names: input.travellerNames ?? [],
    }),
    currency: city
      ? {
          from: "INR",
          to: city.currency,
          rate: Number(rate.toFixed(2)),
          asOf: new Date().toISOString(),
          note:
            city.country === "GB"
              ? "Carry £150–200 cash; everything else is contactless, buses included. Don't change money at the airport — a forex card beats a credit card by roughly 3%."
              : `Carry a small amount of ${city.currency} cash for markets and tips. A forex card usually beats a credit card on fees.`,
        }
      : null,
    connectivity: city
      ? [
          { label: `eSIM · 10 GB, ${totalDays} days`, price: 900, currency: "INR" },
          { label: "Local SIM on arrival", price: 1400, currency: "INR" },
          { label: "Roaming on your Indian plan", price: 3600, currency: "INR" },
        ]
      : [],
    emergency: city ? (EMERGENCY[city.country] ?? []) : [],
    tips: city ? (LOCAL_TIPS[city.key] ?? []) : [],
  };
}
