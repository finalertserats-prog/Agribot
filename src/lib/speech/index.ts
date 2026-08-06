import { config } from "../../config";
import { logger } from "../logger";
import { AzureTtsProvider } from "./azure";
import { FallbackSttProvider, FallbackTtsProvider } from "./fallback";
import { OpenAISttProvider, OpenAITtsProvider } from "./openai";
import { SarvamSttProvider, SarvamTtsProvider } from "./sarvam";
import type { SttProvider, TtsProvider } from "./types";

export type { AudioBytes, SpokenLanguage, SttProvider, Transcript, TtsProvider } from "./types";
export { detectLanguage, LOCALE, LOW_CONFIDENCE_LOGPROB } from "./types";
export { requestedVoiceReply, shouldSendVoiceReply } from "./channel";

/**
 * Provider resolution, mirroring `src/lib/llm/`. Whichever credential is
 * present wins — swapping vendors is an env change, never a code change.
 */

let stt: SttProvider | null | undefined;
let tts: TtsProvider | null | undefined;

/**
 * Every configured Sarvam account, best first. Two keys are supported because
 * the failure that actually happens is credit exhaustion, not an outage: a
 * valid key on an empty account 402s on EVERY call, forever. A spare key turns
 * that from "no Telugu voice until someone tops up" into a non-event.
 *
 * The labels matter — the fallback chain identifies providers by name, so
 * without them a key-to-key failover would be invisible and nothing could say
 * which account served (or is being billed for) a given reply.
 */
function sarvamKeys(): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  if (config.speech.sarvamKey) out.push({ key: config.speech.sarvamKey, label: "sarvam" });
  if (config.speech.sarvamKeyBackup) {
    out.push({ key: config.speech.sarvamKeyBackup, label: "sarvam-backup" });
  }
  return out;
}

/**
 * Transcription, in descending order of accuracy on how CTG members actually
 * speak — code-mixed Telugu-English:
 *   Sarvam saaras — Indic-native, has a dedicated code-mix mode
 *   OpenAI        — general-purpose; mangled "kura ..." into "kura gelela
 *                   banding cadi" on a real member's voice note
 * Both configured means both are tried, so an out-of-credit preferred vendor
 * costs accuracy rather than the whole message. No key at all returns null, and
 * the bot tells the member it can't hear voice notes — far better than
 * silently ignoring one.
 */
export function resolveStt(): SttProvider | null {
  if (stt !== undefined) return stt;
  const chain: SttProvider[] = [];

  for (const { key, label } of sarvamKeys()) {
    chain.push(new SarvamSttProvider(key, { model: config.speech.sttSarvamModel, label }));
  }
  if (config.llm.openai.apiKey) {
    chain.push(new OpenAISttProvider(config.llm.openai.apiKey, config.speech.sttModel));
  }

  if (chain.length === 0) {
    logger.warn("[speech] no STT vendor configured — voice notes cannot be transcribed");
    stt = null;
    return stt;
  }

  stt = chain.length === 1 ? chain[0] : new FallbackSttProvider(chain);
  logger.info(
    { provider: chain[0].name, fallbacks: chain.slice(1).map((p) => p.name) },
    "[speech] STT provider selected"
  );
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

  for (const { key, label } of sarvamKeys()) {
    chain.push(
      new SarvamTtsProvider(key, { model: s.sarvamModel, speaker: s.sarvamSpeaker, label })
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
