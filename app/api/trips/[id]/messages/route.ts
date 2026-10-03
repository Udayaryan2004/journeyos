import { q, ownedTrip } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ok, handle } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await ownedTrip(id, user.sub);

    const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 100));

    const rows = await q<{
      id: string; role: string; content: string | null;
      tool_calls: unknown; created_at: Date;
    }>(
      `select m.id, m.role, m.content, m.tool_calls, m.created_at
         from messages m
         join conversations c on c.id = m.conversation_id
        where c.trip_id = $1 and m.role in ('user','assistant')
        order by m.created_at asc
        limit $2`,
      [id, limit],
    );

    return ok({
      data: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content ?? "",
        // tool calls are for the admin inspector, not the normal chat view
        toolCount: Array.isArray(r.tool_calls) ? r.tool_calls.length : 0,
        createdAt: r.created_at.toISOString(),
      })),
    });
  } catch (err) {
    return handle(err);
  }
}
