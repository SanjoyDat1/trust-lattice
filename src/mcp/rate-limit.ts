/** Simple sliding-window rate limiter for authenticated MCP writes. */

const hits = new Map<string, number[]>();

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Allow at most `limit` events per `windowMs` for `key`.
 * Defaults: 60 writes / minute.
 * Keys with no recent hits are evicted.
 */
export function assertWriteRateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000,
  nowMs = Date.now(),
): void {
  const prior = hits.get(key) ?? [];
  const recent = prior.filter((t) => nowMs - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    throw new RateLimitError("Rate limit exceeded for trust-lattice writes");
  }
  recent.push(nowMs);
  hits.set(key, recent);

  // Evict idle buckets so rotating keys cannot grow the map unboundedly.
  for (const [k, times] of hits) {
    if (k === key) continue;
    const alive = times.filter((t) => nowMs - t < windowMs);
    if (alive.length === 0) {
      hits.delete(k);
    } else {
      hits.set(k, alive);
    }
  }
}

/** Test helper. */
export function clearWriteRateLimits(): void {
  hits.clear();
}
