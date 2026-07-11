import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/lib/rateLimiter";

describe("RateLimiter", () => {
  it("allows attempts up to the limit", () => {
    const rl = new RateLimiter(3, 60_000);
    const results = [0, 0, 0].map(() => rl.allow("user", 1000));
    expect(results).toEqual([true, true, true]);
  });

  it("blocks the attempt that exceeds the limit", () => {
    const rl = new RateLimiter(2, 60_000);
    rl.allow("user", 1000);
    rl.allow("user", 1000);
    expect(rl.allow("user", 1000)).toBe(false);
  });

  it("tracks limits independently per key", () => {
    const rl = new RateLimiter(1, 60_000);
    rl.allow("alice", 1000);
    expect(rl.allow("bob", 1000)).toBe(true);
  });

  it("allows again once the window has passed", () => {
    const rl = new RateLimiter(1, 60_000);
    rl.allow("user", 1000);
    expect(rl.allow("user", 62_000)).toBe(true);
  });

  it("sweep drops keys with no recent hits", () => {
    const rl = new RateLimiter(1, 60_000);
    rl.allow("user", 1000);
    rl.sweep(100_000);
    // After sweep the key is gone, so a fresh attempt is allowed.
    expect(rl.allow("user", 100_001)).toBe(true);
  });
});
