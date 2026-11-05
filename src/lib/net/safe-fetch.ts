import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound request guard for connection tests. Prevents the server being used
 * to reach internal addresses (SSRF): https only, standard port, every resolved
 * address must be public, redirects are never followed, short timeout.
 */
export class UnsafeUrlError extends Error {
  /** "policy": the URL is not allowed. "unreachable": allowed, but the host did not resolve. */
  constructor(
    message: string,
    readonly kind: "policy" | "unreachable" = "policy",
  ) {
    super(message);
  }
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("fe8") ||
    v.startsWith("fe9") ||
    v.startsWith("fea") ||
    v.startsWith("feb")
  )
    return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? isPrivateV4(mapped[1]) : false;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !isPrivateV4(ip);
  if (kind === 6) return !isPrivateV6(ip);
  return false;
}

export async function assertSafeUrl(raw: string, allowedHosts?: string[]): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Enter a valid URL.");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https URLs can be tested.");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Only the standard https port (443) can be tested.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  const host = url.hostname.toLowerCase();
  if (allowedHosts && !allowedHosts.includes(host)) {
    throw new UnsafeUrlError(`Only these hosts can be tested: ${allowedHosts.join(", ")}.`);
  }
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError("That address is not publicly routable.");
    return url;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`The host ${host} could not be resolved (DNS lookup failed).`, "unreachable");
  }
  if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new UnsafeUrlError("That host resolves to a non-public address.");
  }
  return url;
}

export interface ProbeResult {
  ok: boolean;
  http_status: number | null;
  latency_ms: number | null;
  message: string;
}

/** One guarded request; never throws. */
export async function probe(
  url: URL,
  init: { method: "GET" | "POST"; body?: string; timeoutMs?: number },
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: init.method,
      body: init.body,
      headers: {
        "user-agent": "JobSync-ConnectionTest/1.0",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
      cache: "no-store",
    });
    const latency = Date.now() - started;
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        http_status: res.status,
        latency_ms: latency,
        message: `Redirected (HTTP ${res.status}); redirects are not followed.`,
      };
    }
    return {
      ok: res.status < 400,
      http_status: res.status,
      latency_ms: latency,
      message:
        res.status < 400 ? `Reachable: HTTP ${res.status} in ${latency} ms.` : `Responded with HTTP ${res.status}.`,
    };
  } catch (err) {
    const timeout = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";
    return {
      ok: false,
      http_status: null,
      latency_ms: Date.now() - started,
      message: timeout ? "No response before the timeout." : `Could not connect: ${(err as Error).message}.`,
    };
  }
}
