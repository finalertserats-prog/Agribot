import OpenAI, { toFile } from "openai";
import { logger } from "../logger";
import type { AudioBytes, SpokenLanguage, SttProvider, TtsProvider } from "./types";

/**
 * OpenAI speech connectors. STT is the primary transcription path; TTS is the
 * zero-setup fallback so voice replies work on the existing OPENAI_API_KEY
 * alone, before any Indic vendor is signed up. For Telugu output an Indic
 * engine (Sarvam/Azure) is materially better — see resolveTts().
 */

/** gpt-4o-transcribe handles Indic speech and code-switching better than whisper-1. */
const DEFAULT_STT_MODEL = "gpt-4o-transcribe";
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";

/**
 * A warm, mid-range voice. CTG members are being advised, not sold to — an
 * over-bright voice reads as a telemarketer, which is the opposite of the
 * "senior volunteer" the persona is meant to be.
 */
const DEFAULT_TTS_VOICE = "alloy";

export class OpenAISttProvider implements SttProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = DEFAULT_STT_MODEL) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async transcribe(audio: AudioBytes, languageHint?: string): Promise<string> {
    // The SDK needs a File-like with a name whose extension matches the codec —
    // it is what the API sniffs the container from. WhatsApp voice notes are
    // always OGG/Opus, so default there rather than to a generic name.
    const ext = audio.mimeType.includes("mpeg")
      ? "mp3"
      : audio.mimeType.includes("wav")
        ? "wav"
        : "ogg";
    const file = await toFile(Buffer.from(audio.bytes), `voice.${ext}`, {
      type: audio.mimeType,
    });

    const res = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      // Passed only when the caller is confident. Forcing "te" on a member who
      // actually spoke English produces confident nonsense, so an absent hint
      // (auto-detect) is the safer default.
      ...(languageHint ? { language: languageHint } : {}),
    });
    return (res.text || "").trim();
  }
}

export class OpenAITtsProvider implements TtsProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly voice: string;

  constructor(apiKey: string, model = DEFAULT_TTS_MODEL, voice = DEFAULT_TTS_VOICE) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.voice = voice;
  }

  async synthesize(text: string, language: SpokenLanguage): Promise<AudioBytes> {
    if (language === "te") {
      // Not fatal — but this connector is not a Telugu voice, and pretending
      // otherwise ships a bad-sounding note with no trace of why.
      logger.debug(
        { provider: this.name },
        "[speech] synthesizing Telugu on OpenAI TTS — an Indic engine sounds materially better"
      );
    }
    const res = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice,
      input: text,
      // Ask for Opus directly: WhatsApp voice notes must be Opus, and starting
      // from Opus makes the ffmpeg step a cheap container rewrap rather than a
      // full re-encode through another lossy codec.
      response_format: "opus",
    });
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: "audio/ogg",
    };
  }
}
