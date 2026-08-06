import { logger } from "../logger";
import type {
  AudioBytes,
  SpokenLanguage,
  SttProvider,
  Transcript,
  TtsProvider,
} from "./types";

/**
 * Tries TTS vendors in order of Telugu quality and takes the first that
 * answers. Selection alone is not enough: a configured vendor can be present
 * and still fail every call — an exhausted credit balance 402s indefinitely,
 * not once. Without fallthrough that turns into silence, because the caller
 * treats a failed voice reply as best-effort and only logs it. A member who
 * asked in voice then gets text back forever, with nothing to explain why.
 */
export class FallbackTtsProvider implements TtsProvider {
  /**
   * The preferred vendor, fixed for the lifetime of the chain. Who actually
   * spoke for a given reply comes back on the result (`AudioBytes.provider`) —
   * this object is a singleton shared by concurrent replies, so it must not
   * carry per-call state.
   */
  readonly name: string;

  constructor(private readonly providers: readonly TtsProvider[]) {
    if (providers.length === 0) throw new Error("FallbackTtsProvider needs at least one provider");
    this.name = providers[0].name;
  }

  async synthesize(text: string, language: SpokenLanguage): Promise<AudioBytes> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        const audio = await provider.synthesize(text, language);
        if (provider.name !== this.name) {
          logger.info(
            { provider: provider.name, preferred: this.name },
            "[speech] TTS served by fallback provider"
          );
        }
        return { ...audio, provider: provider.name };
      } catch (err) {
        lastError = err;
        // Message only, never the raw error: a rejected vendor call can carry
        // the request body, and that body is the member's own question.
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn(
          { reason, provider: provider.name },
          "[speech] TTS provider failed — trying next"
        );
      }
    }
    // Rethrow rather than returning empty audio: the caller already treats a
    // throw as "text only, log it", and a zero-byte buffer would instead reach
    // ffmpeg and fail far from the actual cause.
    throw lastError instanceof Error
      ? lastError
      : new Error(`All TTS providers failed: ${String(lastError)}`);
  }
}

/**
 * The same contract for transcription. A member's voice note is a one-shot
 * event — they will not helpfully repeat it because a vendor was out of credit,
 * so a dead preferred engine must cost accuracy, never the message itself.
 */
export class FallbackSttProvider implements SttProvider {
  /** The preferred vendor. Per-call state must not live here — see above. */
  readonly name: string;

  constructor(private readonly providers: readonly SttProvider[]) {
    if (providers.length === 0) throw new Error("FallbackSttProvider needs at least one provider");
    this.name = providers[0].name;
  }

  async transcribe(audio: AudioBytes, languageHint?: string): Promise<Transcript> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        const result = await provider.transcribe(audio, languageHint);
        if (provider.name !== this.name) {
          logger.info(
            { provider: provider.name, preferred: this.name },
            "[speech] transcription served by fallback provider"
          );
        }
        return result;
      } catch (err) {
        lastError = err;
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn(
          { reason, provider: provider.name },
          "[speech] STT provider failed — trying next"
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`All STT providers failed: ${String(lastError)}`);
  }
}
