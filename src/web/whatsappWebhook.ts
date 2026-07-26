import crypto from "crypto";
import express, { type Router, type Request } from "express";
import { logger } from "../lib/logger";
import { SeenCache } from "../lib/seen";
import { processMessage, type IncomingMessage, type Responder } from "../core/reply";
import { resolvePersona, isInPersonaScope } from "../config/personas";
import { config } from "../config";
import type { CloudConfig } from "../config";

/** A normalized inbound message pulled out of Meta's webhook payload. */
export interface InboundCloudMessage {
  waId: string;
  name: string;
  messageId: string;
  /** Text body, or an image caption. Empty string when neither is present. */
  text: string;
  hasImage: boolean;
  imageId?: string;
  mimeType?: string;
  /** Present ONLY for official Groups API messages — the group's id. When set,
   *  waId is the participant who spoke and the reply must go to this group. */
  groupId?: string;
}

/** Outbound side of the Cloud transport — implemented by WhatsAppCloudTransport. */
export interface CloudMessenger {
  /** `isGroup` sends with recipient_type=group (official Groups API); the `to`
   *  is then a group id, not a wa_id. */
  sendText(to: string, text: string, isGroup?: boolean): Promise<void>;
  fetchImage(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  /** Mark read + show a "typing…" indicator (human-feel). Best-effort/no-throw. */
  markReadAndTyping?(messageId: string): Promise<void>;
}

interface VerifyQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

/**
 * GET handshake: Meta calls this once when you save the webhook. Echo the
 * challenge back verbatim ONLY when the mode is "subscribe" and the token we
 * chose matches — otherwise anyone could register our endpoint.
 */
export function verifyWebhook(q: VerifyQuery, cfg: CloudConfig): { status: number; body: string } {
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === cfg.verifyToken) {
    return { status: 200, body: q["hub.challenge"] ?? "" };
  }
  return { status: 403, body: "Forbidden" };
}

/**
 * Validate Meta's X-Hub-Signature-256 header against the RAW request body using
 * the app secret. Constant-time compare so we don't leak the signature via
 * timing. A missing/short/malformed header fails closed.
 */
export function isValidSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  appSecret: string
): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  // timingSafeEqual throws on length mismatch — guard first (a malformed hex
  // header can decode to the wrong length).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Pull the text/image messages out of a Meta webhook payload, tolerating the
 * many shapes it can take (status receipts, unsupported types, malformed
 * bodies) without throwing — a webhook handler must never 500 on bad input.
 */
export function parseInboundMessages(payload: unknown): InboundCloudMessage[] {
  const out: InboundCloudMessage[] = [];
  const entries = (payload as any)?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = entry?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue; // status/delivery webhooks have no messages

      // Build a wa_id -> name lookup from the contacts array.
      const names = new Map<string, string>();
      if (Array.isArray(value?.contacts)) {
        for (const c of value.contacts) {
          if (c?.wa_id) names.set(c.wa_id, c?.profile?.name || "Farmer");
        }
      }

      for (const m of messages) {
        const waId = m?.from;
        const messageId = m?.id;
        if (!waId || !messageId) continue;
        const name = names.get(waId) || "Farmer";

        // Official Groups API messages carry a group_id; 1:1 messages don't.
        const groupId = typeof m.group_id === "string" ? m.group_id : undefined;
        if (m.type === "text" && m.text?.body) {
          out.push({ waId, name, messageId, text: m.text.body, hasImage: false, groupId });
        } else if (m.type === "image" && m.image?.id) {
          out.push({
            waId,
            name,
            messageId,
            text: m.image.caption || "",
            hasImage: true,
            imageId: m.image.id,
            mimeType: m.image.mime_type || "image/jpeg",
            groupId,
          });
        }
        // Other types (audio, location, sticker, ...) are intentionally skipped.
      }
    }
  }
  return out;
}

