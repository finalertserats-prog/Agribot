import OpenAI from "openai";
import type { LLMProvider } from "./types";

/** Reasoning depth for gpt-5-family models. See OPENAI_REASONING_EFFORT. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * OpenAI backend. One chat model serves both text and vision (the default,
 * gpt-4o-mini, is multimodal), plus a dedicated embeddings model.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly textModel: string;
  private readonly embedModel: string;
  private readonly reasoningEffort?: ReasoningEffort;

  constructor(
    apiKey: string,
    textModel: string,
    embedModel: string,
    reasoningEffort?: ReasoningEffort
  ) {
    this.client = new OpenAI({ apiKey });
    this.textModel = textModel;
    this.embedModel = embedModel;
    this.reasoningEffort = reasoningEffort;
  }

  /**
   * Spread into a chat-completions call. Empty unless an effort is configured:
   * `reasoning_effort` is a reasoning-model parameter, and sending it to a
   * non-reasoning model (gpt-4.1, gpt-4o) is a 400, so an unset value must
   * produce no key at all rather than an explicit undefined.
   */
  private reasoningParam(): { reasoning_effort?: ReasoningEffort } {
    return this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {};
  }

  async generateText(prompt: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.textModel,
      messages: [{ role: "user", content: prompt }],
      ...this.reasoningParam(),
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
      ...this.reasoningParam(),
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
