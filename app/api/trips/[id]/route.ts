import { q, ownedTrip } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ok, handle, body } from "@/lib/http";
import { toTrip, loadItinerary, loadOptions, tripBudget, tripEssentials, type TripRow } from "@/lib/plan";
import { loadCompliance } from "@/lib/compliance";
import type { FlightOffer, HotelOffer, EventOffer } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** One read for the whole workspace -- the client needs no waterfall. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const row = await ownedTrip<TripRow>(id, user.sub);
    const trip = toTrip(row);

    const [itinerary, flights, hotels, events, compliance, budget, essentials, messageCount] =
      await Promise.all([
        loadItinerary(id),
        loadOptions<FlightOffer & { selected: boolean }>(id, "flight"),
        loadOptions<HotelOffer & { selected: boolean }>(id, "hotel"),
        loadOptions<EventOffer>(id, "event"),
        loadCompliance(id),
        tripBudget(id),
        tripEssentials(id).catch(() => null),
        q<{ n: string }>(
          `select count(*) as n from messages m
             join conversations c on c.id = m.conversation_id
            where c.trip_id = $1`, [id],
        ),
      ]);

    return ok({
      trip, itinerary, flights, hotels, events, compliance, budget, essentials,
      messageCount: Number(messageCount[0]?.n ?? 0),
    });
  } catch (err) {
    return handle(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await ownedTrip(id, user.sub);
    const b = await body<Record<string, unknown>>(req);

    const map: Record<string, string> = {
      title: "title", status: "status", pace: "pace",
      budgetTotal: "budget_total", hotelTier: "hotel_tier",
      startDate: "start_date", endDate: "end_date",
      destinationCity: "destination_city", originCity: "origin_city",
      partyAdults: "party_adults", partyChildren: "party_children",
      interests: "interests",
    };

    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [k, col] of Object.entries(map)) {
      if (b[k] === undefined) continue;
      vals.push(b[k]);
      sets.push(`${col} = $${vals.length}`);
    }
    if (!sets.length) return ok({ ok: true });

    const rows = await q<TripRow>(`update trips set ${sets.join(", ")} where id = $1 returning *`, vals);
    return ok({ trip: toTrip(rows[0]) });
  } catch (err) {
    return handle(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await ownedTrip(id, user.sub);
    await q(`update trips set status = 'archived' where id = $1`, [id]);
    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
