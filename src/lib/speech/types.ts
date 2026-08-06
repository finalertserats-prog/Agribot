/**
 * Speech provider contracts. Mirrors `src/lib/llm/` — the transport picks a
 * provider from whichever credential is configured, and callers never learn
 * which vendor answered.
 */

/** Raw audio plus the mime type it is actually encoded as. */
export interface AudioBytes {
  bytes: Uint8Array;
  mimeType: string;
  /**
   * The vendor that actually synthesized this clip. Travels with the result
   * rather than being read back off the provider, because the provider is a
   * process-wide singleton: with a fallback chain and two members speaking at
   * once, any mutable "who served last" field reports whoever finished last,
   * not who served this reply.
   */
  provider?: string;
}

/** What a transcription attempt produced. */
export interface Transcript {
  text: string;
  /**
   * Mean token log-probability, when the vendor reports one. Closer to 0 is
   * more confident; roughly -0.2 is a clean transcript. Left undefined when the
   * vendor gives no signal — callers must then treat the text as trustworthy
   * rather than guessing, so a silent vendor never blocks a member.
   */
  confidence?: number;
}

/**
 * Below this mean log-probability the transcript is treated as not understood,
 * and the member is asked to repeat instead of being answered on a guess. A
 * real case: a Telugu voice note came back as "Hello, kura gelela banding cadi"
 * and earned a 3500-word answer about the wrong crop.
 *
 * Set deliberately low. Romanized Telugu is unusual-looking text and scores
 * worse than English even when perfectly transcribed, so a tight threshold
 * would keep asking good speakers to repeat themselves — a far worse failure
 * than occasionally answering a rough transcript. OpenAI's own guidance treats
 * below -1 as "the logprobs failed", which anchors this.
 */
export const LOW_CONFIDENCE_LOGPROB = -1.0;

/** Speech-to-text. WhatsApp voice notes arrive as OGG/Opus. */
export interface SttProvider {
  readonly name: string;
  /**
   * Transcribe spoken audio. `languageHint` is BCP-47 ("te", "en") and is only
   * a hint — CTG members code-switch mid-sentence, so a provider that supports
   * auto-detection should prefer it over a forced language.
   */
  transcribe(audio: AudioBytes, languageHint?: string): Promise<Transcript>;
}

/** Text-to-speech. Output is transcoded to OGG/Opus before it reaches WhatsApp. */
export interface TtsProvider {
  readonly name: string;
  /**
   * Synthesize `text`. `language` is the dominant language of the utterance so
   * an Indic engine can pick a Telugu voice rather than reading Telugu with an
   * English one.
   */
  synthesize(text: string, language: SpokenLanguage): Promise<AudioBytes>;
}

/**
 * The languages CTG actually gets. Deliberately not a free string: a typo in a
 * locale code degrades silently into a wrong-sounding voice rather than an
 * error, which is the hardest class of bug to notice in audio.
 */
export type SpokenLanguage = "te" | "hi" | "en";

/** Locale codes for engines that want a full BCP-47 tag. */
export const LOCALE: Record<SpokenLanguage, string> = {
  te: "te-IN",
  hi: "hi-IN",
  en: "en-IN",
};

/**
 * Detect the dominant language of a reply so TTS picks the right voice.
 *
 * Order matters: a reply containing ANY Telugu script is Telugu, even when it
 * also carries English technical terms — "CEC (nutrient-holding capacity)"
 * inside a Telugu sentence is still a Telugu utterance, and an English voice
 * would mangle everything around that phrase.
 */
export function detectLanguage(text: string): SpokenLanguage {
  if (/[ఀ-౿]/.test(text)) return "te"; // Telugu block
  if (/[ऀ-ॿ]/.test(text)) return "hi"; // Devanagari
  return "en";
}
