import { one } from "@/lib/db";
import { ok, fail, handle } from "@/lib/http";
import { toTrip, loadItinerary, type TripRow } from "@/lib/plan";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

/**
 * The public read path for a shared trip. There is no session here, so this
 * handler -- not the client -- decides what a stranger may see.
 *
 * CRITICAL PRIVACY RULE
 * ---------------------
 * This endpoint NEVER returns budget figures (trip budget, per-item cost),
 * compliance results or travel documents, the owner's user id or email, the
 * share token itself, or any part of the conversation. Only the trip headline
 * (title, destination, dates, party, pace) and the day-by-day itinerary leave
 * this function, and the itinerary is projected field by field below rather
 * than spread, so a new column on itinerary_items can never leak by default.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { token } = await params;

    const row = await one<TripRow>(
      `select * from trips where share_token = $1 and share_revoked_at is null`,
      [token],
    );
    if (!row) return fail(404, "SHARE_REVOKED", "This link is no longer active");

    // toTrip gives us the camelCase domain object; we hand out a subset of it.
    const trip = toTrip(row);
    const items = await loadItinerary(trip.id);

    return ok({
      trip: {
        title: trip.title,
        destinationCity: trip.destinationCity,
        startDate: trip.startDate,
        endDate: trip.endDate,
        durationDays: trip.durationDays,
        partyAdults: trip.partyAdults,
        partyChildren: trip.partyChildren,
        pace: trip.pace,
      },
      itinerary: items.map((it) => ({
        id: it.id,
        dayNumber: it.dayNumber,
        date: it.date,
        slot: it.slot,
        sortOrder: it.sortOrder,
        type: it.type,
        title: it.title,
        description: it.description,
        placeName: it.placeName,
        startTime: it.startTime,
        durationMin: it.durationMin,
        travelMode: it.travelMode,
        travelMinutes: it.travelMinutes,
      })),
    });
  } catch (err) {
    return handle(err);
  }
}
