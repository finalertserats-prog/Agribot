import { logger } from "../logger";

/**
 * Provider-agnostic contract for the AI layer. Each backend (Gemini, OpenAI,
 * and any future provider) implements these three low-level primitives; all the
 * higher-level orchestration (prompt framing, farming classifier, profile
 * extraction, retry) lives above this interface and is shared across providers.
 */
export interface LLMProvider {
  /** Human-readable provider id, e.g. "gemini" or "openai". */
  readonly name: string;

  /** Single completion for a fully-assembled prompt. Returns the model's text. */
  generateText(prompt: string): Promise<string>;

  /**
   * Multimodal completion: a system/context prompt plus one image plus the
   * user's text instruction. Returns the model's text.
   */
  analyzeImage(
    systemPrompt: string,
    imageBytes: Uint8Array,
    mimeType: string,
    userText: string
  ): Promise<string>;

  /** Embed a single string into a dense vector for semantic memory. */
  embed(text: string): Promise<number[]>;
}

export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|quota|rate.?limit|too many requests/i.test(msg);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a provider call on transient rate-limit (429) errors with exponential
 * backoff. Non-rate-limit errors propagate immediately. Provider-agnostic —
 * both backends surface 429s in their error message, which isRateLimitError
 * matches.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) || i === attempts - 1) throw err;
      const delay = 1000 * 2 ** i;
      logger.warn({ attempt: i + 1, delay }, "LLM rate-limited — backing off");
      await sleep(delay);
    }
  }
  throw lastErr;
}
