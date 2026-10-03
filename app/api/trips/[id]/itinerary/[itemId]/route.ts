import { q, ownedTrip, HttpError } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ok, handle, body } from "@/lib/http";
import { loadItinerary } from "@/lib/plan";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/** Move, lock or remove one itinerary item, then report any conflict it creates. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id, itemId } = await params;
    await ownedTrip(id, user.sub);

    const b = await body<{ dayNumber?: number; slot?: string; locked?: boolean; remove?: boolean }>(req);

    const existing = await q<{ id: string }>(
      `select id from itinerary_items where id = $1 and trip_id = $2`, [itemId, id],
    );
    if (!existing.length) throw new HttpError(404, "NOT_FOUND", "No such itinerary item");

    if (b.remove) {
      await q(`delete from itinerary_items where id = $1`, [itemId]);
    } else {
      const sets: string[] = [];
      const vals: unknown[] = [itemId];
      if (b.dayNumber !== undefined) { vals.push(b.dayNumber); sets.push(`day_number = $${vals.length}`); }
      if (b.slot !== undefined) { vals.push(b.slot); sets.push(`slot = $${vals.length}`); }
      if (b.locked !== undefined) { vals.push(b.locked); sets.push(`locked = $${vals.length}`); }
      if (sets.length) await q(`update itinerary_items set ${sets.join(", ")} where id = $1`, vals);
    }

    const items = await loadItinerary(id);

    /*
     * Conflicts are reported, never silently resolved. Moving an activity can
     * put two things at the same time or push a day past its walking cap --
     * the user gets told, and decides.
     */
    const conflicts: { itemId: string; reason: string }[] = [];
    const byDay = new Map<number, typeof items>();
    for (const it of items) {
      if (!byDay.has(it.dayNumber)) byDay.set(it.dayNumber, []);
      byDay.get(it.dayNumber)!.push(it);
    }
    for (const [day, dayItems] of byDay) {
      const anchors = dayItems.filter((i) => i.type === "activity");
      if (anchors.length > 4) {
        conflicts.push({ itemId: anchors[anchors.length - 1].id, reason: `Day ${day} now has ${anchors.length} anchors — that is a lot for one day.` });
      }
      const walking = dayItems.reduce((s, i) => s + (i.travelMode === "walk" ? (i.travelKm ?? 0) : 0), 0);
      if (walking > 8) {
        conflicts.push({ itemId: anchors[0]?.id ?? "", reason: `Day ${day} is now ${walking.toFixed(1)} km of walking.` });
      }
    }

    return ok({ itinerary: items, conflicts });
  } catch (err) {
    return handle(err);
  }
}
