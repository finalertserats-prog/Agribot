import { describe, it, expect } from "vitest";
import { SeenCache } from "../src/lib/seen";

describe("SeenCache", () => {
  it("reports a new key as not seen", () => {
    const cache = new SeenCache(10);
    expect(cache.check("a")).toBe(false);
  });

  it("reports a repeated key as seen", () => {
    const cache = new SeenCache(10);
    cache.check("a");
    expect(cache.check("a")).toBe(true);
  });

  it("evicts the oldest key past capacity", () => {
    const cache = new SeenCache(2);
    cache.check("a");
    cache.check("b");
    cache.check("c"); // evicts "a"
    expect(cache.check("a")).toBe(false);
  });

  it("keeps size bounded to capacity", () => {
    const cache = new SeenCache(2);
    cache.check("a");
    cache.check("b");
    cache.check("c");
    expect(cache.size).toBe(2);
  });
});
