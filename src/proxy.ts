import { NextResponse, type NextRequest } from "next/server";

import { getAuthConfig, isDevAuthBypassActive } from "@/lib/auth/config";
import { classifyRoute } from "@/lib/auth/routes";
import { updateSession, withSessionCookies } from "@/lib/supabase/proxy-session";

/**
 * First line of defence: keeps signed-out visitors away from every application
 * page and sensitive API route. This is an optimistic check; every data read
 * also re-verifies the user in the data access layer (src/lib/auth/session.ts)
 * and the database enforces Row Level Security.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const kind = classifyRoute(pathname);

  // Machine APIs authenticate each request themselves (API key / HMAC).
  if (kind === "machine_api" || kind === "public_api") return NextResponse.next();

  const config = getAuthConfig();
  if (!config) {
    if (kind === "public_page" || isDevAuthBypassActive()) return NextResponse.next();
    if (kind === "protected_api") {
      return NextResponse.json(
        { error: "auth_not_configured", message: "Authentication is not configured on this server." },
        { status: 503 },
      );
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  const { response, userId } = await updateSession(request, config);

  if (kind === "public_page") {
    if (userId && pathname === "/login") {
      return withSessionCookies(response, NextResponse.redirect(new URL("/", request.url)));
    }
    return response;
  }

  if (!userId) {
    if (kind === "protected_api") {
      return withSessionCookies(
        response,
        NextResponse.json({ error: "unauthorized", message: "Sign in required." }, { status: 401 }),
      );
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return withSessionCookies(response, NextResponse.redirect(login));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
