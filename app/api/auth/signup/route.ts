import { q, one, HttpError } from "@/lib/db";
import { hashPassword, passwordProblem, issueRefresh, setSessionCookies, rateLimit } from "@/lib/auth";
import { ok, fail, handle, body } from "@/lib/http";

export const runtime = "nodejs";

interface Payload { email?: string; password?: string; fullName?: string; homeCity?: string; nationality?: string }

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    const limit = rateLimit(`signup:${ip}`, 10, 15 * 60_000);
    if (!limit.ok) return fail(429, "RATE_LIMITED", `Try again in ${limit.retryAfter}s`);

    const b = await body<Payload>(req);
    const email = (b.email ?? "").trim().toLowerCase();
    const password = b.password ?? "";

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, "VALIDATION_FAILED", "Enter a valid email address.");
    }
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, "VALIDATION_FAILED", problem);

    const existing = await one<{ id: string }>(`select id from users where email = $1`, [email]);
    if (existing) {
      // never confirm whether an address is registered
      return ok({ ok: true, verificationSent: true });
    }

    const hash = await hashPassword(password);
    const user = await one<{ id: string; email: string; role: "user" | "admin"; full_name: string | null }>(
      `insert into users (email, password_hash, full_name, home_city, nationality, email_verified_at)
       values ($1, $2, $3, $4, $5, now())
       returning id, email, role, full_name`,
      [email, hash, b.fullName ?? null, b.homeCity ?? null, (b.nationality ?? "IN").toUpperCase().slice(0, 2)],
    );
    if (!user) throw new HttpError(500, "INTERNAL", "Could not create the account");

    /*
     * Create the account holder as a traveller straight away.
     * Without at least one traveller the compliance engine has nobody to check,
     * so a new user would see an empty Documents tab -- the one feature that
     * most justifies the product.
     */
    await q(
      `insert into travellers (user_id, name, nationality, passport_status)
       values ($1, $2, $3, 'unknown')`,
      [user.id, b.fullName?.trim() || "You", (b.nationality ?? "IN").toUpperCase().slice(0, 2)],
    );

    const claims = { sub: user.id, email: user.email, role: user.role, name: user.full_name };
    await setSessionCookies(claims, await issueRefresh(user.id));

    return ok({ user: { id: user.id, email: user.email, role: user.role, name: user.full_name } }, { status: 201 });
  } catch (err) {
    return handle(err);
  }
}
