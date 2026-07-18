import { proto, WASocket, downloadContentFromMessage, DownloadableMessage } from "@whiskeysockets/baileys";
import { config } from "./config";
import { logger } from "./lib/logger";
import { generateTextResponse, analyzeImage, isFarmingTopic, extractProfile } from "./lib/gemini";
import {
  upsertUser,
  getUser,
  updateUserProfile,
  saveInteraction,
  getRecentInteractions,
  isOptedOut,
  setOptOut,
  clearOptOut,
  deleteUserData,
} from "./lib/database";
import { isOptOutMessage, isResumeMessage, isDeleteMessage } from "./policy/consent";
import { storeMemory, queryMemory, deleteUserMemories } from "./lib/memory";
import {
  FARMING_ONLY_REPLY,
  isFarmingRelated,
  extractTextFromMessage,
  escapeRegExp,
} from "./lib/domain";
import { RateLimiter } from "./lib/rateLimiter";
import { bump } from "./ops/metrics";

const rateLimiter = new RateLimiter(config.rateLimitPerMinute);
const globalMinuteLimiter = new RateLimiter(config.globalRateLimitPerMinute, 60_000);
const globalDayLimiter = new RateLimiter(config.globalRateLimitPerDay, 24 * 60 * 60_000);
// Periodically release memory held for idle users. Unref'd so it never keeps
// the process (or a test runner) alive.
setInterval(() => {
  rateLimiter.sweep();
  globalMinuteLimiter.sweep();
  globalDayLimiter.sweep();
}, 5 * 60_000).unref();

// Farmers who just issued DELETE. A message that was already in-flight when the
// erasure ran must not re-create their data afterwards (persistAndEnrich checks
// this and skips). Entries auto-expire so the guard can't grow unbounded.
const recentlyErased = new Map<string, number>();
const ERASURE_GUARD_MS = 60_000;
function markErased(jid: string): void {
  recentlyErased.set(jid, Date.now() + ERASURE_GUARD_MS);
}
function wasRecentlyErased(jid: string): boolean {
  const exp = recentlyErased.get(jid);
  if (exp === undefined) return false;
  if (Date.now() > exp) {
    recentlyErased.delete(jid);
    return false;
  }
  return true;
}

// Track fire-and-forget persistence so shutdown can await it before flushing.
export const backgroundTasks = new Set<Promise<void>>();
function trackBackground(task: Promise<void>): void {
  backgroundTasks.add(task);
  // .catch is essential: an unhandled rejection here would crash the process
  // (and crash-loop under PM2). persistAndEnrich already handles its own
  // errors, but this is the last-resort guard on the tracking chain.
  void task
    .catch((err) => logger.error({ err }, "Background persistence task failed"))
    .finally(() => backgroundTasks.delete(task));
}

async function downloadImage(
  msg: proto.IWebMessageInfo
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const m = msg.message;
  if (!m?.imageMessage) return null;

  try {
    // Must pass the media message (imageMessage: {mediaKey,directPath,url}),
    // not the whole IMessage — the latter lacks those fields and the download
    // silently fails. Guarded above, so imageMessage is defined here.
    const stream = await downloadContentFromMessage(
      m.imageMessage as unknown as DownloadableMessage,
      "image"
    );
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > config.maxImageBytes) {
        logger.warn({ size: total }, "Image exceeds size limit — aborting download");
        return null;
      }
      chunks.push(chunk);
    }
    return {
      bytes: new Uint8Array(Buffer.concat(chunks)),
      mimeType: m.imageMessage.mimetype || "image/jpeg",
    };
  } catch (err) {
    logger.error({ err }, "Image download failed");
    return null;
  }
}

/** Runs after replying — non-critical persistence/enrichment, never blocks the reply. */
async function persistAndEnrich(
  senderJid: string,
  remoteJid: string,
  pushName: string,
  text: string,
  response: string,
  hasImage: boolean
): Promise<void> {
  // If this farmer issued DELETE while this (older) message was still being
  // processed, don't re-create the data we just erased.
  if (wasRecentlyErased(senderJid)) return;

  try {
    saveInteraction(senderJid, remoteJid, pushName, text || "[image]", response, hasImage);
  } catch (err) {
    logger.error({ err }, "saveInteraction failed (non-critical)");
  }

  try {
    const memText = `User ${pushName}: ${text || "[shared a plant image]"} | AgriFriend: ${response}`;
    await storeMemory(memText, senderJid, remoteJid);
  } catch (err) {
    logger.warn({ err }, "Memory store failed (non-critical)");
  }

  // Opportunistic profile extraction — only for text with real content.
  if (text && text.trim().length > 10) {
    try {
      const profile = await extractProfile(text);
      if (profile.name || profile.phone || profile.plants || profile.issues || profile.location) {
        updateUserProfile(senderJid, profile);
      }
    } catch (err) {
      logger.warn({ err }, "Profile extraction failed (non-critical)");
    }
  }
}

