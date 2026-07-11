import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Google SDK so initGemini() builds a controllable model.
const { genContent, embed } = vi.hoisted(() => ({
  genContent: vi.fn(),
  embed: vi.fn(),
}));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: () => ({ generateContent: genContent, embedContent: embed }),
  })),
}));

import {
  initGemini,
  withRetry,
  isFarmingTopic,
  extractProfile,
} from "../src/lib/gemini";

beforeEach(() => {
  vi.clearAllMocks();
  initGemini();
});

describe("withRetry", () => {
  it("retries on a 429 and eventually succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValue("ok");
    const p = withRetry(fn);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not retry a non-rate-limit error — throws immediately", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("invalid request"));
    await expect(withRetry(fn)).rejects.toThrow("invalid request");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("isFarmingTopic", () => {
  it("returns true for a clear yes", async () => {
    genContent.mockResolvedValue({ response: { text: () => "yes" } });
    expect(await isFarmingTopic("my tomatoes are wilting")).toBe(true);
  });

  it("returns false for a clear no", async () => {
    genContent.mockResolvedValue({ response: { text: () => "no" } });
    expect(await isFarmingTopic("who won the match")).toBe(false);
  });

  it("fails OPEN (returns true) when the model errors", async () => {
    genContent.mockRejectedValue(new Error("model unavailable"));
    expect(await isFarmingTopic("some question")).toBe(true);
  });
});

describe("extractProfile", () => {
  it("parses JSON returned by the model", async () => {
    genContent.mockResolvedValue({
      response: { text: () => 'here: {"plants":"okra","issues":"","location":"Pune"}' },
    });
    const p = await extractProfile("I grow okra in Pune");
    expect(p.plants).toBe("okra");
    expect(p.location).toBe("Pune");
  });

  it("returns an empty profile when the model returns no JSON", async () => {
    genContent.mockResolvedValue({ response: { text: () => "sorry, not sure" } });
    expect(await extractProfile("hello there friend")).toEqual({
      plants: "",
      issues: "",
      location: "",
    });
  });

  it("returns an empty profile (does not throw) on model error", async () => {
    genContent.mockRejectedValue(new Error("boom"));
    expect(await extractProfile("some long enough message")).toEqual({
      plants: "",
      issues: "",
      location: "",
    });
  });
});
