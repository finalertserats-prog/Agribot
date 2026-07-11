import { describe, it, expect } from "vitest";
import type { proto } from "@whiskeysockets/baileys";
import {
  isFarmingRelated,
  extractTextFromMessage,
  escapeRegExp,
} from "../src/lib/domain";

describe("escapeRegExp", () => {
  it("escapes regex metacharacters so a trigger is matched literally", () => {
    const escaped = escapeRegExp("a.b+c");
    expect(new RegExp(escaped).test("a.b+c")).toBe(true);
    expect(new RegExp(escaped).test("axbxxc")).toBe(false);
  });

  it("does not throw when building a regex from bracket characters", () => {
    expect(() => new RegExp(escapeRegExp("bot[("))).not.toThrow();
  });
});

describe("isFarmingRelated", () => {
  it("returns true for a clear farming question", () => {
    expect(isFarmingRelated("How much fertilizer for my tomato plants?")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isFarmingRelated("My SOIL is too dry")).toBe(true);
  });

  it("returns false for an unrelated message", () => {
    expect(isFarmingRelated("What time is the football match tonight?")).toBe(false);
  });

  it("does not false-match short keywords inside unrelated words", () => {
    // "phone" contains "ph", "graph" contains no boundary — must not match.
    expect(isFarmingRelated("Can you call my phone about the graph?")).toBe(false);
  });

  it("matches a short keyword when it stands as a whole word", () => {
    expect(isFarmingRelated("what is the ideal ph for this bed?")).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(isFarmingRelated("")).toBe(false);
  });
});

describe("extractTextFromMessage", () => {
  const wrap = (message: proto.IMessage | null | undefined): proto.IWebMessageInfo =>
    ({ message } as proto.IWebMessageInfo);

  it("reads a plain conversation message", () => {
    expect(extractTextFromMessage(wrap({ conversation: "hello" }))).toBe("hello");
  });

  it("reads extended text", () => {
    expect(
      extractTextFromMessage(wrap({ extendedTextMessage: { text: "extended" } }))
    ).toBe("extended");
  });

  it("reads an image caption", () => {
    expect(
      extractTextFromMessage(wrap({ imageMessage: { caption: "my plant" } }))
    ).toBe("my plant");
  });

  it("returns empty string when there is no message body", () => {
    expect(extractTextFromMessage(wrap(null))).toBe("");
  });
});
