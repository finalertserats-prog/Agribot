import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  isJidGroup,
  jidNormalizedUser,
  proto,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { config } from "../config";
import { logger } from "./logger";
import { SeenCache } from "./seen";

export type MessageHandler = (
  socket: WASocket,
  msg: proto.IWebMessageInfo,
  isGroup: boolean,
  senderJid: string,
  groupName?: string
) => Promise<void>;

let socket: WASocket;

// Drop duplicate deliveries — Baileys can redeliver messages on resync.
const seenMessages = new SeenCache(1000);

// Reconnect backoff state (reset on a successful "open").
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
const MAX_BACKOFF_MS = 60_000;

export async function connectWhatsApp(
  onMessage: MessageHandler
): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  // If reconnecting, detach handlers from the previous socket so listeners
  // and sockets don't accumulate across reconnects (the original leak).
  if (socket) {
    try {
      socket.ev.removeAllListeners("creds.update");
      socket.ev.removeAllListeners("connection.update");
      socket.ev.removeAllListeners("messages.upsert");
    } catch (err) {
      logger.warn({ err }, "Failed to detach previous socket listeners");
    }
  }

  socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: config.logLevel }),
    browser: ["AgriFriend Bot", "Chrome", "1.0.0"],
    generateHighQualityLinkPreview: false,
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("Scan the QR code below with WhatsApp to link the bot");
      console.log("\n📱 Scan this QR code with WhatsApp:\n");
      qrcode.generate(qr, { small: true });
      console.log("\nOpen WhatsApp → Settings → Linked Devices → Link a Device\n");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        // Ignore additional close events while a reconnect is already pending,
        // so we never queue multiple concurrent reconnects (each of which would
        // detach listeners from a newer, healthy socket).
        if (reconnectTimer) return;
        const delay = Math.min(
          1000 * 2 ** reconnectAttempts,
          MAX_BACKOFF_MS
        );
        reconnectAttempts++;
        logger.warn(
          { statusCode, delay, attempt: reconnectAttempts },
          "Connection closed — reconnecting after backoff"
        );
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectWhatsApp(onMessage).catch((err) =>
            logger.error({ err }, "Reconnect attempt failed")
          );
        }, delay);
      } else {
        logger.error("Logged out. Delete auth_info/ and scan the QR again.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      reconnectAttempts = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      logger.info("AgriFriend is connected to WhatsApp");
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe === true) continue;

      const msgId = msg.key.id;
      if (msgId && seenMessages.check(msgId)) continue;

      const isGroup = isJidGroup(msg.key.remoteJid!) as boolean;
      const senderJid = jidNormalizedUser(
        isGroup ? msg.key.participant! : msg.key.remoteJid!
      );

      let groupName: string | undefined;
      if (isGroup) {
        try {
          const metadata = await socket.groupMetadata(msg.key.remoteJid!);
          groupName = metadata.subject;
        } catch {
          groupName = undefined;
        }
      }

      try {
        await onMessage(socket, msg, isGroup, senderJid, groupName);
      } catch (err) {
        logger.error({ err, msgId }, "Message handler threw");
      }
    }
  });

  return socket;
}

export function getSocket(): WASocket {
  return socket;
}
