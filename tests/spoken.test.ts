import { describe, it, expect, vi, beforeEach } from "vitest";

// The spoken rewrite/summary is one LLM call; stub it so these tests are about
// what we ask for and what we do with the answer, not about a vendor.
const generateText = vi.fn<(prompt: string) => Promise<string>>();
vi.mock("../src/lib/llm", () => ({ getProvider: () => ({ generateText }) }));

import { buildSpokenText, stripForSpeech, trimToSentence } from "../src/lib/speech/spoken";
import { config } from "../src/config";

/** The sign-off is fixed text; match on a distinctive fragment of each. */
const HANDOFF_TE = "టెక్స్ట్ మెసేజ్";
const HANDOFF_EN = "full details in the text message below";

const BUDGET = config.speech.maxSpokenChars;

/** A reply comfortably over the budget, so the summarizer path is taken. */
function longReply(): string {
  return (
    "Absolutely possible, Vishnu garu — terrace mango works great in Hyderabad. " +
    "Go only for dwarf grafted varieties like Amrapali or Mallika. " +
    "Spray neem oil 5 ml plus mild soap 1 ml per litre at dusk, repeat every 7 days. "
  ).repeat(20);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stripForSpeech — remove what only makes sense on a screen", () => {
  it("drops emoji rather than letting the voice read them as words", () => {
    expect(stripForSpeech("Namaste 🌱 andi")).not.toMatch(/🌱/);
  });

  it("drops bullet glyphs and bold markers", () => {
    expect(stripForSpeech("- *neem oil* 5 ml")).toBe("neem oil 5 ml");
  });

  it("turns line breaks into spoken pauses instead of running words together", () => {
    expect(stripForSpeech("Step one\nStep two")).toBe("Step one. Step two");
  });
});

describe("trimToSentence — never stop the voice mid-word", () => {
  it("leaves text that already fits untouched", () => {
    expect(trimToSentence("Spray 5 ml per litre.", 100)).toBe("Spray 5 ml per litre.");
  });

  it("cuts back to the last complete sentence", () => {
    const text = "Spray 5 ml per litre. Repeat every seven days. Water at the roots only.";
    expect(trimToSentence(text, 50)).toBe("Spray 5 ml per litre. Repeat every seven days.");
  });

  it("falls back to a word boundary when no sentence ends in range", () => {
    const out = trimToSentence("alpha beta gamma delta epsilon zeta eta theta", 20);
    expect(out).toBe("alpha beta gamma");
    expect(out.endsWith(" ")).toBe(false);
  });

  // Cutting a long answer back to its one early period would lose far more than
  // a word-boundary cut does, so a boundary that early is rejected.
  it("ignores a sentence end that would throw away most of the allowance", () => {
    const text = "Yes. " + "and then a very long unbroken explanation continues onwards ".repeat(3);
    expect(trimToSentence(text, 60)).not.toBe("Yes.");
  });
});

describe("buildSpokenText — a short reply is spoken as-is", () => {
  it("uses the verbatim rewrite prompt, not the summarizer", async () => {
    generateText.mockResolvedValue("మీ tomato లో leaf miner ఉంది. Neem oil 5 ml per litre.");
    await buildSpokenText("mee tomato lo leaf miner undi. Neem oil 5 ml per litre.");

    const prompt = generateText.mock.calls[0][0];
    expect(prompt).toMatch(/Do not add, explain or summarise anything/);
    expect(prompt).not.toMatch(/voice note is the briefing/);
  });

  // Telling someone to read on for details they just heard in full teaches them
  // to ignore the line on the answer where it matters.
  it("adds no sign-off when nothing was left out", async () => {
    generateText.mockResolvedValue("మీ tomato లో leaf miner ఉంది.");
    const out = await buildSpokenText("mee tomato lo leaf miner undi.");

    expect(out.summarized).toBe(false);
    expect(out.text).not.toContain(HANDOFF_TE);
  });

  it("hands the whole reply to the model rather than a prefix of it", async () => {
    generateText.mockResolvedValue("సరే అండి.");
    await buildSpokenText("mee tomato lo leaf miner undi, repeat every 7 days.");
    expect(generateText.mock.calls[0][0]).toContain("repeat every 7 days");
  });
});

