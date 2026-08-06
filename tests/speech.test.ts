import { describe, it, expect, vi, afterEach } from "vitest";
import { detectLanguage, LOCALE } from "../src/lib/speech/types";
import { SarvamSttProvider, SarvamTtsProvider, SARVAM_MAX_CHARS } from "../src/lib/speech/sarvam";
import { AzureTtsProvider } from "../src/lib/speech/azure";
import { FallbackSttProvider, FallbackTtsProvider } from "../src/lib/speech/fallback";
import { logger } from "../src/lib/logger";
import type { TtsProvider } from "../src/lib/speech/types";

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
    // "anand" — picked by ear over five other candidates; the vendor default
    // ("shubh") was rejected as harsher to listen to.
    expect(body.speaker).toBe("anand");
    expect(fetchFn.mock.calls[0][1].headers["api-subscription-key"]).toBe("k");
  });

  // WhatsApp voice notes are 48 kHz. Sarvam defaults to 24 kHz, so taking the
  // default meant ffmpeg upsampled and half the output was interpolated.
  it("asks for audio at WhatsApp's own sample rate instead of upsampling later", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([Buffer.from("a").toString("base64")]));
    await new SarvamTtsProvider("k", { fetchFn: fetchFn as unknown as typeof fetch }).synthesize(
      "x",
      "te"
    );
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).speech_sample_rate).toBe(48000);
  });

  it("sends the v3 delivery controls that make the voice calmer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([Buffer.from("a").toString("base64")]));
    await new SarvamTtsProvider("k", {
      pace: 0.9,
      temperature: 0.4,
      fetchFn: fetchFn as unknown as typeof fetch,
    }).synthesize("x", "te");
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.pace).toBe(0.9);
    expect(body.temperature).toBe(0.4);
  });

  // enable_preprocessing is a v2 parameter. bulbul:v3 ignores it, and pace /
  // temperature do not exist on v2 — sending either to the wrong model is at
  // best noise and at worst a 400.
  it("sends only the parameters the selected model actually supports", async () => {
    const f3 = vi.fn().mockResolvedValue(okResponse([Buffer.from("a").toString("base64")]));
    await new SarvamTtsProvider("k", { fetchFn: f3 as unknown as typeof fetch }).synthesize("x", "te");
    const v3 = JSON.parse(f3.mock.calls[0][1].body);
    expect(v3.enable_preprocessing).toBeUndefined();
    expect(v3.temperature).toBeDefined();

    const f2 = vi.fn().mockResolvedValue(okResponse([Buffer.from("a").toString("base64")]));
    await new SarvamTtsProvider("k", {
      model: "bulbul:v2",
      fetchFn: f2 as unknown as typeof fetch,
    }).synthesize("x", "te");
    const v2 = JSON.parse(f2.mock.calls[0][1].body);
    expect(v2.enable_preprocessing).toBe(true);
    expect(v2.temperature).toBeUndefined();
    expect(v2.pace).toBeUndefined();
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

describe("FallbackTtsProvider — a dead vendor must not silence voice replies", () => {
  const audio = (tag: string) => ({ bytes: new Uint8Array([1]), mimeType: tag });
  const working = (tag: string) => ({ name: tag, synthesize: vi.fn().mockResolvedValue(audio(tag)) });
  const broken = (tag: string, err: string) => ({
    name: tag,
    synthesize: vi.fn().mockRejectedValue(new Error(err)),
  });

  it("uses the first provider when it succeeds", async () => {
    const first = working("sarvam");
    const second = working("openai");
    const p = new FallbackTtsProvider([first, second]);
    expect((await p.synthesize("hi", "te")).mimeType).toBe("sarvam");
    expect(second.synthesize).not.toHaveBeenCalled();
  });

  // The exact case that blocked this deploy: a valid Sarvam key on an account
  // with no credits 402s on every call. Without fallthrough the member simply
  // stops getting voice notes, with nothing but a log line to say why.
  it("falls through to the next provider when the preferred one fails", async () => {
    const p = new FallbackTtsProvider([
      broken("sarvam", "Sarvam TTS failed (402): No credits available."),
      working("openai"),
    ]);
    expect((await p.synthesize("hi", "te")).mimeType).toBe("openai");
  });

  // The chain is a process-wide singleton and members speak concurrently, so
  // "who served this reply" has to ride on the result. A mutable field on the
  // provider would report whichever request finished last.
  it("tags the result with the vendor that actually spoke", async () => {
    const p = new FallbackTtsProvider([broken("sarvam", "402"), working("azure")]);
    expect((await p.synthesize("hi", "te")).provider).toBe("azure");
    expect(p.name).toBe("sarvam");
  });

  it("does not leak the failing vendor's raw error object into logs", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    const p = new FallbackTtsProvider([broken("sarvam", "402 no credits"), working("openai")]);
    await p.synthesize("member's private question", "te");
    expect(warn).toHaveBeenCalled();
    for (const [payload] of warn.mock.calls) {
      expect(payload).not.toHaveProperty("err");
      expect(JSON.stringify(payload)).not.toContain("private question");
    }
    warn.mockRestore();
  });

  it("surfaces the last error when every provider fails", async () => {
    const p = new FallbackTtsProvider([broken("sarvam", "402"), broken("openai", "429 rate limit")]);
    await expect(p.synthesize("hi", "te")).rejects.toThrow(/429 rate limit/);
  });
});

/** Chain member names, or the single provider's name when there is no chain. */
function names(p: unknown): string[] {
  const chain = (p as { providers?: Array<{ name: string }> })?.providers;
  return chain ? chain.map((x) => x.name) : [(p as { name: string }).name];
}

describe("resolveTts — chain construction from configured credentials", () => {
  const speech = {
    enabled: true,
    sttModel: "gpt-4o-transcribe",
    ttsModel: "gpt-4o-mini-tts",
    ttsVoice: "alloy",
    sarvamModel: "bulbul:v3",
    sarvamSpeaker: "shubh",
  };

  /** Load a fresh copy of the module under a synthetic config. */
  async function resolveWith(overrides: Record<string, unknown>, openaiKey?: string) {
    vi.resetModules();
    vi.doMock("../src/config", () => ({
      // logLevel is read by the logger this module pulls in transitively.
      config: {
        logLevel: "silent",
        speech: { ...speech, ...overrides },
        llm: { openai: { apiKey: openaiKey } },
      },
    }));
    const mod = await import("../src/lib/speech");
    mod.resetSpeechProviders();
    return mod.resolveTts();
  }

  afterEach(() => {
    vi.doUnmock("../src/config");
    vi.resetModules();
  });

  it("orders the chain Sarvam → Azure → OpenAI when all three are configured", async () => {
    const p = await resolveWith(
      { sarvamKey: "s", azureKey: "a", azureRegion: "centralindia" },
      "sk-x"
    );
    // Checked by constructor name, not instanceof: resetModules() gives the
    // dynamic import its own copy of the class, so identity never matches.
    expect(p?.constructor.name).toBe("FallbackTtsProvider");
    expect(p?.name).toBe("sarvam");
    expect((p as FallbackTtsProvider & { providers: TtsProvider[] }).providers.map((x) => x.name)).toEqual([
      "sarvam",
      "azure",
      "openai",
    ]);
  });

  // The state this deploy actually lands in: a Sarvam key with no credits, so
  // the OpenAI link is the one that has to be there.
  it("keeps OpenAI in the chain behind Sarvam", async () => {
    const p = await resolveWith({ sarvamKey: "s" }, "sk-x");
    expect((p as FallbackTtsProvider & { providers: TtsProvider[] }).providers.map((x) => x.name)).toEqual([
      "sarvam",
      "openai",
    ]);
  });

  it("skips Azure when the region is missing — a key alone cannot address an endpoint", async () => {
    const p = await resolveWith({ azureKey: "a" }, "sk-x");
    expect(p?.name).toBe("openai");
  });

  it("returns a bare provider, not a chain, when only one vendor is configured", async () => {
    const p = await resolveWith({}, "sk-x");
    expect(p?.constructor.name).not.toBe("FallbackTtsProvider");
    expect(p?.name).toBe("openai");
  });

  it("disables voice rather than guessing when no vendor is configured", async () => {
    expect(await resolveWith({}, undefined)).toBeNull();
  });

  // Two Sarvam accounts: the backup is tried before dropping to a non-Indic
  // voice, because a second Sarvam key still sounds Telugu and Azure/OpenAI
  // are quality downgrades.
  it("puts a backup Sarvam key second, ahead of every non-Sarvam vendor", async () => {
    const p = await resolveWith(
      { sarvamKey: "primary", sarvamKeyBackup: "backup", azureKey: "a", azureRegion: "centralindia" },
      "sk-x"
    );
    expect(names(p)).toEqual(["sarvam", "sarvam-backup", "azure", "openai"]);
  });

  it("adds no phantom entry when only one Sarvam key is set", async () => {
    const p = await resolveWith({ sarvamKey: "primary" }, "sk-x");
    expect(names(p)).toEqual(["sarvam", "openai"]);
  });

  it("uses the backup alone if it is the only Sarvam key configured", async () => {
    const p = await resolveWith({ sarvamKeyBackup: "backup" }, "sk-x");
    expect(names(p)).toEqual(["sarvam-backup", "openai"]);
  });
});

describe("resolveStt — chain construction with two Sarvam keys", () => {
  async function resolveSttWith(overrides: Record<string, unknown>, openaiKey?: string) {
    vi.resetModules();
    vi.doMock("../src/config", () => ({
      config: {
        logLevel: "silent",
        speech: { enabled: true, sttModel: "gpt-4o-transcribe", sttSarvamModel: "saaras:v3", ...overrides },
        llm: { openai: { apiKey: openaiKey } },
      },
    }));
    const mod = await import("../src/lib/speech");
    mod.resetSpeechProviders();
    return mod.resolveStt();
  }

  afterEach(() => {
    vi.doUnmock("../src/config");
    vi.resetModules();
  });

  it("tries both Sarvam accounts before the general-purpose engine", async () => {
    const p = await resolveSttWith({ sarvamKey: "primary", sarvamKeyBackup: "backup" }, "sk-x");
    expect(names(p)).toEqual(["sarvam", "sarvam-backup", "openai"]);
  });

  it("falls back to OpenAI alone when no Sarvam key is configured", async () => {
    const p = await resolveSttWith({}, "sk-x");
    expect(p?.name).toBe("openai");
  });

  it("returns null when nothing can transcribe", async () => {
    expect(await resolveSttWith({}, undefined)).toBeNull();
  });
});

describe("FallbackSttProvider — a dead vendor must not lose a voice note", () => {
  const heard = (tag: string) => ({
    name: tag,
    transcribe: vi.fn().mockResolvedValue({ text: `heard by ${tag}` }),
  });
  const dead = (tag: string, err: string) => ({
    name: tag,
    transcribe: vi.fn().mockRejectedValue(new Error(err)),
  });

  it("uses the preferred vendor when it answers", async () => {
    const second = heard("openai");
    const p = new FallbackSttProvider([heard("sarvam"), second]);
    expect((await p.transcribe({ bytes: new Uint8Array([1]), mimeType: "audio/ogg" })).text).toBe(
      "heard by sarvam"
    );
    expect(second.transcribe).not.toHaveBeenCalled();
  });

  // A member will not repeat a voice note because a vendor ran out of credit.
  it("falls through so the voice note is still transcribed", async () => {
    const p = new FallbackSttProvider([dead("sarvam", "402 no credits"), heard("openai")]);
    expect((await p.transcribe({ bytes: new Uint8Array([1]), mimeType: "audio/ogg" })).text).toBe(
      "heard by openai"
    );
  });

  it("passes the language hint through to whichever vendor serves", async () => {
    const openai = heard("openai");
    const p = new FallbackSttProvider([dead("sarvam", "402"), openai]);
    await p.transcribe({ bytes: new Uint8Array([1]), mimeType: "audio/ogg" }, "te-IN");
    expect(openai.transcribe).toHaveBeenCalledWith(expect.anything(), "te-IN");
  });

  it("surfaces the last error when no vendor could hear it", async () => {
    const p = new FallbackSttProvider([dead("sarvam", "402"), dead("openai", "429 rate limit")]);
    await expect(
      p.transcribe({ bytes: new Uint8Array([1]), mimeType: "audio/ogg" })
    ).rejects.toThrow(/429 rate limit/);
  });
});

describe("SarvamSttProvider", () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

  it("sends the audio as multipart with the code-mix mode for saaras:v3", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ transcript: "kura mokkalu ela pencali" }));
    const p = new SarvamSttProvider("k", { fetchFn: fetchFn as unknown as typeof fetch });
    const out = await p.transcribe({ bytes: new Uint8Array([1, 2]), mimeType: "audio/ogg" });

    expect(out.text).toBe("kura mokkalu ela pencali");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("/speech-to-text");
    expect(init.headers["api-subscription-key"]).toBe("k");
    // fetch must own Content-Type so the multipart boundary is correct.
    expect(init.headers["Content-Type"]).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("model")).toBe("saaras:v3");
    expect(form.get("mode")).toBe("codemix");
  });

  it("omits the v3-only mode when pointed at a model that rejects it", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ transcript: "x" }));
    const p = new SarvamSttProvider("k", {
      model: "saaras:v4",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await p.transcribe({ bytes: new Uint8Array([1]), mimeType: "audio/ogg" });
    expect((fetchFn.mock.calls[0][1].body as FormData).get("mode")).toBeNull();
  });

  // language_probability scores WHICH LANGUAGE was detected, not how well the
  // words were heard. Reporting it as `confidence` would compare a 0-1
  // probability against a log-probability floor and always pass.
  it("reports no confidence, because Sarvam's score measures something else", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ transcript: "x", language_probability: 0.4 }));
    const p = new SarvamSttProvider("k", { fetchFn: fetchFn as unknown as typeof fetch });
    expect((await p.transcribe({ bytes: new Uint8Array([1]), mimeType: "audio/ogg" })).confidence)
      .toBeUndefined();
  });

  it("throws with the vendor status so the chain can fall through", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 402, text: async () => "no credits" } as Response);
    const p = new SarvamSttProvider("k", { fetchFn: fetchFn as unknown as typeof fetch });
    await expect(
      p.transcribe({ bytes: new Uint8Array([1]), mimeType: "audio/ogg" })
    ).rejects.toThrow(/402/);
  });
});

