import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveProviderName } from "../src/config";

describe("resolveProviderName — provider selection", () => {
  it("auto-selects gemini when only a Gemini key is present", () => {
    expect(resolveProviderName({ GEMINI_API_KEY: "g" })).toBe("gemini");
  });

  it("auto-selects openai when only an OpenAI key is present", () => {
    expect(resolveProviderName({ OPENAI_API_KEY: "o" })).toBe("openai");
  });

  it("prefers gemini when both keys are present and no override", () => {
    expect(resolveProviderName({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" })).toBe("gemini");
  });

  it("honors an explicit LLM_PROVIDER override when that key exists", () => {
    expect(
      resolveProviderName({ LLM_PROVIDER: "openai", GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" })
    ).toBe("openai");
  });

  it("returns null when LLM_PROVIDER is forced but its key is missing", () => {
    expect(resolveProviderName({ LLM_PROVIDER: "openai", GEMINI_API_KEY: "g" })).toBeNull();
  });

  it("returns null when no key is configured", () => {
    expect(resolveProviderName({})).toBeNull();
  });
});

// ---- OpenAIProvider (mock the openai SDK) ----
const { createMock, embedMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  embedMock: vi.fn(),
}));
vi.mock("openai", () => ({
  default: vi.fn(() => ({
    chat: { completions: { create: createMock } },
    embeddings: { create: embedMock },
  })),
}));

import { OpenAIProvider } from "../src/lib/llm/openai";

describe("OpenAIProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unwraps chat completion text", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: "grow okra 🌱" } }] });
    const p = new OpenAIProvider("k", "gpt-4o-mini", "text-embedding-3-small");
    expect(await p.generateText("hi")).toBe("grow okra 🌱");
  });

  it("returns empty string when the model yields no content", async () => {
    createMock.mockResolvedValue({ choices: [{ message: {} }] });
    const p = new OpenAIProvider("k", "gpt-4o-mini", "text-embedding-3-small");
    expect(await p.generateText("hi")).toBe("");
  });

  it("sends the image as a base64 data URL for vision", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: "healthy plant" } }] });
    const p = new OpenAIProvider("k", "gpt-4o-mini", "text-embedding-3-small");
    const out = await p.analyzeImage("system", new Uint8Array([1, 2, 3]), "image/jpeg", "check this");
    expect(out).toBe("healthy plant");
    const arg = createMock.mock.calls[0][0];
    const imagePart = arg.messages[1].content.find((c: any) => c.type === "image_url");
    expect(imagePart.image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("unwraps the embedding vector", async () => {
    embedMock.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    const p = new OpenAIProvider("k", "gpt-4o-mini", "text-embedding-3-small");
    expect(await p.embed("note")).toEqual([0.1, 0.2, 0.3]);
  });
});

// ---- GeminiProvider (mock the Google SDK) ----
const { genContent, embedContent } = vi.hoisted(() => ({
  genContent: vi.fn(),
  embedContent: vi.fn(),
}));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: () => ({ generateContent: genContent, embedContent }),
  })),
}));

import { GeminiProvider } from "../src/lib/llm/gemini";

describe("GeminiProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unwraps generateContent text", async () => {
    genContent.mockResolvedValue({ response: { text: () => "use compost" } });
    const p = new GeminiProvider("k", "gemini-2.0-flash", "text-embedding-004");
    expect(await p.generateText("hi")).toBe("use compost");
  });

  it("unwraps the embedding values", async () => {
    embedContent.mockResolvedValue({ embedding: { values: [1, 0, 0] } });
    const p = new GeminiProvider("k", "gemini-2.0-flash", "text-embedding-004");
    expect(await p.embed("note")).toEqual([1, 0, 0]);
  });
});
