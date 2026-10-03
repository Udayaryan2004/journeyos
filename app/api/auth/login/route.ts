import { one, q, HttpError } from "@/lib/db";
import { verifyPassword, issueRefresh, setSessionCookies, rateLimit } from "@/lib/auth";
import { ok, fail, handle, body } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const b = await body<{ email?: string; password?: string }>(req);
    const email = (b.email ?? "").trim().toLowerCase();

    const limit = rateLimit(`login:${email}`, 5, 15 * 60_000);
    if (!limit.ok) return fail(429, "RATE_LIMITED", `Too many attempts. Try again in ${limit.retryAfter}s.`);

    const user = await one<{
      id: string; email: string; role: "user" | "admin";
      password_hash: string | null; full_name: string | null; is_active: boolean;
    }>(`select id, email, role, password_hash, full_name, is_active from users where email = $1`, [email]);

    // identical failure for unknown email and wrong password
    if (!user?.password_hash || !user.is_active) {
      throw new HttpError(401, "UNAUTHENTICATED", "Email or password is incorrect.");
    }
    const good = await verifyPassword(b.password ?? "", user.password_hash);
    if (!good) {
      await q(`update users set failed_logins = failed_logins + 1 where id = $1`, [user.id]);
      throw new HttpError(401, "UNAUTHENTICATED", "Email or password is incorrect.");
    }

    await q(`update users set last_login_at = now(), failed_logins = 0 where id = $1`, [user.id]);

    const claims = { sub: user.id, email: user.email, role: user.role, name: user.full_name };
    await setSessionCookies(claims, await issueRefresh(user.id));

    return ok({ user: { id: user.id, email: user.email, role: user.role, name: user.full_name } });
  } catch (err) {
    return handle(err);
  }
}