/**
 * Two Sarvam keys. Credits are the failure mode that actually bites (a valid
 * key on an exhausted account 402s on EVERY call), so a second key is the
 * cheapest real redundancy available — and it slots into the chain that
 * already exists rather than needing new machinery.
 */
describe("Sarvam providers — labelled so two keys are distinguishable", () => {
  const okTts = { ok: true, json: async () => ({ audios: ["QUJD"] }) } as unknown as Response;
  const okStt = { ok: true, json: async () => ({ transcript: "x" }) } as unknown as Response;

  it("defaults to the plain vendor name", () => {
    expect(new SarvamTtsProvider("k").name).toBe("sarvam");
    expect(new SarvamSttProvider("k").name).toBe("sarvam");
  });

  it("takes a label so logs and results name the KEY that served", () => {
    expect(new SarvamTtsProvider("k", { label: "sarvam-backup" }).name).toBe("sarvam-backup");
    expect(new SarvamSttProvider("k", { label: "sarvam-backup" }).name).toBe("sarvam-backup");
  });

  it("still sends each key on its own requests", async () => {
    const f1 = vi.fn().mockResolvedValue(okTts);
    const f2 = vi.fn().mockResolvedValue(okStt);
    await new SarvamTtsProvider("PRIMARY", { fetchFn: f1 as unknown as typeof fetch }).synthesize(
      "x",
      "te"
    );
    await new SarvamSttProvider("BACKUP", { fetchFn: f2 as unknown as typeof fetch }).transcribe({
      bytes: new Uint8Array([1]),
      mimeType: "audio/ogg",
    });
    expect(f1.mock.calls[0][1].headers["api-subscription-key"]).toBe("PRIMARY");
    expect(f2.mock.calls[0][1].headers["api-subscription-key"]).toBe("BACKUP");
  });

  // Without distinct names the chain cannot tell it fell through, so the
  // "served by fallback" signal silently disappears and AudioBytes.provider
  // reports "sarvam" no matter which key actually paid for the call.
  it("makes a key-to-key fallthrough visible in the result", async () => {
    const dead = {
      name: "sarvam",
      synthesize: vi.fn().mockRejectedValue(new Error("Sarvam TTS failed (402): no credits")),
    };
    const alive = {
      name: "sarvam-backup",
      synthesize: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), mimeType: "audio/wav" }),
    };
    const out = await new FallbackTtsProvider([dead, alive]).synthesize("x", "te");
    expect(out.provider).toBe("sarvam-backup");
  });
});

