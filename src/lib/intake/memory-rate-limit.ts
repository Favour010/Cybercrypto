/**
 * Small in-process fixed-window limiter. Used only as a cheap first filter for
 * unauthenticated traffic (per IP) before any database work; the authoritative,
 * cross-instance limit is public.consume_rate_limit() in Postgres.
 */
export class MemoryRateLimiter {
  private windows = new Map<string, { start: number; hits: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    const entry = this.windows.get(key);
    if (!entry || entry.start !== start) {
      if (this.windows.size >= this.maxKeys) this.evict(start);
      this.windows.set(key, { start, hits: 1 });
    } else {
      entry.hits += 1;
    }
    const hits = this.windows.get(key)!.hits;
    return {
      allowed: hits <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((start + this.windowMs - now) / 1000)),
    };
  }

  private evict(currentStart: number) {
    for (const [k, v] of this.windows) if (v.start !== currentStart) this.windows.delete(k);
    if (this.windows.size >= this.maxKeys) this.windows.clear();
  }
}
