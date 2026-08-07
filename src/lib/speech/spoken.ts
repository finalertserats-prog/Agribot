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
    if (!SENTENCE_END.test(window[i])) continue;
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
- Expand symbols into spoken words where a voice would stumble (a ratio, a per, a percent).
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
function summaryPrompt(budget: number): string {
  return `You are turning a long written gardening answer into a spoken voice note for a Telugu-speaking home gardener who is standing in their garden, listening on a phone. The full written answer is being sent to them as a text message straight afterwards, so the voice note is the briefing, not the document.

Write what should be SAID.

Language and sound:
- Speak the Telugu in TELUGU SCRIPT. The written answer may use English letters for Telugu ("mee tomato lo leaf miner undi") — that must become Telugu script.
- Keep real English horticultural terms in English: cultivar names, "leaf miner", "NPK 19:19:19", "pH 6.5", "drip", units.
- Write flowing, connected speech, the way one experienced grower explains something to another. Full sentences that run into each other naturally.
- Where the answer has steps, keep the ORDER but speak it: "mundu ... , taruvata ... , chivaraga ..." / "first ... , then ... , finally ...". Never say "point one", never read out numbering, never use bullets, dashes, colons or headings.
- Say symbols as words: a ratio, a per, a percent. Never leave ":" or "/" to be read aloud.

What must survive, in this order of priority:
1. What the problem or answer actually is — the diagnosis or the direct answer to what they asked.
2. The immediate action, with the EXACT quantity, dilution and how often to repeat it. Never round a number, never drop a unit, never invent one.
3. Any safety instruction — pre-harvest waiting period, spray timing, anything not to mix, anything to keep away from children or edible parts.
4. Any uncertainty the written answer expressed. If it says "if it is X then do this, if it is Y then do that", keep both. Do not sound more certain than the written answer.

What to leave for the text:
- Nursery names, shop addresses, phone numbers, brand lists, prices.
- Background theory and the "why it works" explanations.
- Long lists of alternatives — name the best one or two and move on.

Length: aim for about ${Math.round(budget * 0.85)} characters and never exceed ${budget}. If it will not fit, cover fewer points properly rather than all of them badly — a half-said dose is worse than an unsaid one.

Do NOT write any closing line about the text message; that is added afterwards. End on a complete sentence.

Reply with ONLY the spoken text.

The written answer:
`;
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
  const prompt = needsSummary ? summaryPrompt(speechBudget) : REWRITE_PROMPT;

  let candidate: string;
  try {
    const out = await getProvider().generateText(prompt + source);
    const cleaned = stripForSpeech(out);
    // A result that collapses to almost nothing means the model refused or
    // returned a preamble instead of the text — prefer the deterministic strip.
    if (cleaned.length < Math.min(20, source.length / 2)) {
      logger.warn(
        { summarize: needsSummary, chars: cleaned.length },
        "[speech] spoken rewrite looked degenerate — using the stripped original"
      );
      candidate = stripped;
    } else {
      candidate = cleaned;
    }
  } catch (err) {
    logger.warn({ err }, "[speech] spoken rewrite failed — using the stripped original");
    candidate = stripped;
  }

  // Every path lands here, including a model that blew straight past the length
  // it was given — the trim is what actually enforces the budget.
  const overran = candidate.length > speechBudget;
  const spoken = trimToSentence(candidate, speechBudget);
  if (!spoken) return { text: "", summarized: false };

  // The sign-off is earned by content the member will NOT hear: either we asked
  // for a summary, or we had to cut one. A faithful short rewrite gets no
  // sign-off — telling someone to read on for details they just heard in full
  // is the kind of small dishonesty that teaches them to ignore the line.
  const summarized = needsSummary || overran;
  const text = summarized ? `${spoken} ${HANDOFF[detectLanguage(spoken)]}` : spoken;

  logger.info(
    { summarized, replyChars: reply.length, spokenChars: text.length, budget },
    "[speech] spoken text prepared"
  );
  return { text, summarized };
}
