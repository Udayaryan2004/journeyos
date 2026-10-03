import { cookies } from "next/headers";
import { one } from "@/lib/db";
import { rotateRefresh, setSessionCookies, clearSessionCookies, RT_COOKIE } from "@/lib/auth";
import { ok, fail, handle } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  try {
    const jar = await cookies();
    const raw = jar.get(RT_COOKIE)?.value;
    if (!raw) return fail(401, "UNAUTHENTICATED", "No session");

    const rotated = await rotateRefresh(raw);
    if (!rotated) {
      // reuse detected or expired -- the family is already revoked
      await clearSessionCookies();
      return fail(401, "UNAUTHENTICATED", "Session expired, please sign in again");
    }

    const user = await one<{ id: string; email: string; role: "user" | "admin"; full_name: string | null }>(
      `select id, email, role, full_name from users where id = $1 and is_active`,
      [rotated.userId],
    );
    if (!user) {
      await clearSessionCookies();
      return fail(401, "UNAUTHENTICATED", "Account unavailable");
    }

    await setSessionCookies(
      { sub: user.id, email: user.email, role: user.role, name: user.full_name },
      rotated.next,
    );
    return ok({ user: { id: user.id, email: user.email, role: user.role, name: user.full_name } });
  } catch (err) {
    return handle(err);
  }
}
