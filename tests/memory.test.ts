import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Deterministic embedding: map a tag in the text to a fixed unit vector so
// cosine similarity is predictable.
const VECS: Record<string, number[]> = {
  a: [1, 0, 0],
  b: [0, 1, 0],
  c: [0, 0, 1],
};
function vecFor(text: string): number[] {
  for (const k of Object.keys(VECS)) if (text.includes(`#${k}`)) return VECS[k];
  return [0.5, 0.5, 0.5];
}

const { embed } = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: () => ({
      embedContent: (text: string) =>
        Promise.resolve({ embedding: { values: vecFor(text) } }),
    }),
    _embed: embed,
  })),
}));

import fs from "fs";
import { config } from "../src/config";
import { initMemory, storeMemory, queryMemory } from "../src/lib/memory";

beforeAll(() => {
  // Start from a clean vector store so accumulation is predictable.
  const bin = `${config.vectorPath}_${config.llm.provider}_entries.json`;
  if (fs.existsSync(bin)) fs.rmSync(bin);
  initMemory();
});

afterAll(() => {
  const bin = `${config.vectorPath}_${config.llm.provider}_entries.json`;
  if (fs.existsSync(bin)) fs.rmSync(bin);
});

describe("memory — queryMemory", () => {
  it("returns [] (and skips retrieval) when a user has too few memories", async () => {
    await storeMemory("only one #a", "few@wa", "g1");
    const res = await queryMemory("#a query", "few@wa");
    expect(res).toEqual([]); // 1 < memoryQueryMinEntries
  });

  it("retrieves and ranks a user's own memories by similarity", async () => {
    await storeMemory("note about topic #a", "userX", "g1");
    await storeMemory("note about topic #b", "userX", "g1");
    await storeMemory("someone else #a", "userY", "g1"); // different user

    const res = await queryMemory("#a", "userX", 2);
    expect(res.length).toBeGreaterThan(0);
    // Best match is the #a note; the other user's memory must not appear.
    expect(res[0]).toContain("#a");
    expect(res.join("|")).not.toContain("someone else");
  });

  it("caps results to the requested limit", async () => {
    await storeMemory("m1 #a", "capU", "g1");
    await storeMemory("m2 #b", "capU", "g1");
    await storeMemory("m3 #c", "capU", "g1");
    const res = await queryMemory("#a", "capU", 2);
    expect(res.length).toBeLessThanOrEqual(2);
  });
});
