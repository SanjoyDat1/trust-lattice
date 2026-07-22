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
}

/** Test helper. */
export function clearWriteRateLimits(): void {
  hits.clear();
}
