import { describe, expect, it } from "vitest";

import { generateApiKey, hashApiKey, maskApiKey, parseApiKey, readApiKey, verifyApiKey } from "@/lib/intake/api-keys";
import { MemoryRateLimiter } from "@/lib/intake/memory-rate-limit";

describe("API keys", () => {
  it("generates unique, parseable keys whose hash verifies", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.key).toMatch(/^jsk_[a-z0-9]{10}_[A-Za-z0-9_-]{32}$/);
    expect(parseApiKey(a.key)).toEqual({ prefix: a.prefix });
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(verifyApiKey(a.key, a.hash)).toBe(true);
    expect(verifyApiKey(b.key, a.hash)).toBe(false);
    expect(verifyApiKey(a.key, "not-hex")).toBe(false);
  });

  it("reads Bearer or X-API-Key headers", () => {
    expect(readApiKey(new Headers({ authorization: "Bearer jsk_x" }))).toBe("jsk_x");
    expect(readApiKey(new Headers({ "x-api-key": " jsk_y " }))).toBe("jsk_y");
    expect(readApiKey(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(readApiKey(new Headers())).toBeNull();
  });

  it("rejects malformed keys and never displays the secret", () => {
    expect(parseApiKey("jsk_short_secret")).toBeNull();
    expect(maskApiKey("abcdefghij")).toBe("jsk_abcdefghij_••••••••");
  });
});

describe("MemoryRateLimiter", () => {
  it("allows up to the limit per window, then resets", () => {
    const rl = new MemoryRateLimiter(2, 60_000);
    const t = 1_000_000_020_000;
    expect(rl.consume("ip", t).allowed).toBe(true);
    expect(rl.consume("ip", t).allowed).toBe(true);
    const blocked = rl.consume("ip", t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rl.consume("other", t).allowed).toBe(true);
    expect(rl.consume("ip", t + 60_000).allowed).toBe(true);
  });

  it("bounds its memory", () => {
    const rl = new MemoryRateLimiter(1, 60_000, 3);
    for (let i = 0; i < 10; i++) rl.consume(`k${i}`, 0);
    expect(rl.consume("k9", 0).allowed).toBe(false);
  });
});
