import { NextResponse, type NextRequest } from "next/server";
import { readAccess } from "@/lib/auth-edge";

/**
 * Edge-safe route guard (Next 16 renamed this convention from `middleware`).
 *
 * JWT signature only — no database. Anything needing `pg`, `bcryptjs` or
 * Node's `crypto` lives in lib/auth.ts and runs on the Node runtime.
 */

const PROTECTED = ["/dashboard", "/trips", "/settings", "/profile"];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const claims = await readAccess(req.cookies.get("jos_at")?.value);

  if (pathname.startsWith("/admin")) {
    if (claims?.role !== "admin") {
      const url = new URL("/login", req.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/")) && !claims) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // already signed in -- no reason to show the auth screens
  if ((pathname === "/login" || pathname === "/signup") && claims) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/trips/:path*",
    "/settings/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/login",
    "/signup",
  ],
};
