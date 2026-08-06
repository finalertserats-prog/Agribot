/**
 * Which channel the member wants the answer in.
 *
 * The default rule is "asked in voice → answered in voice too", which covers
 * most cases. But a member typing "voice lo cheppandi andi" is asking just as
 * clearly, and one who replies "text lo chalu" while driving is asking for the
 * opposite. Both are explicit instructions and outrank the default.
 */

/**
 * Asking FOR audio. Two parts must both appear — a channel word and a request
 * word — because "voice" alone shows up in ordinary sentences. Note that
 * `\bvoice\b` cannot match inside "invoice": there is no word boundary between
 * "n" and "v".
 */
// Indic alternatives are matched WITHOUT \b. JS word boundaries are defined on
// [A-Za-z0-9_], so Telugu characters are all "non-word" and \bవాయిస్\b never
// matches the way it reads.
const CHANNEL = String.raw`(?:\b(?:voice|audio)\b|వాయిస్|ఆడియో)`;
const REQUEST = String.raw`(?:\b(?:lo|lone|ne|cheppandi|cheppu|pampandi|pampu|kavali|kaavali|ivvandi|send|reply|repeat|please)\b|చెప్పండి|పంపండి|కావాలి|ఇవ్వండి|లో)`;

/**
 * The two parts must sit NEXT to each other, not merely both appear somewhere.
 * "lo" (Telugu "in") and "send" are everyday words: co-occurrence alone makes
 * "voice problem undi, tomato lo emi cheyyali?" read as a request for audio.
 * A short window in either order keeps "voice lo cheppandi" and "send a voice
 * reply" while rejecting words that happen to share a sentence.
 */
const NEAR = String.raw`[^.!?\n]{0,12}`;
const VOICE_REQUEST = new RegExp(`${CHANNEL}${NEAR}${REQUEST}|${REQUEST}${NEAR}${CHANNEL}`, "iu");

/**
 * Asking for text ONLY. Checked first — "voice vaddu" contains a channel word
 * and would otherwise read as a request for the very thing being refused.
 */
const TEXT_ONLY =
  /(\btext\b|టెక్స్ట్)[^.!?]{0,20}(\b(lo|only|lone|ne|chalu|saripodi|matrame)\b|మాత్రమే|చాలు|లో)|(\b(voice|audio)\b|వాయిస్|ఆడియో)[^.!?]{0,15}(\b(vaddu|venda|vadhu)\b|వద్దు|అవసరం లేదు)|\bno\s+(voice|audio)\b|\bdon'?t\s+send\s+(a\s+)?(voice|audio)\b/iu;

/**
 * The member's explicit channel preference, or undefined when they didn't state
 * one. Undefined is meaningful: the caller falls back to mirroring how they
 * asked, and must not read it as "no".
 */
export function requestedVoiceReply(text: string): boolean | undefined {
  if (!text?.trim()) return undefined;
  if (TEXT_ONLY.test(text)) return false;
  if (VOICE_REQUEST.test(text)) return true;
  return undefined;
}

/**
 * Should this turn get a voice note? An explicit ask wins; otherwise mirror the
 * channel the member used, which is why a voice note gets one back and a typed
 * message does not (unsolicited audio is intrusive and doubles cost).
 */
export function shouldSendVoiceReply(text: string, askedByVoice: boolean): boolean {
  return requestedVoiceReply(text) ?? askedByVoice;
}
