import { cookies } from "next/headers";
import { q } from "@/lib/db";
import { clearSessionCookies, currentUser, revokeAll, RT_COOKIE } from "@/lib/auth";
import { ok, handle } from "@/lib/http";
import { createHash } from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "true";
    const user = await currentUser();
    const jar = await cookies();
    const raw = jar.get(RT_COOKIE)?.value;

    if (all && user) {
      await revokeAll(user.sub);
    } else if (raw) {
      const hash = createHash("sha256").update(raw).digest("hex");
      await q(`update sessions set revoked_at = now() where token_hash = $1`, [hash]);
    }

    await clearSessionCookies();
    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
