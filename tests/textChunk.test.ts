import { describe, it, expect } from "vitest";
import { splitForWhatsApp, WHATSAPP_TEXT_LIMIT, SAFE_CHUNK_LIMIT } from "../src/lib/textChunk";

/**
 * Regression cover for the failure that lost interaction 79: a 5252-char
 * tomato answer was rejected whole by the Cloud API (4096 cap) and the member
 * received nothing at all.
 */
describe("splitForWhatsApp", () => {
  it("leaves a reply that already fits as a single message", () => {
    expect(splitForWhatsApp("Neem oil 5ml per litre.")).toEqual(["Neem oil 5ml per litre."]);
  });

  it("never emits a chunk over the limit", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Line ${i} about tomato spacing.`).join("\n");
    for (const chunk of splitForWhatsApp(text)) {
      expect(chunk.length).toBeLessThanOrEqual(SAFE_CHUNK_LIMIT);
    }
  });

  it("stays under WhatsApp's real cap, with margin", () => {
    expect(SAFE_CHUNK_LIMIT).toBeLessThan(WHATSAPP_TEXT_LIMIT);
  });

  // Losslessness is the whole point: a member must not silently lose a dose
  // rate because it fell on a chunk boundary.
  it("preserves every character across the split", () => {
    const text = Array.from({ length: 300 }, (_, i) => `Step ${i}: neem cake 50 g.`).join("\n");
    expect(splitForWhatsApp(text).join("\n")).toBe(text);
  });

  it("prefers paragraph boundaries so each message reads as a whole thought", () => {
    const para = "x".repeat(1500);
    const chunks = splitForWhatsApp([para, para, para].join("\n\n"), 3200);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe([para, para].join("\n\n"));
    expect(chunks[1]).toBe(para);
  });

  it("falls back to line breaks when a paragraph alone is too long", () => {
    const line = "y".repeat(900);
    const chunks = splitForWhatsApp(Array.from({ length: 5 }, () => line).join("\n"), 2000);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join("\n").split("\n")).toHaveLength(5);
  });

  it("breaks between words rather than mid-word when one line is oversized", () => {
    const chunks = splitForWhatsApp(Array.from({ length: 200 }, () => "spacing").join(" "), 100);
    // Every token in every chunk is a whole word — no partial "spacin"/"pacing".
    for (const chunk of chunks) {
      expect(chunk.split(" ").every((w) => w === "spacing")).toBe(true);
    }
    expect(chunks.join(" ").split(" ")).toHaveLength(200);
  });

  // A pasted URL or an unbroken Telugu string has no split point at all; a
  // hard slice is still better than a message that never arrives.
  it("hard-slices a single token that cannot be broken any other way", () => {
    const chunks = splitForWhatsApp("z".repeat(250), 100);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.join("")).toBe("z".repeat(250));
  });

  it("drops nothing when the reply is empty or blank", () => {
    expect(splitForWhatsApp("")).toEqual([]);
    expect(splitForWhatsApp("   ")).toEqual([]);
  });

  // The real answer that was lost, at its real size.
  it("splits the 5252-char answer that WhatsApp rejected into deliverable parts", () => {
    const realistic = Array.from(
      { length: 120 },
      (_, i) => `${i}) Neem cake 50-75 g, rock phosphate 25-40 g per 15-20 L pot.`
    ).join("\n");
    expect(realistic.length).toBeGreaterThan(WHATSAPP_TEXT_LIMIT);
    const chunks = splitForWhatsApp(realistic);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= SAFE_CHUNK_LIMIT)).toBe(true);
    expect(chunks.join("\n")).toBe(realistic);
  });
});
