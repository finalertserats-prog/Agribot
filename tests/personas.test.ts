import { describe, it, expect } from "vitest";
import {
  resolvePersona,
  isInPersonaScope,
  getDefaultPersona,
  DEFAULT_PERSONA_ID,
} from "../src/config/personas";

describe("resolvePersona", () => {
  it("routes a CTG group (by name) to CTG Admn", () => {
    expect(resolvePersona({ groupName: "City of Terrace Garden" }).id).toBe("ctg-admn");
    expect(resolvePersona({ groupName: "CTG Hyderabad Members" }).id).toBe("ctg-admn");
  });

  it("routes a different community by its own group-name pattern", () => {
    expect(resolvePersona({ groupName: "Rose Society Hyderabad" }).id).toBe("rose-society");
  });

  it("is case-insensitive on group name", () => {
    expect(resolvePersona({ groupName: "rose club members" }).id).toBe("rose-society");
  });

  it("falls back to the default persona when nothing matches", () => {
    expect(resolvePersona({ groupName: "Random Cricket Group" }).id).toBe(DEFAULT_PERSONA_ID);
    expect(resolvePersona({}).id).toBe(DEFAULT_PERSONA_ID);
  });
});

describe("isInPersonaScope", () => {
  const ctg = getDefaultPersona();

  it("accepts a clear gardening question (shared base vocabulary)", () => {
    expect(isInPersonaScope(ctg, "How do I grow tomatoes on my terrace?")).toBe(true);
  });

  it("accepts a persona-specific organic keyword", () => {
    expect(isInPersonaScope(ctg, "How much jeevamrutham for my brinjal?")).toBe(true);
  });

  it("rejects off-topic chit-chat", () => {
    expect(isInPersonaScope(ctg, "who won the cricket match yesterday?")).toBe(false);
  });
});

describe("persona registry integrity", () => {
  it("resolves a valid default persona with an ID prefix", () => {
    const p = getDefaultPersona();
    expect(p.id).toBe(DEFAULT_PERSONA_ID);
    expect(p.idPrefix.length).toBeGreaterThan(0);
    expect(p.systemPrompt.length).toBeGreaterThan(0);
  });
});

/**
 * These lock behaviour the CTG persona lost in production on 2026-08-06: it
 * re-introduced itself and re-asked the same closing question on three
 * consecutive messages 80 seconds apart, and answered a Telugu-script question
 * in romanized Telugu.
 */
describe("CTG Admn prompt — continuity and depth contract", () => {
  const prompt = resolvePersona({ groupName: "City of Terrace Garden" }).systemPrompt;

  it("tells the model that history means this is not a first message", () => {
    expect(prompt).toMatch(/Recent conversation history/);
    expect(prompt).toMatch(/NOT a first message/);
  });

  it("forbids re-announcing the member ID on every turn", () => {
    expect(prompt).toMatch(/announced ONCE, ever/);
  });

  it("forbids re-asking a question already asked", () => {
    expect(prompt).toMatch(/NEVER ask again for something you already asked/);
  });

  it("stops a bare greeting from triggering a full growing guide", () => {
    expect(prompt).toMatch(/greeting does not deserve a full growing guide/);
  });

  it("requires mirroring the member's script, not just their language", () => {
    expect(prompt).toMatch(/Telugu script/);
  });

  // Depth is wanted — chunking delivers it. The prompt must not learn to
  // self-truncate to fit a message size.
  it("keeps depth uncapped and tells the model long replies are split for it", () => {
    expect(prompt).toMatch(/there is no line limit/);
    expect(prompt).toMatch(/several consecutive WhatsApp messages/);
    expect(prompt).not.toMatch(/keep .{0,20}under \d+ (characters|chars)/i);
  });
});
