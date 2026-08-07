import { describe, it, expect, vi, beforeEach } from "vitest";

// The spoken rewrite/summary is one LLM call; stub it so these tests are about
// what we ask for and what we do with the answer, not about a vendor.
const generateText = vi.fn<(prompt: string) => Promise<string>>();
vi.mock("../src/lib/llm", () => ({ getProvider: () => ({ generateText }) }));

import {
  buildSpokenText,
  splitInHalf,
  stripForSpeech,
  trimToSentence,
} from "../src/lib/speech/spoken";
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

/**
 * Over budget, with a distinctly-labelled opening and closing so a test can
 * tell which end of the answer actually reached a model.
 */
function distinctSectionReply(): string {
  return [
    "ALPHA-OPENING. Terrace mango works great in Hyderabad.",
    "Go only for dwarf grafted varieties like Amrapali or Mallika. ".repeat(22),
    "Feed NPK 19:19:19 at 5 g per litre monthly through the growth flush. ".repeat(22),
    "OMEGA-CLOSING. Spray neem oil 5 ml per litre at dusk and observe a 7 day pre-harvest interval.",
  ].join("\n\n");
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

  // A written answer is full of headings. Spoken verbatim, "Pruning. Tip prune
  // at one metre." lands as two stubs — which is what made the voice sound
  // robotic even when nothing had been cut.
  it("asks for connected speech, not a document read aloud", async () => {
    generateText.mockResolvedValue("మీ tomato లో leaf miner ఉంది.");
    await buildSpokenText("Pruning. Tip prune at 1 m. IPM. Neem oil 5 ml per litre.");

    const prompt = generateText.mock.calls[0][0];
    expect(prompt).toMatch(/Fold each heading into the sentence it introduces/);
    expect(prompt).toMatch(/Never read out numbering, bullets, dashes or colons/);
    // ...without licensing the model to drop anything on the way.
    expect(prompt).toMatch(/Do not add, explain or summarise anything/);
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
    const reply = distinctSectionReply();
    await buildSpokenText(reply);

    const prompts = generateText.mock.calls.map((c) => c[0]).join("\n");
    expect(prompts).toMatch(/voice note is the briefing/);
    // Both ends of the answer have to reach a model, or they cannot be spoken.
    expect(prompts).toContain("ALPHA-OPENING");
    expect(prompts).toContain("OMEGA-CLOSING");
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

  // Caught live on the VPS: the model summarized front-to-back, ran out of room
  // at section five, and silently dropped the pest doses and the pre-harvest
  // interval sitting at the end — the part a grower most needed to hear.
  it("tells the model to reach the end of the answer rather than stop partway", async () => {
    generateText.mockResolvedValue("సంక్షిప్త సమాధానం.");
    await buildSpokenText(longReply());
    const prompt = generateText.mock.calls[0][0];
    expect(prompt).toMatch(/Reserve room for those before you write a word/);
    expect(prompt).toMatch(/never a dose, an interval or a warning/);
  });
});

describe("buildSpokenText — coverage of the tail is structural, not requested", () => {
  // Asking one pass to cover everything measurably does not work: the model
  // hits the length target, spends it on the opening sections, and stops. The
  // second half gets its own pass so it cannot be crowded out by the first.
  it("summarizes each half of a long answer in its own pass", async () => {
    generateText.mockResolvedValue("సంక్షిప్త సమాధానం.");
    await buildSpokenText(distinctSectionReply());

    expect(generateText).toHaveBeenCalledTimes(2);
    const [firstPass, secondPass] = generateText.mock.calls.map((c) => c[0]);
    expect(firstPass).toContain("ALPHA-OPENING");
    expect(firstPass).not.toContain("OMEGA-CLOSING");
    expect(secondPass).toContain("OMEGA-CLOSING");
    expect(secondPass).not.toContain("ALPHA-OPENING");
  });

  // Two segments spoken back to back must sound like one person still talking.
  it("tells the second pass not to greet or recap", async () => {
    generateText.mockResolvedValue("సంక్షిప్త సమాధానం.");
    await buildSpokenText(distinctSectionReply());

    const secondPass = generateText.mock.calls[1][0];
    expect(secondPass).toMatch(/do NOT greet the listener/);
    expect(secondPass).toMatch(/Continue mid-explanation/);
    expect(generateText.mock.calls[0][0]).toMatch(/do NOT write any closing or sign-off/);
  });

  it("speaks both halves, in order", async () => {
    generateText
      .mockResolvedValueOnce("First half spoken here.")
      .mockResolvedValueOnce("Second half spoken here.");
    const out = await buildSpokenText(distinctSectionReply());

    expect(out.text).toContain("First half spoken here.");
    expect(out.text).toContain("Second half spoken here.");
    expect(out.text.indexOf("First half")).toBeLessThan(out.text.indexOf("Second half"));
  });

  // One vendor hiccup must cost that half's polish, not the whole voice note.
  it("keeps the good half when the other pass fails", async () => {
    generateText
      .mockRejectedValueOnce(new Error("vendor blip"))
      .mockResolvedValueOnce("Second half spoken here.");
    const out = await buildSpokenText(distinctSectionReply());

    expect(out.text).toContain("Second half spoken here.");
    expect(out.text).toContain("ALPHA-OPENING"); // the failed half fell back to the source
  });

  // A single short reply must not pay for two calls.
  it("uses one pass for a reply that fits", async () => {
    generateText.mockResolvedValue("మీ tomato లో leaf miner ఉంది.");
    await buildSpokenText("mee tomato lo leaf miner undi.");
    expect(generateText).toHaveBeenCalledOnce();
  });
});

describe("splitInHalf — neither half may open or close on a fragment", () => {
  it("splits at the sentence boundary nearest the middle", () => {
    expect(splitInHalf("One two three. Four five six.")).toEqual([
      "One two three.",
      "Four five six.",
    ]);
  });

  it("keeps every character across the two halves", () => {
    const text = "Alpha beta. Gamma delta. Epsilon zeta. Eta theta.";
    const [a, b] = splitInHalf(text);
    expect(`${a} ${b}`).toBe(text);
  });

  it("still splits text that has no sentence ends at all", () => {
    const [a, b] = splitInHalf("alpha beta gamma delta");
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
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
