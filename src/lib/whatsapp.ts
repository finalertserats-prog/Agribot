import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  isJidGroup,
  jidNormalizedUser,
  proto,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { logger } from "./logger";
import { SeenCache } from "./seen";
import { atomicWrite, createDebouncedSaver, type DebouncedSaver } from "./persist";
import { bump } from "../ops/metrics";
import { notify } from "../ops/notifier";

export type MessageHandler = (
  socket: WASocket,
  msg: proto.IWebMessageInfo,
  isGroup: boolean,
  senderJid: string,
  groupName?: string
) => Promise<void>;

let socket: WASocket;

// Cache of group JID → subject (name), used for persona routing. Group subjects
// change rarely, so a single metadata fetch per group is enough; a failed fetch
// caches undefined briefly so we don't hammer the API for a group we can't read.
const groupNameCache = new Map<string, { name?: string; at: number }>();
const GROUP_NAME_TTL_MS = 60 * 60_000; // refresh at most hourly

async function resolveGroupName(sock: WASocket, jid: string): Promise<string | undefined> {
  const cached = groupNameCache.get(jid);
  if (cached && Date.now() - cached.at < GROUP_NAME_TTL_MS) return cached.name;
  try {
    const meta = await sock.groupMetadata(jid);
    groupNameCache.set(jid, { name: meta.subject, at: Date.now() });
    return meta.subject;
  } catch (err) {
    logger.debug({ err, jid }, "groupMetadata fetch failed — routing by JID/default");
    groupNameCache.set(jid, { name: undefined, at: Date.now() });
    return undefined;
  }
}

// Drop duplicate deliveries — Baileys can redeliver messages on resync AND on
// restart. The cache is persisted so a restart (e.g. after a crash) doesn't
// reprocess and double-reply to redelivered messages.
const SEEN_CAPACITY = 1000;
const seenMessages = new SeenCache(SEEN_CAPACITY);
const seenPath = path.join(config.dataDir, "seen.json");
let seenSaver: DebouncedSaver | null = null;
let dedupLoaded = false;

function initDedup(): void {
  if (dedupLoaded) return;
  try {
    if (fs.existsSync(seenPath)) {
      const ids = JSON.parse(fs.readFileSync(seenPath, "utf-8"));
      if (Array.isArray(ids)) seenMessages.seed(ids.filter((x) => typeof x === "string"));
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load persisted dedup cache; starting empty");
  }
  seenSaver = createDebouncedSaver(
    async () => atomicWrite(seenPath, JSON.stringify(seenMessages.snapshot())),
    config.persistDebounceMs
  );
  // Only mark loaded after the saver is wired, so a failure mid-init can retry
  // on the next reconnect rather than disabling persistence permanently.
  dedupLoaded = true;
}

/** Flush the dedup cache to disk. Call on graceful shutdown. */
export async function flushSeen(): Promise<void> {
  if (seenSaver) await seenSaver.flush();
}

// Pin the current WhatsApp Web protocol version. Without this Baileys uses a
// hardcoded default that WhatsApp can reject with a 405 handshake failure as the
// protocol drifts. Fetched once and cached for the process lifetime; a short
// timeout keeps a slow/hung fetch off the reconnect critical path, and a failed
// fetch simply retries on the next reconnect (falling back to the lib default).
let cachedWaVersion: Awaited<ReturnType<typeof fetchLatestBaileysVersion>>["version"] | undefined;

async function resolveWaVersion(): Promise<typeof cachedWaVersion> {
  if (cachedWaVersion) return cachedWaVersion;
  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("version fetch timed out")), 5000).unref();
    });
    const { version } = await Promise.race([fetchLatestBaileysVersion(), timeout]);
    cachedWaVersion = version;
    logger.info({ version }, "Using WhatsApp Web version");
  } catch (err) {
    logger.warn({ err }, "Could not fetch latest WhatsApp version — using library default");
  }
  return cachedWaVersion;
}

// Reconnect backoff state (reset on a successful "open").
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
const MAX_BACKOFF_MS = 60_000;

