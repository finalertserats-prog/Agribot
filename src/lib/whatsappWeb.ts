import qrcode from "qrcode-terminal";
import type { Client as WwebClient, Message as WwebMessage } from "whatsapp-web.js";
import { config } from "../config";
import { logger } from "./logger";
import { resolvePersona, isInPersonaScope } from "../config/personas";
import { escapeRegExp } from "./domain";
import { processMessage, type IncomingMessage, type Responder } from "../core/reply";
import { bump } from "../ops/metrics";

/**
 * Plan B group transport — whatsapp-web.js (Puppeteer / real headless Chrome).
 * A drop-in alternative to Baileys for the WhatsApp GROUP channel: same reply
 * core, same persona routing, same smart-auto-reply and non-fatal-disconnect
 * behavior. Selected via GROUP_TRANSPORT=whatsapp-web.
 *
 * whatsapp-web.js is loaded via DYNAMIC import so the (heavy) package + Chromium
 * are only required when this transport is actually chosen — the default Baileys
 * path and the VPS build stay untouched until you `npm install whatsapp-web.js`.
 *
 * Like the Baileys transport, a disconnect here does NOT exit the process: the
 * group channel simply stops and the Cloud 1:1 backbone keeps running.
 */
let started = false;

export async function connectWhatsAppWeb(): Promise<void> {
  if (started) return;
  started = true;

  let wweb: typeof import("whatsapp-web.js");
  try {
    wweb = await import("whatsapp-web.js");
  } catch (err) {
    logger.error(
      { err },
      "whatsapp-web.js not installed — run `npm install whatsapp-web.js` to use GROUP_TRANSPORT=whatsapp-web"
    );
    return;
  }
  const { Client, LocalAuth } = wweb;

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: `${config.authDir}_wweb` }),
    puppeteer: {
      headless: true,
      // Flags required to run Chromium as root in a container/VPS.
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  });

  let pairingRequested = false;

  client.on("qr", async (qr: string) => {
    // Prefer pairing code (no camera) when a number is configured; else QR.
    if (config.pairingNumber && !pairingRequested) {
      pairingRequested = true;
      try {
        const code = await client.requestPairingCode(config.pairingNumber);
        const pretty = code.match(/.{1,4}/g)?.join("-") ?? code;
        logger.info({ number: config.pairingNumber }, "[wweb] pairing code issued");
        console.log(
          `\n🔗 [whatsapp-web] Link WITHOUT a QR:\n\n    Pairing code:  ${pretty}\n\n` +
            `On ${config.pairingNumber}: WhatsApp → Settings → Linked Devices → ` +
            `Link a Device → "Link with phone number instead" → enter the code.\n`
        );
        return;
      } catch (err) {
        logger.error({ err }, "[wweb] pairing-code request failed — falling back to QR");
      }
    }
    logger.info("[wweb] scan the QR below to link the group number");
    console.log("\n📱 [whatsapp-web] Scan this QR with WhatsApp:\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => logger.info("[wweb] whatsapp-web.js connected — group transport live"));
  client.on("auth_failure", (m: string) => logger.error({ m }, "[wweb] auth failure"));

  // Non-fatal disconnect — mirror the Baileys isolation. Do NOT exit: the Cloud
  // 1:1 backbone shares this process. Group transport just stops until a restart.
  client.on("disconnected", (reason: string) => {
    logger.error(
      { reason },
      "[wweb] disconnected — group transport is OFF; Cloud 1:1 unaffected. Restart the process to re-link."
    );
  });

  client.on("message", async (msg: WwebMessage) => {
    try {
      await handleWebMessage(client, msg);
    } catch (err) {
      logger.error({ err }, "[wweb] message handler threw");
    }
  });

  await client.initialize();
}

/**
 * Adapt a whatsapp-web.js message into the shared reply core — group routing,
 * persona resolution, and smart auto-reply mirror the Baileys handler exactly.
 */
async function handleWebMessage(client: WwebClient, msg: WwebMessage): Promise<void> {
  bump("messages");

  const chat = await msg.getChat();
  const isGroup = chat.isGroup;
  const remoteJid = msg.from; // group chatId (…@g.us) or DM chatId (…@c.us)
  const senderId = isGroup ? msg.author ?? msg.from : msg.from;
  const contact = await msg.getContact();
  const pushName = contact.pushname || "Friend";
  let text = msg.body || "";
  const hasImage = msg.hasMedia && msg.type === "image";

  const persona = resolvePersona({
    groupName: isGroup ? chat.name : undefined,
    groupId: isGroup ? remoteJid : undefined,
  });

  // Group behavior: answer when tagged (trigger / persona name), else smart
  // auto-reply only for a clear gardening question in scope; silent otherwise.
  if (isGroup) {
    const lower = text.toLowerCase();
    const tagged =
      lower.includes(config.botTrigger.toLowerCase()) ||
      lower.includes(persona.displayName.toLowerCase());
    if (tagged) {
      text = text
        .replace(new RegExp(escapeRegExp(config.botTrigger), "gi"), "")
        .replace(new RegExp(escapeRegExp(persona.displayName), "gi"), "")
        .trim();
      if (!text && !hasImage) {
        await client.sendMessage(
          remoteJid,
          `🌱 Namaste ${pushName}! I'm ${persona.displayName}. Ask me anything about your plants — sowing, growth, flowering, pests!`
        );
        return;
      }
    } else if (!text || !isInPersonaScope(persona, text)) {
      return;
    }
  }

  const incoming: IncomingMessage = {
    userId: senderId,
    remoteJid,
    displayName: pushName,
    text,
    hasImage,
    loadImage: async () => {
      const media = await msg.downloadMedia();
      if (!media?.data) return null;
      const bytes = new Uint8Array(Buffer.from(media.data, "base64"));
      if (bytes.length > config.maxImageBytes) {
        logger.warn({ size: bytes.length }, "[wweb] image exceeds size limit — skipping");
        return null;
      }
      return { bytes, mimeType: media.mimetype };
    },
    persona,
  };

  const responder: Responder = {
    send: async (t: string) => {
      await client.sendMessage(remoteJid, t);
    },
  };

  await processMessage(incoming, responder);
}
