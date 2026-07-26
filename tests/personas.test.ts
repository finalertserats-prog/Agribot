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
