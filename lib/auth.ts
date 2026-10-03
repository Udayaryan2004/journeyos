import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { q, one, HttpError } from "./db";
import { signAccess, readAccess, ACCESS_TTL, AT_COOKIE, RT_COOKIE, type Claims, type Role } from "./auth-edge";

/**
 * Node-runtime auth: password hashing, sessions, cookies and guards.
 * The JWT half lives in lib/auth-edge.ts because middleware cannot import
 * `crypto`, `pg` or `bcryptjs`.
 */

const REFRESH_DAYS = 30;

export { signAccess, readAccess, AT_COOKIE, RT_COOKIE };
export type { Claims, Role };

/* ------------------------------------------------------------------ passwords */

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** Tiny deny-list. A real deployment checks against a breached-password corpus. */
const WEAK = new Set([
  "password12", "password123", "1234567890", "qwertyuiop", "letmeinnow",
  "iloveyou12", "admin12345", "welcome123", "passw0rd12",
]);

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (WEAK.has(pw.toLowerCase())) return "That password is too common.";
  if (/^(.)\1+$/.test(pw)) return "That password is too simple.";
  return null;
}

/* ------------------------------------------------------------------ tokens */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function issueRefresh(userId: string, familyId?: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into sessions (user_id, family_id, token_hash, expires_at)
     values ($1, coalesce($2::uuid, gen_random_uuid()), $3, now() + ($4 || ' days')::interval)`,
    [userId, familyId ?? null, sha(raw), String(REFRESH_DAYS)],
  );
  return raw;
}

/**
 * Rotate a refresh token. Reuse of an already-consumed token means the cookie
 * leaked, so the whole family is revoked rather than just that one token.
 */
export async function rotateRefresh(raw: string): Promise<{ userId: string; next: string } | null> {
  const row = await one<{
    id: string; user_id: string; family_id: string;
    consumed_at: Date | null; revoked_at: Date | null; expires_at: Date;
  }>(`select * from sessions where token_hash = $1`, [sha(raw)]);

  if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) return null;

  if (row.consumed_at) {
    await q(`update sessions set revoked_at = now() where family_id = $1 and revoked_at is null`, [
      row.family_id,
    ]);
    return null;
  }

  await q(`update sessions set consumed_at = now() where id = $1`, [row.id]);
  return { userId: row.user_id, next: await issueRefresh(row.user_id, row.family_id) };
}

export async function revokeAll(userId: string) {
  await q(`update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
}

/* ------------------------------------------------------------------ cookies */

export async function setSessionCookies(claims: Claims, refresh: string) {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(AT_COOKIE, await signAccess(claims), {
    httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: ACCESS_TTL,
  });
  jar.set(RT_COOKIE, refresh, {
    httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: REFRESH_DAYS * 86400,
  });
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(AT_COOKIE);
  jar.delete(RT_COOKIE);
}

/* ------------------------------------------------------------------ guards */

export async function currentUser(): Promise<Claims | null> {
  const jar = await cookies();
  return readAccess(jar.get(AT_COOKIE)?.value);
}

export async function requireUser(): Promise<Claims> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue");
  return u;
}

export async function requireAdmin(): Promise<Claims> {
  const u = await requireUser();
  if (u.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Admins only");
  return u;
}

/* ------------------------------------------------------------------ rate limiting */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** In-process limiter. Good enough for one node; swap for Redis when you scale out. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}
