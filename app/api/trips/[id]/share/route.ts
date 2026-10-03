import { q, ownedTrip } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ok, handle } from "@/lib/http";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await ownedTrip(id, user.sub);

    const token = randomBytes(12).toString("base64url");
    await q(`update trips set share_token = $2, share_revoked_at = null where id = $1`, [id, token]);

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return ok({ token, url: `${base}/share/${token}` });
  } catch (err) {
    return handle(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await ownedTrip(id, user.sub);
    await q(`update trips set share_token = null, share_revoked_at = now() where id = $1`, [id]);
    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
