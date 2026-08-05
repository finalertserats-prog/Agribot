import { LOCALE, type AudioBytes, type SpokenLanguage, type TtsProvider } from "./types";

/**
 * Azure Speech TTS. Alternative Indic engine with genuine te-IN neural voices.
 * Chosen over OpenAI TTS for Telugu; chosen under Sarvam only because Azure
 * expects one locale per utterance, which suits Telugu-script replies but not
 * heavily code-mixed ones.
 */

/** Native Telugu / Hindi / Indian-English neural voices. */
const VOICE: Record<SpokenLanguage, string> = {
  te: "te-IN-ShrutiNeural",
  hi: "hi-IN-SwaraNeural",
  en: "en-IN-NeerjaNeural",
};

/**
 * 48kHz mono Opus in an OGG container — the one Azure output that is already
 * the codec WhatsApp needs, so the ffmpeg step degrades to a container check
 * instead of a lossy re-encode.
 */
const OUTPUT_FORMAT = "ogg-48khz-16bit-mono-opus";

/** XML-escape text before it goes into SSML, or an "&" in a reply breaks the request. */
function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export class AzureTtsProvider implements TtsProvider {
  readonly name = "azure";
  private readonly apiKey: string;
  private readonly region: string;
  private readonly fetchFn: typeof fetch;

  constructor(apiKey: string, region: string, fetchFn: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.region = region;
    this.fetchFn = fetchFn;
  }

  async synthesize(text: string, language: SpokenLanguage): Promise<AudioBytes> {
    const locale = LOCALE[language];
    const ssml =
      `<speak version='1.0' xml:lang='${locale}'>` +
      `<voice xml:lang='${locale}' name='${VOICE[language]}'>${escapeSsml(text)}</voice>` +
      `</speak>`;

    const res = await this.fetchFn(
      `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
          "User-Agent": "ctg-admn-bot",
        },
        body: ssml,
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Azure TTS failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/ogg" };
  }
}
