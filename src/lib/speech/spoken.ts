import { getProvider } from "../llm";
import { logger } from "../logger";

/**
 * Turn a written WhatsApp reply into something worth *hearing*.
 *
 * The persona writes Telugu in LATIN script ("Namaste andi, mee tomato lo leaf
 * miner undi"). No TTS engine handles that well: a Telugu voice tries to read
 * English letters, an English voice reads Telugu words as English. Either way
 * the member hears gibberish. So before synthesis we ask the model to re-render
 * the reply as it should be SPOKEN — Telugu in Telugu script, English terms
 * left in English — and to drop the things that only make sense on screen.
 */

/**
 * Keep voice notes short. A grower listening on a phone in a garden will not
 * sit through four minutes of audio, and the text reply carries the full detail
 * anyway — the voice note is the summary, not a substitute.
 */
const MAX_SPOKEN_CHARS = 900;

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

const PROMPT = `Rewrite the following WhatsApp reply so it can be READ ALOUD by a text-to-speech voice for a Telugu-speaking gardener.

Rules:
- If the reply is Telugu written in English letters (e.g. "mee tomato lo leaf miner undi"), rewrite that Telugu in TELUGU SCRIPT.
- Keep genuine English technical terms in English (cultivar names, "leaf miner", "NPK 19:19:19", "pH 6.5", units).
- Keep every number, dose, dilution and interval exactly as given. Do not round, drop or invent any figure.
- Remove emoji, asterisks, bullet characters and any other on-screen formatting.
- Expand symbols into spoken words where a voice would stumble (":" in a ratio, "/", "%").
- Do not add, explain or summarise anything. Same content, spoken form.
- Reply with ONLY the rewritten text.

Reply to rewrite:
`;

/**
 * Produce the text to hand to TTS.
 *
 * Falls back to a locally-stripped version of the original when the rewrite
 * fails or comes back suspiciously empty — a slightly mispronounced voice note
 * still beats no voice note, and this path must never fail the reply.
 */
export async function toSpokenText(reply: string): Promise<string> {
  const stripped = stripForSpeech(reply);
  const source = stripped.length > MAX_SPOKEN_CHARS ? stripped.slice(0, MAX_SPOKEN_CHARS) : stripped;
  if (!source) return "";

  try {
    const out = await getProvider().generateText(PROMPT + source);
    const cleaned = stripForSpeech(out);
    // A rewrite that collapses to almost nothing means the model refused or
    // returned a preamble instead of the text — prefer the deterministic strip.
    if (cleaned.length < Math.min(20, source.length / 2)) {
      logger.warn("[speech] spoken rewrite looked degenerate — using stripped original");
      return source;
    }
    return cleaned.slice(0, MAX_SPOKEN_CHARS);
  } catch (err) {
    logger.warn({ err }, "[speech] spoken rewrite failed — using stripped original");
    return source;
  }
}
