/**
 * Intake API keys: `jsk_<prefix>_<secret>`.
 *   prefix  10 lowercase base36 chars — stored in clear, used to find the key
 *   secret  32 base64url chars (192 bits) — never stored; only SHA-256 of the
 *           whole key is kept, compared in constant time.
 * High-entropy random keys do not need a slow password hash.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PATTERN = /^jsk_([a-z0-9]{10})_([A-Za-z0-9_-]{32})$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(10);
  const prefix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  const secret = randomBytes(24).toString("base64url"); // 32 chars
  const key = `jsk_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

/** Extract the key from `Authorization: Bearer <key>` or `X-API-Key: <key>`. */
export function readApiKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    return m ? m[1] : null;
  }
  return headers.get("x-api-key")?.trim() || null;
}

export function parseApiKey(key: string): { prefix: string } | null {
  const m = KEY_PATTERN.exec(key);
  return m ? { prefix: m[1] } : null;
}

export function verifyApiKey(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Display form for admins: never the secret. */
export function maskApiKey(prefix: string): string {
  return `jsk_${prefix}_••••••••`;
}
