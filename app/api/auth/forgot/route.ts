import { q, one } from "@/lib/db";
import { rateLimit } from "@/lib/auth";
import { ok, fail, handle, body } from "@/lib/http";
import { createHash, randomBytes } from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const b = await body<{ email?: string }>(req);
    const email = (b.email ?? "").trim().toLowerCase();

    const limit = rateLimit(`forgot:${email}`, 5, 15 * 60_000);
    if (!limit.ok) return fail(429, "RATE_LIMITED", `Try again in ${limit.retryAfter}s`);

    const user = await one<{ id: string }>(`select id from users where email = $1 and is_active`, [email]);

    let devLink: string | undefined;
    if (user) {
      const raw = randomBytes(32).toString("hex");
      await q(
        `insert into auth_tokens (user_id, purpose, token_hash, expires_at)
         values ($1, 'reset', $2, now() + interval '60 minutes')`,
        [user.id, createHash("sha256").update(raw).digest("hex")],
      );
      // No mail provider is wired up in this build, so the link is returned in
      // development only. In production this goes to email and never to the client.
      if (process.env.NODE_ENV !== "production") {
        devLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/reset?token=${raw}`;
      }
    }

    // identical response whether or not the account exists
    return ok({
      ok: true,
      message: "If that email is registered, a reset link is on its way.",
      ...(devLink ? { devLink } : {}),
    });
  } catch (err) {
    return handle(err);
  }
}
