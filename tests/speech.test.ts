import { describe, it, expect, vi } from "vitest";
import { detectLanguage, LOCALE } from "../src/lib/speech/types";
import { SarvamTtsProvider, SARVAM_MAX_CHARS } from "../src/lib/speech/sarvam";
import { AzureTtsProvider } from "../src/lib/speech/azure";

describe("detectLanguage — picks the voice for a reply", () => {
  it("treats a pure English reply as English", () => {
    expect(detectLanguage("Use neem oil at 5ml per litre.")).toBe("en");
  });

  it("detects Telugu script", () => {
    expect(detectLanguage("నమస్తే అండి")).toBe("te");
  });

  it("detects Hindi/Devanagari", () => {
    expect(detectLanguage("नमस्ते जी")).toBe("hi");
  });

  // The persona writes Telugu sentences carrying English horticultural terms.
  // If a stray English word flipped the voice to English, every Telugu word
  // around it would be mispronounced.
  it("stays Telugu when Telugu script carries embedded English terms", () => {
    expect(detectLanguage("మీ tomato లో leaf miner ఉంది andi")).toBe("te");
  });

  // Romanized Telugu is indistinguishable from English by script alone. This
  // documents the limitation the spoken-rendering step exists to solve.
  it("classifies romanized Telugu as English (script-based detection limit)", () => {
    expect(detectLanguage("Namaste andi, mee tomato lo problem undi")).toBe("en");
  });
});

describe("SarvamTtsProvider", () => {
  const okResponse = (audios: string[]) =>
    ({ ok: true, json: async () => ({ audios }) }) as unknown as Response;

  it("sends the BCP-47 locale, model and speaker", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([Buffer.from("hi").toString("base64")]));
    const p = new SarvamTtsProvider("k", { fetchFn: fetchFn as unknown as typeof fetch });
    await p.synthesize("పంట", "te");

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.target_language_code).toBe(LOCALE.te);
    expect(body.model).toBe("bulbul:v3");
    expect(body.speaker).toBe("shubh");
    expect(body.enable_preprocessing).toBe(true);
    expect(fetchFn.mock.calls[0][1].headers["api-subscription-key"]).toBe("k");
  });

  // Sarvam returns audio as an ARRAY of base64 chunks. Decoding each chunk
  // separately and concatenating the bytes corrupts the file whenever a chunk
  // length isn't a multiple of 3 — the audio still "plays", it just sounds
  // like static, so only a byte-level assertion catches it.
  it("joins base64 chunks before decoding, not after", async () => {
    const original = Buffer.from("the quick brown fox jumps over");
    const b64 = original.toString("base64");
    const chunks = [b64.slice(0, 7), b64.slice(7)]; // deliberately unaligned split
    const fetchFn = vi.fn().mockResolvedValue(okResponse(chunks));

    const p = new SarvamTtsProvider("k", { fetchFn: fetchFn as unknown as typeof fetch });
    const out = await p.synthesize("x", "en");
    expect(Buffer.from(out.bytes).toString()).toBe(original.toString());
  });

  it("truncates input beyond the model's character ceiling instead of 400ing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([Buffer.from("a").toString("base64")]));
    const p = new SarvamTtsProvider("k", { fetchFn: fetchFn as unknown as typeof fetch });
    await p.synthesize("x".repeat(SARVAM_MAX_CHARS + 500), "te");
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).text.length).toBe(SARVAM_MAX_CHARS);
  });

  it("throws with the vendor status when synthesis fails", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" } as Response);
    const p = new SarvamTtsProvider("k", { fetchFn: fetchFn as unknown as typeof fetch });
    await expect(p.synthesize("x", "te")).rejects.toThrow(/401/);
  });
});

describe("AzureTtsProvider", () => {
  const ok = () =>
    ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }) as unknown as Response;

  it("selects the native Telugu neural voice", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok());
    const p = new AzureTtsProvider("k", "centralindia", fetchFn as unknown as typeof fetch);
    await p.synthesize("పంట", "te");
    expect(fetchFn.mock.calls[0][1].body).toContain("te-IN-ShrutiNeural");
    expect(fetchFn.mock.calls[0][0]).toContain("centralindia.tts.speech.microsoft.com");
  });

  // Replies routinely contain "&" (e.g. "NPK & micronutrients"). Unescaped, it
  // makes the SSML invalid XML and the whole voice note silently fails.
  it("escapes XML-significant characters in the reply text", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok());
    const p = new AzureTtsProvider("k", "centralindia", fetchFn as unknown as typeof fetch);
    await p.synthesize('NPK & "micro" <nutrients>', "en");
    const body = fetchFn.mock.calls[0][1].body as string;
    expect(body).toContain("&amp;");
    expect(body).not.toMatch(/&(?!amp;|quot;|apos;|lt;|gt;)/);
  });

  it("requests OGG/Opus so WhatsApp renders a voice note", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok());
    const p = new AzureTtsProvider("k", "centralindia", fetchFn as unknown as typeof fetch);
    await p.synthesize("hello", "en");
    expect(fetchFn.mock.calls[0][1].headers["X-Microsoft-OutputFormat"]).toMatch(/opus/);
  });
});
