import { config } from "../../config";
import { getProvider } from "../llm";
import { logger } from "../logger";
import { detectLanguage, type SpokenLanguage } from "./types";

/**
 * Turn a written WhatsApp reply into something worth *hearing*.
 *
 * Two problems have to be solved before a reply can be spoken.
 *
 * Script: the persona writes Telugu in LATIN letters ("Namaste andi, mee tomato
 * lo leaf miner undi"). No TTS engine handles that — a Telugu voice tries to
 * read English letters, an English voice reads Telugu words as English, and
 * either way the member hears gibberish. So the reply is re-rendered as it
 * should be SPOKEN: Telugu in Telugu script, English terms left in English.
 *
 * Length: a full CTG answer runs several thousand characters. It used to be
 * handled by slicing off the first 900 and speaking those, which is why voice
 * notes stopped dead in the middle of section two — the member heard the
 * varieties and never the dose. A voice note is a SUMMARY of the answer, so it
 * is summarized for the ear, and the text that follows carries everything.
 */

/** Sentence enders across the scripts CTG actually gets, plus the Indic danda. */
const SENTENCE_END = /[.!?।॥]/;

/**
 * Is position `i` a real sentence end, or a full stop inside an abbreviation?
 *
 * Replies are full of the second kind — "మి.లీ" (millilitre), "6.5", "19:19:19"
 * — and treating one as a boundary cuts the voice note mid-word. A genuine
 * sentence end is followed by whitespace or nothing at all. Caught live: a
 * summary was trimmed to "...neem oil 5 మి.లీ plus mild soap 1 మి." because the
 * dot inside the unit read as the end of a sentence.
 */
function isSentenceEnd(text: string, i: number): boolean {
  if (!SENTENCE_END.test(text[i])) return false;
  const next = text[i + 1];
  return next === undefined || /\s/.test(next);
}

/**
 * Don't hand the summarizer an unbounded prompt. Real answers top out around
 * 6k characters; past this something has gone wrong upstream and there is no
 * value in paying to summarize it.
 */
const MAX_SUMMARY_INPUT_CHARS = 20_000;

/**
 * The sign-off, spoken in the language the voice note is actually in. Fixed
 * text rather than something the model is asked to produce: this line is the
 * whole reason the member knows to scroll down, so it cannot be left to prompt
 * obedience. The model is explicitly told NOT to write its own.
 */
const HANDOFF: Record<SpokenLanguage, string> = {
  te: "పూర్తి వివరాలు అన్నీ కింద టెక్స్ట్ మెసేజ్‌లో పంపుతున్నాను, దయచేసి దాన్ని చూసుకోండి.",
  hi: "पूरी जानकारी नीचे टेक्स्ट मैसेज में भेज रहा हूँ, कृपया उसे ज़रूर देखें।",
  en: "I am sending you the full details in the text message below, please go through it.",
};

