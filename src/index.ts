import { proto, WASocket, downloadContentFromMessage, DownloadableMessage } from "@whiskeysockets/baileys";
import { config } from "./config";
import { logger } from "./lib/logger";
import { connectWhatsApp } from "./lib/whatsapp";
import {
  initGemini,
  generateTextResponse,
  analyzeImage,
  isFarmingTopic,
  extractProfile,
} from "./lib/gemini";
import {
  initDB,
  upsertUser,
  getUser,
  updateUserProfile,
  saveInteraction,
  getRecentInteractions,
  flushDB,
} from "./lib/database";
import { initMemory, storeMemory, queryMemory, flushMemory } from "./lib/memory";
import {
  FARMING_ONLY_REPLY,
  isFarmingRelated,
  extractTextFromMessage,
  escapeRegExp,
} from "./lib/domain";
import { RateLimiter } from "./lib/rateLimiter";

const rateLimiter = new RateLimiter(config.rateLimitPerMinute);
// Periodically release memory held for idle users.
setInterval(() => rateLimiter.sweep(), 5 * 60_000).unref();

// Track fire-and-forget persistence so shutdown can await it before flushing.
const backgroundTasks = new Set<Promise<void>>();
function trackBackground(task: Promise<void>): void {
  backgroundTasks.add(task);
  void task.finally(() => backgroundTasks.delete(task));
}

async function downloadImage(
  msg: proto.IWebMessageInfo
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const m = msg.message;
  if (!m?.imageMessage) return null;

  try {
    const stream = await downloadContentFromMessage(m as DownloadableMessage, "image");
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
  saveInteraction(senderJid, remoteJid, pushName, text || "[image]", response, hasImage);

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
      if (profile.plants || profile.issues || profile.location) {
        updateUserProfile(senderJid, profile);
      }
    } catch (err) {
      logger.warn({ err }, "Profile extraction failed (non-critical)");
    }
  }
}

async function handleMessage(
  socket: WASocket,
  msg: proto.IWebMessageInfo,
  isGroup: boolean,
  senderJid: string,
  _groupName?: string
): Promise<void> {
  const text = extractTextFromMessage(msg);
  const hasImage = !!msg.message?.imageMessage;
  const remoteJid = msg.key.remoteJid!;
  const pushName = msg.pushName || "Farmer";

  // Group: only respond if triggered or DM
  if (isGroup) {
    const triggered =
      text.toLowerCase().includes(config.botTrigger.toLowerCase()) ||
      text.includes("@" + config.botTrigger);
    if (!triggered) return;

    const cleanText = text
      .replace(new RegExp(escapeRegExp(config.botTrigger), "gi"), "")
      .replace(/@\S+/g, "")
      .trim();
    if (!cleanText && !hasImage) {
      await socket.sendMessage(remoteJid, {
        text: `🌱 Hi ${pushName}! Ask me anything about farming, gardening, or plant health!`,
      });
      return;
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

function registerShutdown(): void {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down — draining background work and flushing state");
    try {
      // Let in-flight persistence schedule its writes, but bound the wait so a
      // stuck Gemini/network call can't hang past PM2/systemd stop timeouts.
      // Tasks that finish within the window have already scheduled their writes,
      // so the flush below captures them; any still running past the bound are
      // logged as possible loss rather than lost silently.
      let timedOut = false;
      const drainTimeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, 5000).unref()
      );
      await Promise.race([Promise.allSettled([...backgroundTasks]), drainTimeout]);
      if (timedOut && backgroundTasks.size > 0) {
        logger.warn(
          { pending: backgroundTasks.size },
          "Drain timed out — some background writes may not have persisted"
        );
      }
      await Promise.all([flushDB(), flushMemory()]);
      process.exit(0);
    } catch (err) {
      // A flush failure means state may not have persisted — exit non-zero so
      // PM2/operators see the failure rather than a clean exit hiding data loss.
      logger.error({ err }, "Failed to flush state on shutdown — possible data loss");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  logger.info("AgriFriend Bot — starting up");

  await initDB();
  logger.info("Database initialized");

  initGemini();
  logger.info("Gemini AI connected");

  initMemory();
  logger.info("RAG memory system ready");

  registerShutdown();

  await connectWhatsApp(handleMessage);
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
