import { config } from "../config";
import { logger } from "../lib/logger";
import {
  generateTextResponse,
  analyzeImage,
  isFarmingTopic,
  extractProfile,
} from "../lib/gemini";
import {
  upsertUser,
  getUser,
  updateUserProfile,
  saveInteraction,
  getRecentInteractions,
} from "../lib/database";
import { storeMemory, queryMemory } from "../lib/memory";
import { isFarmingRelated, FARMING_ONLY_REPLY } from "../lib/domain";
import { RateLimiter } from "../lib/rateLimiter";

// Same cost guards as the WhatsApp path — the web page is public, so per-session
// and global ceilings protect the AI bill from abuse.
const perSession = new RateLimiter(config.rateLimitPerMinute);
const globalMinute = new RateLimiter(config.globalRateLimitPerMinute, 60_000);
const globalDay = new RateLimiter(config.globalRateLimitPerDay, 24 * 60 * 60_000);

setInterval(() => {
  perSession.sweep();
  globalMinute.sweep();
  globalDay.sweep();
}, 5 * 60_000).unref();

export interface WebChatInput {
  sessionId: string;
  name?: string;
  message: string;
  imageBytes?: Uint8Array;
  mimeType?: string;
}

const DEFAULT_NAME = "Web Farmer";

/**
 * Web-chat turn — reuses the exact Agri-Dosth AI brain (system prompt, provider,
 * RAG memory, guardrail, rate limits) as the WhatsApp handler, keyed by a
 * browser session id instead of a WhatsApp JID.
 */
export async function webChat(input: WebChatInput): Promise<{ reply: string }> {
  const { sessionId } = input;
  const text = (input.message || "").trim();
  const hasImage = !!input.imageBytes;

  if (!perSession.allow(sessionId)) {
    return { reply: "🌱 One moment please — you're sending a lot quickly. Try again in a minute!" };
  }
  const now = Date.now();
  if (!globalMinute.wouldAllow("global", now) || !globalDay.wouldAllow("global", now)) {
    return { reply: "🌱 We're very busy right now — please try again a little later!" };
  }
  globalMinute.allow("global", now);
  globalDay.allow("global", now);

  // Farming-only guardrail (text). Images bypass so photos can be analyzed.
  if (!hasImage && text) {
    if (!isFarmingRelated(text) && !(await isFarmingTopic(text))) {
      return { reply: FARMING_ONLY_REPLY };
    }
  }

  upsertUser(sessionId, input.name?.trim() || DEFAULT_NAME, "web");

  // Assemble context — recent history + vector memory + profile (mirrors the
  // WhatsApp handler so replies are just as personalized).
  const parts: string[] = [];
  const recent = getRecentInteractions(sessionId, 3);
  if (recent.length > 0) {
    parts.push(
      "Recent conversation history:\n" +
        recent.map((r) => `User said: "${r.message}" | You replied: "${r.response}"`).join("\n")
    );
  }
  try {
    const mem = await queryMemory(text || "plant photo", sessionId);
    if (mem.length > 0) parts.push("Past memories about this user:\n" + mem.join("\n"));
  } catch (err) {
    logger.debug({ err }, "web memory query failed (non-critical)");
  }
  const user = getUser(sessionId);
  if (user) {
    const p: string[] = [];
    const knownName = user.name && user.name !== DEFAULT_NAME ? user.name : "";
    if (knownName) p.push(`Name: ${knownName}`);
    if (user.plants) p.push(`Growing: ${user.plants}`);
    if (user.issues) p.push(`Past issues: ${user.issues}`);
    if (user.location) p.push(`Location: ${user.location}`);
    if (p.length > 0) parts.push("User profile:\n" + p.join(", "));
  }
  const context = parts.length > 0 ? parts.join("\n\n") : undefined;

  let reply: string;
  try {
    reply = hasImage
      ? await analyzeImage(input.imageBytes!, input.mimeType || "image/jpeg", text || undefined, context)
      : await generateTextResponse(text, context);
  } catch (err) {
    logger.error({ err }, "web chat generation failed");
    reply = "I'm having trouble processing that right now. Please try again in a moment. 🌱";
  }

  // Persist — interaction synchronously (local write), memory + profile
  // enrichment fire-and-forget so the reply returns fast.
  try {
    saveInteraction(sessionId, "web", user?.name || DEFAULT_NAME, text || "[image]", reply, hasImage);
  } catch (err) {
    logger.warn({ err }, "web saveInteraction failed (non-critical)");
  }
  void storeMemory(
    `User: ${text || "[shared a plant image]"} | Agri-Dosth: ${reply}`,
    sessionId,
    "web"
  ).catch((err) => logger.warn({ err }, "web memory store failed (non-critical)"));
  if (text && text.trim().length > 10) {
    void extractProfile(text)
      .then((profile) => {
        if (profile.name || profile.plants || profile.issues || profile.location) {
          updateUserProfile(sessionId, profile);
        }
      })
      .catch((err) => logger.warn({ err }, "web profile extraction failed (non-critical)"));
  }

  return { reply };
}
