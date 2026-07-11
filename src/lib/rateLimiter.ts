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
   * Non-mutating check: would an attempt for `key` be allowed right now?
   * Use this to test several limiters together before consuming any of them.
   */
  wouldAllow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    // Write back the pruned array so stale timestamps don't accumulate between
    // sweeps when a key is peeked far more often than it is consumed.
    if (recent.length > 0) this.hits.set(key, recent);
    else this.hits.delete(key);
    return recent.length < this.maxPerWindow;
  }

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

  /** Clear all recorded hits. Intended for test isolation. */
  reset(): void {
    this.hits.clear();
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
