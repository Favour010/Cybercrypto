/**
 * Route classification shared by proxy.ts and the auth pages. Pure functions,
 * no Next.js or Supabase imports, so they are unit-tested directly.
 */

/** Pages reachable without a session. */
const PUBLIC_PAGE_PATHS = ["/login", "/setup", "/auth/confirm", "/auth/error"];

/** API routes reachable without a session (no data, no secrets). */
const PUBLIC_API_PATHS = ["/api/health"];

/**
 * Machine-to-machine APIs (external intake, n8n and worker callbacks, Phase 3+).
 * They do not use browser sessions: every handler under these prefixes MUST
 * authenticate the caller itself (API key / HMAC shared secret).
 */
export const MACHINE_API_PREFIXES = ["/api/v1/"];

function matches(pathname: string, paths: string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type RouteKind = "public_page" | "public_api" | "machine_api" | "protected_api" | "protected_page";

export function classifyRoute(pathname: string): RouteKind {
  if (matches(pathname, PUBLIC_PAGE_PATHS)) return "public_page";
  if (matches(pathname, PUBLIC_API_PATHS)) return "public_api";
  if (MACHINE_API_PREFIXES.some((p) => pathname.startsWith(p))) return "machine_api";
  if (pathname === "/api" || pathname.startsWith("/api/")) return "protected_api";
  return "protected_page";
}

/**
 * Only same-origin relative paths are allowed as post-login destinations, so
 * `?next=` can never be used as an open redirect.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "http://jobsync.invalid");
    if (url.origin !== "http://jobsync.invalid") return fallback;
    if (classifyRoute(url.pathname) === "public_page") return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