/**
 * Route parsed messages into the shared reply core, deduping Meta retries by
 * message id and binding a Responder to the Cloud messenger's sendText.
 */
export async function dispatchInbound(
  messages: InboundCloudMessage[],
  messenger: CloudMessenger,
  seen: SeenCache
): Promise<void> {
  for (const m of messages) {
    if (seen.check(m.messageId)) {
      logger.debug({ messageId: m.messageId }, "[cloud] duplicate webhook message — skipping");
      continue;
    }

    // Official Groups API message → route by group; else 1:1 by the number.
    const persona = resolvePersona({
      groupId: m.groupId,
      phoneNumberId: config.cloud?.phoneNumberId,
    });

    // Smart auto-reply in an official group pod: answer only when tagged
    // (trigger / persona name) or when the message is a gardening question in
    // scope — mirrors the Baileys group behavior so pods aren't spammed.
    if (m.groupId && !m.hasImage) {
      const lower = m.text.toLowerCase();
      const tagged =
        lower.includes(config.botTrigger.toLowerCase()) ||
        lower.includes(persona.displayName.toLowerCase());
      if (!tagged && !isInPersonaScope(persona, m.text)) {
        continue; // untagged group chit-chat — stay silent (already marked seen above)
      }
    }

    const incoming: IncomingMessage = {
      userId: m.waId, // the participant (group) or the user (1:1)
      remoteJid: m.groupId ?? m.waId, // reply target: the group, or the user
      displayName: m.name,
      text: m.text,
      hasImage: m.hasImage,
      loadImage: async () => (m.imageId ? messenger.fetchImage(m.imageId) : null),
      persona,
    };

    const responder: Responder = {
      send: async (t: string) => {
        // Group replies go to the group id with recipient_type=group.
        await messenger.sendText(m.groupId ?? m.waId, t, Boolean(m.groupId));
      },
    };

    // Human touch (1:1): mark the message read (blue ticks) + show "typing…"
    // while CTG Admn thinks. Best-effort — fired-and-forgotten so it never
    // delays or blocks the actual reply.
    if (!m.groupId) void messenger.markReadAndTyping?.(m.messageId);

    try {
      await processMessage(incoming, responder);
    } catch (err) {
      logger.error({ err, messageId: m.messageId }, "[cloud] processMessage failed");
    }
  }
}

/**
 * Express router for the WhatsApp Cloud API webhook. GET verifies the
 * subscription; POST authenticates the signature, ACKs Meta immediately (must
 * be fast), then processes messages out of band.
 */
export function createWhatsAppWebhook(cfg: CloudConfig, messenger: CloudMessenger): Router {
  const router = express.Router();
  // Bounded dedup across Meta retries. In-memory: a restart may reprocess a
  // very recent message, but processMessage is idempotent enough (dedup guards
  // the expensive path) that this is acceptable for the pilot.
  const seen = new SeenCache(2000);

  router.get("/webhook/whatsapp", (req, res) => {
    const { status, body } = verifyWebhook(req.query as VerifyQuery, cfg);
    res.status(status).send(body);
  });

  // Capture the raw body for signature verification (json() alone discards it).
  const rawJson = express.json({
    limit: "1mb",
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  });

  router.post("/webhook/whatsapp", rawJson, (req: Request & { rawBody?: Buffer }, res) => {
    const sig = req.header("x-hub-signature-256");
    if (!isValidSignature(req.rawBody ?? Buffer.alloc(0), sig, cfg.appSecret)) {
      logger.warn("[cloud] webhook signature check failed — rejecting");
      res.sendStatus(403);
      return;
    }

    // ACK immediately — Meta retries aggressively if we're slow, which would
    // cause duplicate processing. Do the real work after responding.
    res.sendStatus(200);

    const messages = parseInboundMessages(req.body);
    if (messages.length === 0) return;
    void dispatchInbound(messages, messenger, seen).catch((err) =>
      logger.error({ err }, "[cloud] dispatch failed")
    );
  });

  return router;
}