describe("sarvamKeys — misconfiguration guards", () => {
  async function ttsWith(overrides: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("../src/config", () => ({
      config: {
        logLevel: "silent",
        speech: { enabled: true, sarvamModel: "bulbul:v3", sarvamSpeaker: "shubh", ...overrides },
        llm: { openai: { apiKey: "sk-x" } },
      },
    }));
    const mod = await import("../src/lib/speech");
    mod.resetSpeechProviders();
    return mod.resolveTts();
  }

  afterEach(() => {
    vi.doUnmock("../src/config");
    vi.resetModules();
  });

  // Pasting the same key into both slots is an easy slip during a rotation.
  // Retrying an exhausted account against itself buys nothing but latency.
  it("collapses a backup key that is identical to the primary", async () => {
    expect(names(await ttsWith({ sarvamKey: "same", sarvamKeyBackup: "same" }))).toEqual([
      "sarvam",
      "openai",
    ]);
  });

  it("keeps both when the keys genuinely differ", async () => {
    expect(names(await ttsWith({ sarvamKey: "a", sarvamKeyBackup: "b" }))).toEqual([
      "sarvam",
      "sarvam-backup",
      "openai",
    ]);
  });

  // `name` identifies vendor AND account. Nothing branches on it today (only
  // logs and the chain's own fallthrough check), but if vendor-level logic is
  // ever added, every Sarvam account must remain recognisable as Sarvam.
  it("keeps every Sarvam account identifiable as Sarvam by prefix", async () => {
    for (const n of names(await ttsWith({ sarvamKey: "a", sarvamKeyBackup: "b" })).slice(0, 2)) {
      expect(n.startsWith("sarvam")).toBe(true);
    }
  });
});
