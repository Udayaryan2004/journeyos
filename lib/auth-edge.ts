import { SignJWT, jwtVerify } from "jose";

/**
 * Edge-safe auth primitives: `jose` only, no Node built-ins, no database.
 *
 * middleware.ts runs on the edge runtime, where importing `crypto`, `pg` or
 * `bcryptjs` fails at build time. Anything needing those lives in lib/auth.ts,
 * which only ever runs on the Node runtime.
 */

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me-in-env-local",
);

export const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900); // 15 min
export const AT_COOKIE = "jos_at";
export const RT_COOKIE = "jos_rt";

export type Role = "user" | "admin";

export interface Claims {
  sub: string;
  email: string;
  role: Role;
  name?: string | null;
}

export async function signAccess(c: Claims): Promise<string> {
  return new SignJWT({ email: c.email, role: c.role, name: c.name ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL}s`)
    .sign(SECRET);
}

/** Signature check only. An expired or tampered token reads as signed out. */
export async function readAccess(token?: string): Promise<Claims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      role: (payload.role as Role) ?? "user",
      name: (payload.name as string) ?? null,
    };
  } catch {
    return null;
  }
}
