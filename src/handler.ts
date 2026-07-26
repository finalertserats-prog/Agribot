import { proto, WASocket, downloadContentFromMessage, DownloadableMessage } from "@whiskeysockets/baileys";
import { config } from "./config";
import { logger } from "./lib/logger";
import { extractTextFromMessage, escapeRegExp } from "./lib/domain";
import { resolvePersona, isInPersonaScope } from "./config/personas";
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
  groupName?: string
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

  // Which persona answers here — routed by the group's name/JID (1:1 uses the
  // default). Drives the trigger word, greeting, scope and member-ID prefix.
  const persona = resolvePersona({
    groupName,
    groupId: isGroup ? remoteJid : undefined,
  });

  // Group behavior (Baileys-only — the Cloud API never sees groups):
  //   • tagged (trigger word / @mention / persona name) → always answer;
  //   • otherwise SMART auto-reply — answer only a clear gardening question in
  //     this persona's scope, and stay silent on chit-chat so we never spam the
  //     group or burn LLM budget on off-topic banter.
  if (isGroup) {
    const lower = text.toLowerCase();
    const tagged =
      lower.includes(config.botTrigger.toLowerCase()) ||
      text.includes("@" + config.botTrigger) ||
      lower.includes(persona.displayName.toLowerCase());

    if (tagged) {
      // Strip the trigger word / persona name / @mentions so they don't pollute
      // the classifier and the model prompt.
      text = text
        .replace(new RegExp(escapeRegExp(config.botTrigger), "gi"), "")
        .replace(new RegExp(escapeRegExp(persona.displayName), "gi"), "")
        .replace(/@\S+/g, "")
        .trim();
      if (!text && !hasImage) {
        await socket.sendMessage(remoteJid, {
          text: `🌱 Namaste ${pushName}! I'm ${persona.displayName}. Ask me anything about your plants — sowing, growth, flowering, pests — I'm here to help!`,
        });
        return;
      }
    } else if (!text || !isInPersonaScope(persona, text)) {
      // Untagged chit-chat, or an untagged image with no gardening caption →
      // stay silent. Only a clearly gardening question earns an auto-reply.
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
    persona,
  };

  const responder: Responder = {
    send: async (t: string) => {
      await socket.sendMessage(remoteJid, { text: t });
    },
  };

  await processMessage(incoming, responder);
}
