import { config } from "../../config";
import { logger } from "../logger";
import { AzureTtsProvider } from "./azure";
import { FallbackTtsProvider } from "./fallback";
import { OpenAISttProvider, OpenAITtsProvider } from "./openai";
import { SarvamTtsProvider } from "./sarvam";
import type { SttProvider, TtsProvider } from "./types";

export type { AudioBytes, SpokenLanguage, SttProvider, TtsProvider } from "./types";
export { detectLanguage, LOCALE } from "./types";

/**
 * Provider resolution, mirroring `src/lib/llm/`. Whichever credential is
 * present wins — swapping vendors is an env change, never a code change.
 */

let stt: SttProvider | null | undefined;
let tts: TtsProvider | null | undefined;

/**
 * Transcription. Requires an OpenAI key specifically: Gemini-only deployments
 * get null and the bot tells the member it can't hear voice notes, which is far
 * better than silently ignoring one.
 */
export function resolveStt(): SttProvider | null {
  if (stt !== undefined) return stt;
  const key = config.llm.openai.apiKey;
  stt = key ? new OpenAISttProvider(key, config.speech.sttModel) : null;
  if (!stt) logger.warn("[speech] no OpenAI key — voice notes cannot be transcribed");
  return stt;
}

/**
 * Voice output, in descending order of Telugu quality:
 *   Sarvam  — Indic-native, handles code-mixed Telugu-English (best fit)
 *   Azure   — real te-IN neural voice, one locale per utterance
 *   OpenAI  — no Telugu voice, but needs no new vendor; ships today
 *
 * Every configured vendor goes into the chain, not just the best one. A key
 * being present says the vendor is reachable, not that it will answer — a
 * credit balance runs out mid-week and 402s every call after that. Chaining
 * means an exhausted preferred vendor costs pronunciation quality for that
 * reply, not the voice note itself.
 *
 * Returning null disables voice replies while leaving text replies untouched.
 */
export function resolveTts(): TtsProvider | null {
  if (tts !== undefined) return tts;
  const s = config.speech;
  const chain: TtsProvider[] = [];

  if (s.sarvamKey) {
    chain.push(
      new SarvamTtsProvider(s.sarvamKey, { model: s.sarvamModel, speaker: s.sarvamSpeaker })
    );
  }
  if (s.azureKey && s.azureRegion) chain.push(new AzureTtsProvider(s.azureKey, s.azureRegion));
  if (config.llm.openai.apiKey) {
    chain.push(new OpenAITtsProvider(config.llm.openai.apiKey, s.ttsModel, s.ttsVoice));
  }

  if (chain.length === 0) {
    tts = null;
    return tts;
  }
  if (!s.sarvamKey && !(s.azureKey && s.azureRegion)) {
    logger.warn(
      "[speech] OpenAI TTS only — no Telugu voice. Set SARVAM_API_KEY or AZURE_SPEECH_KEY for native Telugu."
    );
  }

  tts = chain.length === 1 ? chain[0] : new FallbackTtsProvider(chain);
  logger.info(
    { provider: chain[0].name, fallbacks: chain.slice(1).map((p) => p.name) },
    "[speech] TTS provider selected"
  );
  return tts;
}

/** Test seam — clears the memoized providers. */
export function resetSpeechProviders(): void {
  stt = undefined;
  tts = undefined;
}
