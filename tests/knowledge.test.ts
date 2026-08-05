import { describe, it, expect, vi, beforeEach } from "vitest";
import { scrubPii, hasResidualPii, isPersonalOnly, REDACTED } from "../src/lib/knowledge/privacy";

describe("scrubPii — nothing personal may cross between members", () => {
  it("removes Indian mobile numbers in their common written forms", () => {
    for (const n of ["9876543210", "+91 9876543210", "+919876543210", "98765-43210"]) {
      expect(scrubPii(`call me on ${n} please`)).not.toContain("9876");
    }
  });

  it("removes email addresses", () => {
    expect(scrubPii("mail me at grower.raju@example.co.in")).toContain(REDACTED);
  });

  it("removes CTG member IDs", () => {
    expect(scrubPii("my id is CTG-7202-014")).not.toContain("7202");
  });

  it("removes house and plot numbers", () => {
    expect(scrubPii("H.No 12-3-45 Jubilee Hills")).not.toContain("12-3-45");
    expect(scrubPii("Plot no 27, my terrace")).not.toContain("27");
  });

  it("removes the member's own name, case-insensitively", () => {
    const out = scrubPii("Srini Harkara asked about gourds", "Srini Harkara");
    expect(out.toLowerCase()).not.toContain("srini");
    expect(out.toLowerCase()).not.toContain("harkara");
  });

  // A name containing regex metacharacters must not blow up the scrubber —
  // an exception here would abort promotion, not just skip a name.
  it("handles names with regex-special characters", () => {
    expect(() => scrubPii("hello there", "M. D'Souza (Sr.)")).not.toThrow();
  });

  // The horticulture must survive: stripping doses would make the knowledge
  // worthless, which is the failure mode opposite to leaking.
  it("keeps doses, dilutions and cultivar names intact", () => {
    const out = scrubPii("Spray neem oil 5ml per litre on HRMN-99 every 7 days, pH 6.5");
    expect(out).toContain("5ml per litre");
    expect(out).toContain("HRMN-99");
    expect(out).toContain("7 days");
    expect(out).toContain("6.5");
  });
});

describe("hasResidualPii — the final gate before shared storage", () => {
  it("accepts fully generalized knowledge", () => {
    expect(
      hasResidualPii("HRMN-99 is a low-chill apple selection; Hyderabad accumulates under 50 chill hours.")
    ).toBe(false);
  });

  it("rejects text still carrying a phone number", () => {
    expect(hasResidualPii("contact 9876543210 for saplings")).toBe(true);
  });

  it("rejects text still carrying an email", () => {
    expect(hasResidualPii("write to raju@example.com")).toBe(true);
  });

  // These regexes are /g, so a leftover lastIndex from a previous call would
  // make the SECOND check silently pass. That would leak on every other call.
  it("is not corrupted by repeated calls (global-regex lastIndex trap)", () => {
    const leaky = "call 9876543210";
    expect(hasResidualPii(leaky)).toBe(true);
    expect(hasResidualPii(leaky)).toBe(true);
    expect(hasResidualPii(leaky)).toBe(true);
  });
});

describe("isPersonalOnly — filters exchanges nobody else can use", () => {
  it("flags onboarding chatter", () => {
    expect(isPersonalOnly("hi", "Namaste! Nice to meet you. Mee member ID CTG-7202-014.")).toBe(true);
  });

  it("flags photo-specific diagnosis", () => {
    expect(isPersonalOnly("what is this", "In the photo you sent, the lower leaves are yellowing.")).toBe(true);
  });

  it("passes transferable horticultural knowledge", () => {
    expect(
      isPersonalOnly(
        "How do I control leaf miner on tomato?",
        "Leaf miner (Tuta absoluta) is controlled with neem oil at 5ml per litre, sprayed every 7 days."
      )
    ).toBe(false);
  });
});

// ---- promotion gate (mock the LLM) ----
const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("../src/lib/llm", () => ({
  getProvider: () => ({ generateText }),
  withRetry: (f: unknown) => f,
}));

import { evaluateForPromotion, MIN_CONFIDENCE } from "../src/lib/knowledge/promote";

const GOOD_ANSWER =
  "Leaf miner (Tuta absoluta) on tomato is managed organically with neem oil at 5ml per litre of water, sprayed at 7 day intervals in the early morning. ".repeat(
    2
  );

describe("evaluateForPromotion — rejects by default", () => {
  beforeEach(() => vi.clearAllMocks());

  const gateSays = (o: Record<string, unknown>) =>
    generateText.mockResolvedValue(JSON.stringify(o));

  it("promotes a correct, generalizable, high-confidence answer", async () => {
    gateSays({
      generalizable: true,
      correct: true,
      confidence: 0.95,
      topic: "tomato leaf miner",
      knowledge: GOOD_ANSWER,
      reason: "sound",
    });
    const v = await evaluateForPromotion({ question: "leaf miner?", answer: GOOD_ANSWER });
    expect(v.promote).toBe(true);
    expect(v.topic).toBe("tomato leaf miner");
  });

  // The HRMN-99 scenario: fluent, confident, and wrong. It must not spread.
  it("refuses an answer the judge marks factually unsound", async () => {
    gateSays({ generalizable: true, correct: false, confidence: 0.9, knowledge: GOOD_ANSWER });
    const v = await evaluateForPromotion({ question: "HRMN99?", answer: GOOD_ANSWER });
    expect(v.promote).toBe(false);
  });

  it("refuses when confidence is below the bar even if judged correct", async () => {
    gateSays({
      generalizable: true,
      correct: true,
      confidence: MIN_CONFIDENCE - 0.01,
      knowledge: GOOD_ANSWER,
    });
    expect((await evaluateForPromotion({ question: "q", answer: GOOD_ANSWER })).promote).toBe(false);
  });

  it("refuses non-generalizable answers", async () => {
    gateSays({ generalizable: false, correct: true, confidence: 0.99, knowledge: GOOD_ANSWER });
    expect((await evaluateForPromotion({ question: "q", answer: GOOD_ANSWER })).promote).toBe(false);
  });

  // Defence in depth: the generalizer is an LLM and can keep personal details.
  it("refuses when the generalized text still contains PII", async () => {
    gateSays({
      generalizable: true,
      correct: true,
      confidence: 0.99,
      knowledge: `${GOOD_ANSWER} Contact 9876543210 for saplings.`,
    });
    const v = await evaluateForPromotion({ question: "q", answer: GOOD_ANSWER });
    expect(v.promote).toBe(false);
    expect(v.reason).toMatch(/residual PII/i);
  });

  it("fails CLOSED when the judge is unavailable", async () => {
    generateText.mockRejectedValue(new Error("503"));
    const v = await evaluateForPromotion({ question: "q", answer: GOOD_ANSWER });
    expect(v.promote).toBe(false);
  });

  it("fails closed on unparseable judge output", async () => {
    generateText.mockResolvedValue("I think this is fine, promote it!");
    expect((await evaluateForPromotion({ question: "q", answer: GOOD_ANSWER })).promote).toBe(false);
  });

  it("skips the judge entirely for short answers (cost guard)", async () => {
    const v = await evaluateForPromotion({ question: "hi", answer: "Namaste!" });
    expect(v.promote).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("skips the judge for personal/administrative exchanges", async () => {
    await evaluateForPromotion({
      question: "hello",
      answer: `Nice to meet you! ${GOOD_ANSWER}`,
    });
    expect(generateText).not.toHaveBeenCalled();
  });
});