/** Strip screen-only furniture that a voice would otherwise read out loud. */
export function stripForSpeech(text: string): string {
  return text
    // Emoji: "🌱" read aloud becomes "seedling", mid-sentence.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, "")
    .replace(/\*+([^*]+)\*+/g, "$1")   // *bold* / **bold** markers
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/`+/g, "")
    .replace(/^\s*[-•]\s*/gm, "")      // bullet glyphs
    .replace(/\n{2,}/g, ". ")          // paragraph breaks → a spoken pause
    .replace(/\n/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/(\.\s*){2,}/g, ". ")     // collapse the ". . ." the joins create
    .trim();
}

/**
 * Cut to `limit` at a sentence boundary rather than mid-word.
 *
 * Every path here can overshoot — a model ignores a length instruction, a
 * rewrite comes back longer than its input — and a voice note that stops
 * halfway through "spray five ml per" is worse than one that stops a sentence
 * early. Falls back to a word boundary, then to a hard cut, when the text has
 * no sentence end to fall back to.
 */
export function trimToSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const window = text.slice(0, limit);
  for (let i = window.length - 1; i >= 0; i--) {
    if (!isSentenceEnd(text, i)) continue;
    // Only accept a boundary that leaves a substantial clip — cutting a long
    // answer back to its first sentence because that is the only period in
    // range would lose more than a rough word-boundary cut does.
    if (i + 1 >= limit * 0.5) return window.slice(0, i + 1).trim();
    break;
  }
  const lastSpace = window.lastIndexOf(" ");
  return (lastSpace > limit * 0.5 ? window.slice(0, lastSpace) : window).trim();
}

const REWRITE_PROMPT = `Rewrite the following WhatsApp reply so it can be READ ALOUD by a text-to-speech voice for a Telugu-speaking gardener. Keep everything it says — this is a change of form, not of content.

Language and content:
- If the reply is Telugu written in English letters (e.g. "mee tomato lo leaf miner undi"), rewrite that Telugu in TELUGU SCRIPT.
- Keep genuine English technical terms in English (cultivar names, "leaf miner", "NPK 19:19:19", "pH 6.5", units).
- Keep every number, dose, dilution and interval exactly as given. Do not round, drop or invent any figure.
- Do not add, explain or summarise anything.

Make it sound like a person talking, not a document being read out:
- Written answers are full of headings and numbered sections. Spoken, "Pruning. Tip prune at one metre." lands as two stubs. Fold each heading into the sentence it introduces — "pruning విషయానికి వస్తే, ఒక మీటర్ దగ్గర tip prune చేయండి" / "for pruning, tip prune at one metre".
- Join the steps into connected speech with ordinals and connectives: "mundu ... , taruvata ... , chivaraga ..." / "first ... , then ... , after that ...". Never read out numbering, bullets, dashes or colons.
- Say symbols the way a person says them out loud, never by naming the symbol. "NPK 19:19:19" is spoken "NPK nineteen nineteen nineteen"; "5 g/L" is "five grams per litre"; "40%" is "forty percent"; "6-8 inches" is "six to eight inches". Never say the words "colon", "slash" or "a ratio".
- Remove emoji, asterisks, bullet characters and any other on-screen formatting.

Reply with ONLY the rewritten text.

Reply to rewrite:
`;

/**
 * The summarizer. Written as a brief to a person, not a list of constraints,
 * because the failure mode that matters is not "too long" — it is a summary
 * that sounds like a summary: clipped, listy, and missing the one number the
 * member needed. What must survive is spelled out explicitly rather than left
 * to the model's sense of importance.
 */
type Part = "whole" | "first" | "second";

/** What the model needs to know about where its slice sits in the answer. */
const PART_BRIEF: Record<Part, string> = {
  whole: "Below is the whole written answer.",
  first:
    "Below is the FIRST HALF of a longer written answer. Another voice note segment covers the second half and will be spoken immediately after yours, so open the way the answer opens, and do NOT write any closing or sign-off — your text runs straight into the next part.",
  second:
    "Below is the SECOND HALF of a longer written answer. The first half has already been spoken, so do NOT greet the listener, do NOT re-introduce the topic and do NOT recap what came before. Continue mid-explanation, as the same person still talking. Do not write a closing line about the text message either; that is added afterwards.",
};

function summaryPrompt(budget: number, part: Part): string {
  return `You are turning a written gardening answer into a spoken voice note for a Telugu-speaking home gardener who is standing in their garden, listening on a phone. The full written answer is being sent to them as a text message straight afterwards, so the voice note is the briefing, not the document.

${PART_BRIEF[part]}

Write what should be SAID.

Language and sound:
- Speak the Telugu in TELUGU SCRIPT. The written answer may use English letters for Telugu ("mee tomato lo leaf miner undi") — that must become Telugu script.
- Keep real English horticultural terms in English: cultivar names, "leaf miner", "NPK 19:19:19", "pH 6.5", "drip", units.
- Write flowing, connected speech, the way one experienced grower explains something to another. Full sentences that run into each other naturally.
- Where the answer has steps, keep the ORDER but speak it: "mundu ... , taruvata ... , chivaraga ..." / "first ... , then ... , finally ...". Never say "point one", never read out numbering, never use bullets, dashes, colons or headings.
- Say symbols the way a person says them out loud, never by naming the symbol. "NPK 19:19:19" is spoken "NPK nineteen nineteen nineteen"; "5 g/L" is "five grams per litre"; "40%" is "forty percent". Never say the words "colon", "slash" or "a ratio".

What must survive, in this order of priority:
1. What the problem or answer actually is — the diagnosis or the direct answer to what they asked.
2. The immediate action, with the EXACT quantity, dilution and how often to repeat it. Never round a number, never drop a unit, never invent one.
3. Any safety instruction — pre-harvest waiting period, spray timing, anything not to mix, anything to keep away from children or edible parts.
4. Any uncertainty the written answer expressed. If it says "if it is X then do this, if it is Y then do that", keep both. Do not sound more certain than the written answer.

What to leave for the text:
- Nursery names, shop addresses, phone numbers, brand lists, prices.
- Background theory and the "why it works" explanations.
- Long lists of alternatives — name the best one or two and move on.

How to allocate your length — follow this literally, because getting it wrong is the main way this task fails:
- You have about ${Math.round(budget * 0.85)} characters in total and must never exceed ${budget}. That is not enough for every section at full depth, so allocate deliberately instead of writing until you run out.
- FIRST read the whole answer to the end and find the parts that tell the listener what to DO: doses, dilutions, spray timings, repeat intervals, feeding rates, and any safety or pre-harvest warning. In a long answer these usually sit in the LAST sections. Reserve room for those before you write a word, and give their numbers exactly.
- THEN spend what is left on the earlier descriptive sections — variety names, container size, soil mix ratios — at one short clause each. These are reference material; the member can read them.
- Finally deliver it all in the answer's own order so it still flows as one explanation.

Left to itself a summary explains the opening sections beautifully, runs out of room in the middle and simply stops, so the doses and the safety warnings at the end are never spoken — and those are the part the listener most needed. If something has to go, drop a variety name or a soil percentage, never a dose, an interval or a warning.

Do NOT write any closing line about the text message; that is added afterwards. End on a complete sentence.

Reply with ONLY the spoken text.

The written answer:
`;
}

/**
 * Split the answer near its middle, preferring a paragraph seam and falling
 * back to a sentence. Paragraph breaks are already "." by the time
 * stripForSpeech has run, so this works on sentence boundaries either way.
 */
export function splitInHalf(text: string): [string, string] {
  const mid = Math.floor(text.length / 2);
  // Walk outwards from the midpoint for the nearest sentence end, so neither
  // half opens or closes on a fragment.
  for (let offset = 0; offset < text.length / 2; offset++) {
    for (const i of [mid - offset, mid + offset]) {
      if (i > 0 && i < text.length - 1 && isSentenceEnd(text, i)) {
        return [text.slice(0, i + 1).trim(), text.slice(i + 1).trim()];
      }
    }
  }
  return [text.slice(0, mid).trim(), text.slice(mid).trim()];
}

/**
 * One model pass, with the deterministic strip as the floor.
 *
 * `fallback` is what to use when the model refuses, errors, or hands back a
 * preamble instead of the text — never nothing, because this sits on the path
 * to a member who is already waiting.
 */
async function runPass(prompt: string, source: string, fallback: string): Promise<string> {
  try {
    const cleaned = stripForSpeech(await getProvider().generateText(prompt + source));
    if (cleaned.length < Math.min(20, source.length / 2)) {
      logger.warn(
        { chars: cleaned.length },
        "[speech] spoken pass looked degenerate — using the stripped original"
      );
      return fallback;
    }
    return cleaned;
  } catch (err) {
    logger.warn({ err }, "[speech] spoken pass failed — using the stripped original");
    return fallback;
  }
}

/**
 * Summarize the answer in two halves, concurrently, and join them.
 *
 * One pass over the whole answer does not work, and the reason is not length.
 * Measured on the VPS (2026-08-07): given an eight-section answer the model
 * hits the character target almost exactly but spends it on sections one to
 * seven, then writes "finally, IPM" and stops — leaving the neem oil dose and
 * the pre-harvest interval unsaid. `finish_reason` is "stop", so nothing is
 * being truncated; it simply under-serves the tail. Restating the priority,
 * demanding per-section beats and raising the budget all failed to change it.
 *
 * Giving each half its own pass makes coverage structural rather than something
 * we ask for: the second half cannot be crowded out by the first, because the
 * first is not in the room. The two calls run concurrently, so this costs an
 * API call but no extra waiting.
 */
async function summarizeInHalves(source: string, speechBudget: number): Promise<string> {
  const [first, second] = splitInHalf(source);
  // No seam worth splitting on (a single blob) — one pass is all there is.
  if (!second) return runPass(summaryPrompt(speechBudget, "whole"), first, source);

  const half = Math.floor(speechBudget / 2);
  const [a, b] = await Promise.all([
    runPass(summaryPrompt(half, "first"), first, first),
    runPass(summaryPrompt(half, "second"), second, second),
  ]);

  // Trim the opening first, then hand the SECOND half everything that is left
  // rather than a fixed half. The tail carries the doses and the safety
  // warnings, so it is the last thing that should pay for the opening running
  // long — and the opening reliably does run long.
  const opening = trimToSentence(a, half);
  const closing = trimToSentence(b, speechBudget - opening.length - 1);
  return `${opening} ${closing}`.trim();
}

export interface SpokenResult {
  /** The text to hand to TTS. Empty when there is nothing worth speaking. */
  text: string;
  /** True when content was compressed — i.e. the text reply carries more. */
  summarized: boolean;
}

/**
 * Produce the text to hand to TTS, plus whether it is a summary.
 *
 * Never throws and never returns a mid-sentence fragment: this runs on the way
 * to a member who has already waited, and a degraded voice note beats none.
 * When the model fails, falls back to as much of the deterministically-stripped
 * original as fits — trimmed at a sentence, and still flagged as a summary so
 * the member is told the rest is below.
 */
export async function buildSpokenText(reply: string): Promise<SpokenResult> {
  const budget = config.speech.maxSpokenChars;
  const stripped = stripForSpeech(reply);
  if (!stripped) return { text: "", summarized: false };

  // Reserve room for the sign-off so appending it can't push us over the
  // vendor's ceiling or clip the last sentence we just carefully preserved.
  const handoffRoom = Math.max(...Object.values(HANDOFF).map((h) => h.length)) + 1;
  const speechBudget = budget - handoffRoom;

  const needsSummary = stripped.length > budget;
  // Front-truncating the summarizer's input would quietly drop whatever safety
  // note or dose sits at the end of the answer, so if this ever fires it needs
  // to be visible rather than inferred from a member's confusion later.
  if (stripped.length > MAX_SUMMARY_INPUT_CHARS) {
    logger.warn(
      { chars: stripped.length, limit: MAX_SUMMARY_INPUT_CHARS },
      "[speech] answer too long to summarize whole — the tail will not be spoken"
    );
  }
  const source = needsSummary ? stripped.slice(0, MAX_SUMMARY_INPUT_CHARS) : stripped;

  const candidate = needsSummary
    ? await summarizeInHalves(source, speechBudget)
    : await runPass(REWRITE_PROMPT, source, source);

  // Every path lands here, including a model that blew straight past the length
  // it was given — the trim is what actually enforces the budget.
  const overran = candidate.length > speechBudget;
  const spoken = trimToSentence(candidate, speechBudget);
  if (!spoken) return { text: "", summarized: false };

  // Always sign off, whether or not anything was compressed. The voice note is
  // sent BEFORE the text, so this line is not really "there is more" — it is
  // "keep reading, the written answer is landing underneath". That is true on
  // every turn, and it is the thing that connects the two messages into one
  // reply instead of two. It was briefly conditional on having summarized, and
  // once the budget went up to the ceiling most answers stopped summarizing, so
  // the line all but disappeared from exactly the flow it exists to serve.
  const summarized = needsSummary || overran;
  const text = `${spoken} ${HANDOFF[detectLanguage(spoken)]}`;

  logger.info(
    { summarized, replyChars: reply.length, spokenChars: text.length, budget },
    "[speech] spoken text prepared"
  );
  return { text, summarized };
}
