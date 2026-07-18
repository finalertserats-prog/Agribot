import { config } from "../../config";
import { logger } from "../logger";
import type { LLMProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";

export type { LLMProvider } from "./types";
export { withRetry, isRateLimitError } from "./types";

let provider: LLMProvider | null = null;

/** Construct the provider selected in config. Kept separate for testability. */
function build(): LLMProvider {
  const llm = config.llm;
  if (llm.provider === "openai") {
    return new OpenAIProvider(llm.openai.apiKey!, llm.openai.textModel, llm.openai.embedModel);
  }
  return new GeminiProvider(llm.gemini.apiKey!, llm.gemini.textModel, llm.gemini.embedModel);
}

/**
 * The active AI provider. Lazily built on first use from config, so callers
 * (handler, memory) never need to know which backend is configured.
 */
export function getProvider(): LLMProvider {
  if (!provider) provider = build();
  return provider;
}

/** Eagerly initialize the provider at startup and log which one is active. */
export function initProvider(): void {
  provider = build();
  logger.info({ provider: provider.name }, "AI provider connected");
}

/** Reset the memoized provider — test-only, so a test can switch backends. */
export function resetProviderForTests(): void {
  provider = null;
}