// Schedule a reconnect with exponential backoff. Ignores duplicate requests
// while one is pending, and retries again if the reconnect attempt itself fails
// (so a single failed reconnect can't leave the bot permanently offline).
function scheduleReconnect(onMessage: MessageHandler): void {
  if (reconnectTimer) return;
  bump("reconnects");
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_BACKOFF_MS);
  reconnectAttempts++;
  logger.warn({ delay, attempt: reconnectAttempts }, "Scheduling reconnect after backoff");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWhatsApp(onMessage).catch((err) => {
      logger.error({ err }, "Reconnect attempt failed — retrying");
      scheduleReconnect(onMessage);
    });
  }, delay);
  // NOTE: intentionally NOT unref'd. During a reconnect backoff the WhatsApp
  // socket is closed, so this timer is often the only thing keeping the process
  // alive — unref'ing it makes Node exit mid-backoff instead of reconnecting.
  // Graceful shutdown calls process.exit() explicitly, so it isn't blocked.
}

export async function connectWhatsApp(
  onMessage: MessageHandler
): Promise<WASocket> {
  initDedup();
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

  const version = await resolveWaVersion();

  socket = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    printQRInTerminal: false,
    logger: pino({ level: config.logLevel }),
    browser: ["AgriFriend Bot", "Chrome", "1.0.0"],
    generateHighQualityLinkPreview: false,
  });

  socket.ev.on("creds.update", saveCreds);

  // Pairing-code linking (no QR): if configured and this device isn't yet
  // registered, request an 8-digit code the operator types into WhatsApp
  // ("Link with phone number instead"). Ideal for headless/VPS setup where
  // pointing a camera at a terminal QR isn't practical. Falls back to the QR
  // flow if the request fails.
  if (config.pairingNumber && !socket.authState.creds.registered) {
    try {
      const code = await socket.requestPairingCode(config.pairingNumber);
      const pretty = code.match(/.{1,4}/g)?.join("-") ?? code;
      logger.info({ number: config.pairingNumber }, "Pairing code issued — link within a few minutes");
      console.log(
        `\n🔗 Link WhatsApp WITHOUT a QR:\n\n    Pairing code:  ${pretty}\n\n` +
          `On ${config.pairingNumber}: WhatsApp → Settings → Linked Devices → ` +
          `Link a Device → "Link with phone number instead" → enter the code.\n`
      );
    } catch (err) {
      logger.error({ err }, "Pairing-code request failed — falling back to QR");
    }
  }

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
        logger.warn({ statusCode }, "Connection closed — will reconnect");
        scheduleReconnect(onMessage);
      } else {
        // Logged out (401): the saved creds are now dead. Clear them BEFORE
        // exiting so the process manager's restart comes up on a fresh QR
        // instead of reloading the invalid session and getting logged out
        // again — that reload loop hammers WhatsApp and worsens flagging.
        logger.error(
          "Logged out by WhatsApp — clearing the session so the next start shows a fresh QR to re-link."
        );
        try {
          fs.rmSync(config.authDir, { recursive: true, force: true });
        } catch (err) {
          logger.error({ err }, "Failed to clear auth dir after logout");
        }
        // Alert the operator (logs always; POSTs to OPS_WEBHOOK_URL if set) that a
        // human must re-scan the QR. Exit only after the alert attempt resolves so
        // the webhook has a chance to fire before the process dies.
        void notify({
          level: "critical",
          reason:
            "WhatsApp logged the bot out — re-link needed. Run `pm2 logs agrifriend` and scan the fresh QR.",
          at: new Date().toISOString(),
        }).finally(() => process.exit(1));
        return;
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

      // In-memory dedup drops live redeliveries immediately (prevents concurrent
      // double-processing). We only PERSIST the id after successful processing,
      // so a handler throw + restart lets the redelivered message be retried
      // rather than suppressed forever.
      const msgId = msg.key.id;
      if (msgId && seenMessages.check(msgId)) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue; // malformed key — nothing to reply to

      const isGroup = isJidGroup(remoteJid) as boolean;
      const participant = isGroup ? msg.key.participant : remoteJid;
      if (!participant) continue; // group message without a sender — skip
      const senderJid = jidNormalizedUser(participant);

      // Group name drives persona routing. Resolve it once per group and cache
      // it (subjects rarely change) so we don't fetch metadata on every message.
      const groupName = isGroup ? await resolveGroupName(socket, remoteJid) : undefined;

      try {
        await onMessage(socket, msg, isGroup, senderJid, groupName);
        if (msgId) seenSaver?.schedule(); // persist only processed ids
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
