import OpenAI from "openai";
import type { LLMProvider } from "./types";

/**
 * OpenAI backend. One chat model serves both text and vision (the default,
 * gpt-4o-mini, is multimodal), plus a dedicated embeddings model.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly textModel: string;
  private readonly embedModel: string;

  constructor(apiKey: string, textModel: string, embedModel: string) {
    this.client = new OpenAI({ apiKey });
    this.textModel = textModel;
    this.embedModel = embedModel;
  }

  async generateText(prompt: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.textModel,
      messages: [{ role: "user", content: prompt }],
    });
    return res.choices[0]?.message?.content ?? "";
  }

  async analyzeImage(
    systemPrompt: string,
    imageBytes: Uint8Array,
    mimeType: string,
    userText: string
  ): Promise<string> {
    const dataUrl = `data:${mimeType};base64,${Buffer.from(imageBytes).toString("base64")}`;
    const res = await this.client.chat.completions.create({
      model: this.textModel,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.embedModel,
      input: text,
    });
    return res.data[0].embedding;
  }
}
