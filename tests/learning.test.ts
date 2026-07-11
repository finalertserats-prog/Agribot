import { describe, it, expect } from "vitest";
import { OutcomeStore } from "../src/learning/outcomes";
import { SkillGovernance } from "../src/learning/governance";
import { Experiment } from "../src/learning/experiments";

describe("OutcomeStore", () => {
  it("returns null until there's enough clear signal", () => {
    const o = new OutcomeStore();
    o.record("f1", "seasonal_tip", "helpful");
    expect(o.qualityRate("seasonal_tip", 10)).toBeNull();
  });

  it("excludes 'unclear' from the quality rate", () => {
    const o = new OutcomeStore();
    for (let i = 0; i < 8; i++) o.record("f", "t", "helpful");
    for (let i = 0; i < 2; i++) o.record("f", "t", "not_helpful");
    for (let i = 0; i < 20; i++) o.record("f", "t", "unclear"); // must not inflate
    expect(o.qualityRate("t", 5)).toBeCloseTo(0.8);
  });
});

describe("SkillGovernance", () => {
  it("a proposal does NOT change the active version until approved", () => {
    const g = new SkillGovernance();
    g.register("tip_prompt", "v1 content");
    const proposal = g.propose("tip_prompt", "v2 content", "analyst");
    expect(g.active("tip_prompt")?.content).toBe("v1 content"); // still v1
    g.approve(proposal.id);
    expect(g.active("tip_prompt")?.content).toBe("v2 content"); // now v2
  });

  it("supports rollback to the previous version", () => {
    const g = new SkillGovernance();
    g.register("p", "v1");
    const prop = g.propose("p", "v2", "a");
    g.approve(prop.id);
    expect(g.active("p")?.content).toBe("v2");
    expect(g.rollback("p")).toBe(true);
    expect(g.active("p")?.content).toBe("v1");
  });

  it("cannot approve a non-pending id", () => {
    const g = new SkillGovernance();
    const v = g.register("p", "v1");
    expect(g.approve(v.id)).toBe(false); // already active, not pending
  });
});

describe("Experiment", () => {
  it("assigns a subject deterministically", () => {
    const e = new Experiment("tone", ["control", "warm"]);
    expect(e.variantFor("f1")).toBe(e.variantFor("f1"));
  });

  it("halts and falls back to control when the guardrail is breached", () => {
    const e = new Experiment("tone", ["control", "warm"], 0.7);
    e.reportGuardrail(0.5); // advice quality dropped below floor
    expect(e.isHalted).toBe(true);
    expect(e.variantFor("anyone")).toBe("control");
  });

  it("stays running while the guardrail holds", () => {
    const e = new Experiment("tone", ["control", "warm"], 0.7);
    e.reportGuardrail(0.8);
    expect(e.isHalted).toBe(false);
  });
});
