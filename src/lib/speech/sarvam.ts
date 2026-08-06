import { logger } from "../logger";
import {
  LOCALE,
  type AudioBytes,
  type SpokenLanguage,
  type SttProvider,
  type Transcript,
  type TtsProvider,
} from "./types";

/**
 * Sarvam AI TTS (bulbul). The best fit for CTG: its TTS is documented to accept
 * code-mixed English+Indic text, which is exactly how the persona writes
 * ("Namaste andi, mee tomato lo leaf miner undi"). Engines that assume a single
 * language per utterance mangle precisely those sentences.
 */

const ENDPOINT = "https://api.sarvam.ai/text-to-speech";

/** bulbul:v3 accepts 2500 chars; v2 only 1500. */
const DEFAULT_MODEL = "bulbul:v3";
const DEFAULT_SPEAKER = "shubh";

/**
 * Hard ceiling from the vendor's own limit for bulbul:v3. Callers should have
 * shortened the spoken text well before this; truncating mid-sentence is ugly,
 * but silently sending 3000 chars is a 400 and no voice note at all.
 */
export const SARVAM_MAX_CHARS = 2500;

/** A hung vendor call must not pin a voice-reply task open indefinitely. */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Refuse absurd payloads before base64-decoding them. A changed or hostile
 * vendor response could otherwise allocate hundreds of MB before ffmpeg's own
 * limit ever gets a chance to apply.
 */
const MAX_BASE64_CHARS = 30 * 1024 * 1024;

export class SarvamTtsProvider implements TtsProvider {
  readonly name = "sarvam";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly speaker: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    apiKey: string,
    opts: { model?: string; speaker?: string; fetchFn?: typeof fetch } = {}
  ) {
    this.apiKey = apiKey;
    this.model = opts.model || DEFAULT_MODEL;
    this.speaker = opts.speaker || DEFAULT_SPEAKER;
    this.fetchFn = opts.fetchFn || fetch;
  }

  async synthesize(text: string, language: SpokenLanguage): Promise<AudioBytes> {
    const input = text.length > SARVAM_MAX_CHARS ? text.slice(0, SARVAM_MAX_CHARS) : text;
    if (input.length < text.length) {
      logger.warn(
        { chars: text.length, limit: SARVAM_MAX_CHARS },
        "[speech] reply too long for one voice note — truncating spoken version"
      );
    }

    const res = await this.fetchFn(ENDPOINT, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method: "POST",
      headers: {
        "api-subscription-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input,
        target_language_code: LOCALE[language],
        model: this.model,
        speaker: this.speaker,
        // Normalizes English words and numeric entities inside Indic text —
        // our replies are full of "10 litres", "NPK 19:19:19", "pH 6.5", and
        // unnormalized numerals get read as digits rather than spoken words.
        enable_preprocessing: true,
        // Deliberately NOT requesting Opus here. The vendor's default is WAV,
        // and ffmpeg has to run anyway to produce the exact OGG/Opus WhatsApp
        // requires for a voice-note bubble — so take the format that is least
        // ambiguous across API versions and let one transcode settle it.
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Sarvam TTS failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    // Response is { audios: [base64, ...] } — chunks must be joined BEFORE
    // decoding. Decoding each chunk separately and concatenating the bytes
    // corrupts the file whenever a chunk boundary isn't a multiple of 3 bytes.
    const body = (await res.json()) as { audios?: unknown };
    // Validate the shape rather than trusting it — a vendor schema change
    // should surface as a clear error, not a corrupt buffer sent to a member.
    if (!Array.isArray(body.audios) || body.audios.some((a) => typeof a !== "string")) {
      throw new Error("Sarvam TTS returned an unexpected response shape");
    }
    const joined = (body.audios as string[]).join("");
    if (!joined) throw new Error("Sarvam TTS returned no audio");
    if (joined.length > MAX_BASE64_CHARS) {
      throw new Error(`Sarvam TTS returned an implausibly large payload (${joined.length} chars)`);
    }

    return { bytes: new Uint8Array(Buffer.from(joined, "base64")), mimeType: "audio/wav" };
  }
}

/**
 * Sarvam AI STT (saaras). Preferred over gpt-4o-transcribe for CTG because the
 * members speak code-mixed Telugu-English, which is what this model is trained
 * for — a real voice note came back from a general-purpose engine as "Hello,
 * kura gelela banding cadi" and earned a long answer about the wrong crop.
 */

const STT_ENDPOINT = "https://api.sarvam.ai/speech-to-text";

/** saaras:v3 is the version that exposes `mode`, including code-mixed input. */
const DEFAULT_STT_MODEL = "saaras:v3";

/**
 * `codemix` keeps English horticultural terms as English inside a Telugu
 * sentence instead of transliterating them into Telugu script — "leaf miner"
 * must survive as "leaf miner". Only saaras:v3 accepts `mode`; sending it to v4
 * is a 400, so it is attached conditionally.
 */
const CODEMIX_MODE = "codemix";
const MODE_CAPABLE_MODEL = /^saaras:v3/;

export class SarvamSttProvider implements SttProvider {
  readonly name = "sarvam";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(apiKey: string, opts: { model?: string; fetchFn?: typeof fetch } = {}) {
    this.apiKey = apiKey;
    this.model = opts.model || DEFAULT_STT_MODEL;
    this.fetchFn = opts.fetchFn || fetch;
  }

  async transcribe(audio: AudioBytes, languageHint?: string): Promise<Transcript> {
    const form = new FormData();
    // WhatsApp voice notes are OGG/Opus; the filename extension is what most
    // multipart endpoints sniff the container from.
    form.append("file", new Blob([audio.bytes], { type: audio.mimeType }), "voice.ogg");
    form.append("model", this.model);
    if (MODE_CAPABLE_MODEL.test(this.model)) form.append("mode", CODEMIX_MODE);
    // Omitted rather than forced when absent: Sarvam auto-detects, and forcing
    // te-IN on a member who spoke English yields confident nonsense.
    if (languageHint) form.append("language_code", languageHint);

    const res = await this.fetchFn(STT_ENDPOINT, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method: "POST",
      // No Content-Type header — fetch must set it to include the multipart
      // boundary, and overriding it here silently breaks the upload.
      headers: { "api-subscription-key": this.apiKey },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Sarvam STT failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const body = (await res.json()) as { transcript?: unknown; language_probability?: unknown };
    if (typeof body.transcript !== "string") {
      throw new Error("Sarvam STT returned an unexpected response shape");
    }
    if (typeof body.language_probability === "number" && body.language_probability < 0.5) {
      logger.debug(
        { languageProbability: body.language_probability },
        "[speech] Sarvam was unsure which language was spoken"
      );
    }

    // Deliberately no `confidence`: Sarvam reports `language_probability`, which
    // scores which LANGUAGE was detected, not how well the words were heard.
    // Feeding a 0-1 probability to a threshold expressed in log-probabilities
    // would compare two different scales and always pass. No signal is the
    // honest answer, and callers treat that as "trust the text".
    return { text: body.transcript.trim() };
  }
}
