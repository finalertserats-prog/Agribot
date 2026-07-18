import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import type { LLMProvider } from "./types";

/**
 * Google Gemini backend. Uses one generative model for text + vision and a
 * separate embedding model, matching Gemini's API shape.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly genModel: GenerativeModel;
  private readonly embedModel: GenerativeModel;

  constructor(apiKey: string, textModel: string, embedModel: string) {
    const genAI = new GoogleGenerativeAI(apiKey);
    this.genModel = genAI.getGenerativeModel({ model: textModel });
    this.embedModel = genAI.getGenerativeModel({ model: embedModel });
  }

  async generateText(prompt: string): Promise<string> {
    const result = await this.genModel.generateContent(prompt);
    return result.response.text();
  }

  async analyzeImage(
    systemPrompt: string,
    imageBytes: Uint8Array,
    mimeType: string,
    userText: string
  ): Promise<string> {
    const imagePart = {
      inlineData: {
        data: Buffer.from(imageBytes).toString("base64"),
        mimeType,
      },
    };
    const result = await this.genModel.generateContent([
      systemPrompt,
      imagePart,
      { text: userText },
    ]);
    return result.response.text();
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedModel.embedContent(text);
    return result.embedding.values;
  }
}
