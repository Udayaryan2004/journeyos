import { q, tx } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ok, handle, body } from "@/lib/http";
import { toTrip, type TripRow } from "@/lib/plan";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20));

    const rows = await q<TripRow & { blocking: string }>(
      `select t.*,
              (select count(*) from compliance_checks c
                where c.trip_id = t.id and c.severity = 'blocking') as blocking
         from trips t
        where t.user_id = $1
          and ($2::text is null or t.status = $2::trip_status)
          and t.status <> 'archived'
        order by t.updated_at desc
        limit $3`,
      [user.sub, status, limit],
    );

    return ok({
      data: rows.map((r) => ({ ...toTrip(r), blockingCount: Number(r.blocking) })),
    });
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const b = await body<{
      title?: string; destinationCity?: string; durationDays?: number;
      partyAdults?: number; partyChildren?: number[];
    }>(req).catch(() => ({}) as Record<string, never>);

    const trip = await tx(async (c) => {
      const res = await c.query<TripRow>(
        `insert into trips (user_id, title, destination_city, duration_days, party_adults, party_children, state)
         values ($1, $2, $3, $4, $5, $6, 'idle')
         returning *`,
        [
          user.sub,
          b.title ?? "New trip",
          b.destinationCity ?? null,
          b.durationDays ?? null,
          b.partyAdults ?? 1,
          b.partyChildren ?? [],
        ],
      );
      const created = res.rows[0];

      await c.query(`insert into conversations (trip_id) values ($1)`, [created.id]);

      // attach the user's saved travellers so compliance has someone to check
      await c.query(
        `insert into trip_travellers (trip_id, traveller_id)
         select $1, id from travellers where user_id = $2
         on conflict do nothing`,
        [created.id, user.sub],
      );

      return created;
    });

    return ok({ trip: toTrip(trip) }, { status: 201 });
  } catch (err) {
    return handle(err);
  }
}
