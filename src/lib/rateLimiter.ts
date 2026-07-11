/**
 * Per-key sliding-window rate limiter. Guards the (quota-limited, paid) Gemini
 * calls so a single chatty user or a group flood can't burn the whole quota.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number = 60_000
  ) {}

  /**
   * Record an attempt for `key`. Returns true if it is allowed (under the
   * limit), false if the key has exhausted its window.
   */
  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.maxPerWindow) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Drop stale keys to bound memory. Safe to call periodically. */
  sweep(now: number = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}