describe("buildSpokenText — a long reply is summarized, not truncated", () => {
  // The bug this exists to kill: the voice note used to be the FIRST 900
  // characters of the answer, so it stopped dead in section two and the member
  // heard the varieties but never the dose.
  it("summarizes from the FULL answer, not a truncated prefix of it", async () => {
    generateText.mockResolvedValue("సంక్షిప్త సమాధానం. Neem oil 5 ml per litre.");
    const reply = longReply();
    await buildSpokenText(reply);

    const prompt = generateText.mock.calls[0][0];
    expect(prompt).toMatch(/voice note is the briefing/);
    // The tail of the answer has to be in the prompt, or it cannot be summarized.
    expect(prompt).toContain(reply.slice(-60));
  });

  it("closes with the sign-off pointing at the text below", async () => {
    generateText.mockResolvedValue("సంక్షిప్త సమాధానం. Neem oil 5 ml per litre.");
    const out = await buildSpokenText(longReply());

    expect(out.summarized).toBe(true);
    expect(out.text).toContain(HANDOFF_TE);
    expect(out.text.trim().endsWith("చూసుకోండి.")).toBe(true);
  });

  it("speaks the sign-off in the language the voice note is actually in", async () => {
    generateText.mockResolvedValue("Short English summary. Neem oil 5 ml per litre.");
    const out = await buildSpokenText(longReply());
    expect(out.text).toContain(HANDOFF_EN);
    expect(out.text).not.toContain(HANDOFF_TE);
  });

  it("asks for flowing speech rather than a read-aloud list", async () => {
    generateText.mockResolvedValue("సంక్షిప్త సమాధానం.");
    await buildSpokenText(longReply());
    const prompt = generateText.mock.calls[0][0];
    expect(prompt).toMatch(/never read out numbering, never use bullets/);
    expect(prompt).toMatch(/EXACT quantity, dilution/);
  });
});

describe("buildSpokenText — the budget is enforced here, not hoped for", () => {
  it("trims a model that blows straight past the length it was given", async () => {
    generateText.mockResolvedValue("ఇది ఒక పొడవైన వాక్యం. ".repeat(400));
    const out = await buildSpokenText(longReply());
    expect(out.text.length).toBeLessThanOrEqual(BUDGET);
  });

  it("still signs off when a short reply's rewrite had to be cut", async () => {
    generateText.mockResolvedValue("This sentence keeps going and going. ".repeat(200));
    const out = await buildSpokenText("short question about neem oil");

    expect(out.summarized).toBe(true);
    expect(out.text).toContain(HANDOFF_EN);
  });
});

describe("buildSpokenText — a broken model must not cost the voice note", () => {
  it("falls back to the stripped original when the rewrite throws", async () => {
    generateText.mockRejectedValue(new Error("vendor down"));
    const out = await buildSpokenText("Neem oil 5 ml per litre 🌱, repeat weekly.");

    expect(out.text).toContain("Neem oil 5 ml per litre");
    expect(out.text).not.toMatch(/🌱/);
  });

  it("prefers the stripped original over a degenerate rewrite", async () => {
    generateText.mockResolvedValue("ok");
    const out = await buildSpokenText(
      "Spray neem oil 5 ml per litre at dusk and repeat every seven days without fail."
    );
    expect(out.text).toContain("neem oil 5 ml per litre");
  });

  it("keeps the fallback inside the budget and on a sentence boundary", async () => {
    generateText.mockRejectedValue(new Error("vendor down"));
    const out = await buildSpokenText(longReply());

    expect(out.text.length).toBeLessThanOrEqual(BUDGET);
    expect(out.summarized).toBe(true);
    expect(out.text).toContain(HANDOFF_EN);
  });

  it("returns nothing to speak for an empty reply", async () => {
    const out = await buildSpokenText("   ");
    expect(out.text).toBe("");
    expect(generateText).not.toHaveBeenCalled();
  });
});