export async function handleMessage(
  socket: WASocket,
  msg: proto.IWebMessageInfo,
  isGroup: boolean,
  senderJid: string,
  _groupName?: string
): Promise<void> {
  bump("messages");
  let text = extractTextFromMessage(msg);
  const hasImage = !!msg.message?.imageMessage;
  const remoteJid = msg.key.remoteJid!;
  const pushName = msg.pushName || "Farmer";

  // Group: only respond if triggered or DM
  if (isGroup) {
    const triggered =
      text.toLowerCase().includes(config.botTrigger.toLowerCase()) ||
      text.includes("@" + config.botTrigger);
    if (!triggered) return;

    // Strip the trigger word / mentions and use the cleaned text downstream so
    // "agrifriend"/@mentions don't pollute the classifier and the model prompt.
    text = text
      .replace(new RegExp(escapeRegExp(config.botTrigger), "gi"), "")
      .replace(/@\S+/g, "")
      .trim();
    if (!text && !hasImage) {
      await socket.sendMessage(remoteJid, {
        text: `🌱 Namaste ${pushName}! I'm Agri-Dosth, your farming friend. Ask me anything about your crops, soil, or plant health — I'm here to help!`,
      });
      return;
    }
  }

  // Whether this is the farmer's very first message (checked before any upsert)
  // so we can send the one-time consent/onboarding notice to new contacts.
  const isNewContact = !getUser(senderJid);

  // Data erasure (DELETE) — honored before everything else, even for opted-out
  // users, so a farmer can always exercise their right to be forgotten (DPDP).
  if (text && isDeleteMessage(text)) {
    // Guard first so any in-flight message for this farmer can't re-persist
    // their data after we erase it.
    markErased(senderJid);
    await deleteUserData(senderJid);
    await deleteUserMemories(senderJid);
    await socket.sendMessage(remoteJid, {
      text: `🗑️ Done, ${pushName}. I've erased everything I had about you. Message me anytime to start fresh — I'm always here to help. 🌱\n— Agri-Dosth`,
    });
    return;
  }

  // Consent / opt-out gate — honored before any AI spend and durable across
  // restarts (backed by the optouts table). An opted-out farmer hears nothing
  // from us until they explicitly resume, so a "STOP" is respected even if the
  // process crashes and WhatsApp redelivers the message on reconnect.
  if (isOptedOut(senderJid)) {
    if (text && isResumeMessage(text)) {
      await clearOptOut(senderJid);
      await socket.sendMessage(remoteJid, {
        text: `🌱 Welcome back, ${pushName}! Good to hear from you again. Ask me anything about your crops or farm. (Reply STOP anytime to unsubscribe.)\n— Agri-Dosth`,
      });
    }
    // Opted out and not resuming → stay silent; replying would defeat the opt-out.
    return;
  }

  if (text && isOptOutMessage(text)) {
    // Persist the opt-out to disk BEFORE confirming, so the promise we make the
    // farmer ("you won't receive further replies") is durable across a restart.
    await setOptOut(senderJid);
    await socket.sendMessage(remoteJid, {
      text: `👋 You've been unsubscribed, ${pushName}. I won't message you further. Reply START anytime to come back — take care! 🌱\n— Agri-Dosth`,
    });
    return;
  }

  // First-contact consent/onboarding — sent BEFORE any AI spend (classifier,
  // model) so a new farmer sees who they're talking to and how to control their
  // data (STOP/DELETE) before we process their message. One-time (a returning
  // contact already has a user row).
  if (isNewContact) {
    try {
      await socket.sendMessage(remoteJid, { text: config.consentMessage });
    } catch (err) {
      logger.warn({ err }, "Failed to send consent notice (non-critical)");
    }
  }

  // Rate limit the expensive AI path (per user) BEFORE any Gemini call —
  // including the guardrail classifier below — so off-topic spam that misses
  // the keyword filter can't burn quota on the classifier.
  if (!rateLimiter.allow(senderJid)) {
    logger.info({ senderJid }, "Rate limit hit — throttling user");
    await socket.sendMessage(remoteJid, {
      text: "🌱 One moment please — I'm catching up on messages. Try again in a minute!",
    });
    return;
  }

  // Global cost ceiling across ALL users — a hard cap on total Gemini spend so a
  // flood of distinct users can't bypass the per-user limit and run up the bill.
  // Peek both limiters first, then consume both only if both pass, so a rejected
  // request never burns one bucket's budget.
  const nowMs = Date.now();
  if (
    !globalMinuteLimiter.wouldAllow("global", nowMs) ||
    !globalDayLimiter.wouldAllow("global", nowMs)
  ) {
    logger.warn("Global Gemini rate ceiling hit — deferring reply");
    await socket.sendMessage(remoteJid, {
      text: "🌱 We're very busy right now — please try again a little later!",
    });
    return;
  }
  globalMinuteLimiter.allow("global", nowMs);
  globalDayLimiter.allow("global", nowMs);

  // Domain guardrail — keyword fast-path (free), model fallback on a miss.
  // Images bypass entirely so Gemini can analyze the photo.
  if (!hasImage && text) {
    if (!isFarmingRelated(text) && !(await isFarmingTopic(text))) {
      // In groups the user explicitly triggered us, so a short reply is fine.
      await socket.sendMessage(remoteJid, { text: FARMING_ONLY_REPLY });
      return;
    }
  }

  upsertUser(senderJid, pushName, remoteJid);

  // Assemble context: recent history + vector memory + profile.
  const contextParts: string[] = [];

  const recent = getRecentInteractions(senderJid, 3);
  if (recent.length > 0) {
    const history = recent
      .map((r) => `User said: "${r.message}" | You replied: "${r.response}"`)
      .join("\n");
    contextParts.push(`Recent conversation history:\n${history}`);
  }

  try {
    const memoryResults = await queryMemory(text || "plant photo", senderJid);
    if (memoryResults.length > 0) {
      contextParts.push(`Past memories about this user:\n${memoryResults.join("\n")}`);
    }
  } catch (err) {
    logger.debug({ err }, "Memory query failed (non-critical)");
  }

  const user = getUser(senderJid);
  if (user) {
    const profile = [];
    // Only treat a real name as known — the "Farmer" fallback means we still
    // don't know it, so the model should ask (per the system prompt).
    const knownName = user.name && user.name !== "Farmer" ? user.name : "";
    if (knownName) profile.push(`Name: ${knownName}`);
    if (user.phone) profile.push(`Phone: ${user.phone}`);
    if (user.plants) profile.push(`Growing: ${user.plants}`);
    if (user.issues) profile.push(`Past issues: ${user.issues}`);
    if (user.location) profile.push(`Location: ${user.location}`);
    if (profile.length > 0) {
      contextParts.push(`User profile:\n${profile.join(", ")}`);
    }
  }

  const context = contextParts.length > 0 ? contextParts.join("\n\n") : undefined;

  let response: string;

  try {
    if (hasImage) {
      const imageData = await downloadImage(msg);
      if (imageData) {
        response = await analyzeImage(imageData.bytes, imageData.mimeType, text || undefined, context);
      } else {
        response = "I couldn't process the image. Could you try sending it again? 📷";
      }
    } else {
      response = await generateTextResponse(text, context);
    }
  } catch (err) {
    bump("errors");
    logger.error({ err }, "Gemini generation failed");
    response = "I'm having trouble processing that right now. Please try again in a moment. 🌱";
  }

  // Start persistence BEFORE sending so a transient send failure can't cost us
  // the interaction/memory/profile. It's tracked so shutdown can drain it.
  trackBackground(
    persistAndEnrich(senderJid, remoteJid, pushName, text, response, hasImage)
  );

  try {
    await socket.sendMessage(remoteJid, { text: response });
  } catch (err) {
    logger.error({ err }, "Failed to send WhatsApp reply");
  }
}

/** Reset limiter + background state between tests. */
export function resetForTests(): void {
  rateLimiter.reset();
  globalMinuteLimiter.reset();
  globalDayLimiter.reset();
  backgroundTasks.clear();
  recentlyErased.clear();
}
