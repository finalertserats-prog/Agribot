import { proto, WASocket, downloadContentFromMessage, DownloadableMessage } from "@whiskeysockets/baileys";
import { config } from "./config";
import { logger } from "./lib/logger";
import { extractTextFromMessage, escapeRegExp } from "./lib/domain";
import { bump } from "./ops/metrics";
import { processMessage, type IncomingMessage, type Responder } from "./core/reply";

// Re-exported so index.ts (shutdown drain) and the test suite keep importing
// them from the handler even though the state now lives in the shared core.
export { backgroundTasks, resetForTests } from "./core/reply";

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

/**
 * Baileys transport adapter: parses the WhatsApp Web wire format (including
 * group trigger handling — a Baileys-only concern) and hands a normalized
 * message to the shared reply core.
 */
export async function handleMessage(
  socket: WASocket,
  msg: proto.IWebMessageInfo,
  isGroup: boolean,
  senderJid: string,
  _groupName?: string
): Promise<void> {
  // Strict split: when configured, Baileys serves ONLY groups (1:1 has moved to
  // the Cloud API number). Prevents any chance of two transports answering the
  // same farmer once the migration is complete.
  if (!isGroup && config.baileysGroupsOnly) return;

  bump("messages");
  let text = extractTextFromMessage(msg);
  const hasImage = !!msg.message?.imageMessage;
  const remoteJid = msg.key.remoteJid!;
  const pushName = msg.pushName || "Farmer";

  // Group: only respond if triggered or DM. This is Baileys-specific — the
  // Cloud API transport never sees group messages.
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

  const incoming: IncomingMessage = {
    userId: senderJid,
    remoteJid,
    displayName: pushName,
    text,
    hasImage,
    loadImage: () => downloadImage(msg),
  };

  const responder: Responder = {
    send: async (t: string) => {
      await socket.sendMessage(remoteJid, { text: t });
    },
  };

  await processMessage(incoming, responder);
}
