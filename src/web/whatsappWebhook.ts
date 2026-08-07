import crypto from "crypto";
import express, { type Router, type Request } from "express";
import { logger } from "../lib/logger";
import { SeenCache } from "../lib/seen";
import {
  DeliverySuppressedError,
  isDeliverySuppressed,
  processMessage,
  type IncomingMessage,
  type Responder,
} from "../core/reply";
import { resolvePersona, isInPersonaScope } from "../config/personas";
import { config } from "../config";
import type { CloudConfig } from "../config";
import {
  detectLanguage,
  LOW_CONFIDENCE_LOGPROB,
  resolveStt,
  resolveTts,
  shouldSendVoiceReply,
} from "../lib/speech";
import { buildSpokenText } from "../lib/speech/spoken";
import { toWhatsAppVoice } from "../lib/audio";
import { startTyping } from "../lib/typing";

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
  /** Media id of an inbound voice note / audio message, when one was sent. */
  audioId?: string;
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
  /** Generic media download (voice notes). Optional so older fakes still satisfy the type. */
  fetchMedia?(
    mediaId: string,
    maxBytes: number,
    fallbackMime: string
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  /** Upload synthesized audio, returning a media id. Optional — absence disables voice replies. */
  uploadMedia?(bytes: Uint8Array, mimeType: string, filename: string): Promise<string | null>;
  /** Send an uploaded audio media id as a voice note. Optional — see uploadMedia. */
  sendAudio?(to: string, mediaId: string, isGroup?: boolean): Promise<void>;
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
        } else if ((m.type === "audio" || m.type === "voice") && m.audio?.id) {
          // Voice notes arrive as type "audio" with voice:true. Both carry the
          // same media id, and members send either, so accept both. `text` is
          // filled in later from the transcript.
          out.push({
            waId,
            name,
            messageId,
            text: "",
            hasImage: false,
            audioId: m.audio.id,
            mimeType: m.audio.mime_type || "audio/ogg",
            groupId,
          });
        }
        // Other types (location, sticker, ...) are intentionally skipped.
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
    // One member's message must never cost another theirs. Everything inside
    // dispatchOne is already guarded, but a webhook payload can carry several
    // messages and an unforeseen throw here would skip every one after it.
    await dispatchOne(m, messenger).catch((err) =>
      logger.error({ err, messageId: m.messageId }, "[cloud] dispatch failed for one message")
    );
  }
}

/**
 * One inbound message, start to finish: show that we're working on it,
 * understand it, answer it, and deliver the answer in the order that reads best
 * to the member — voice note first, then the full text.
 */
async function dispatchOne(m: InboundCloudMessage, messenger: CloudMessenger): Promise<void> {
  const target = m.groupId ?? m.waId;
  const isGroup = Boolean(m.groupId);

  // Human touch (1:1): mark the message read (blue ticks) and keep "typing…" on
  // screen for as long as we are actually working — through transcription, the
  // model, and building the voice note. Started BEFORE anything slow: a voice
  // note takes seconds to transcribe, and the member should see us reading it
  // rather than watching nothing happen. Best-effort throughout; a group chat
  // has no indicator, so it gets an inert handle.
  const typing = isGroup ? null : startTyping(messenger, m.messageId, target);

  try {
    await answerOne(m, messenger, target, isGroup, () => typing?.stop());
  } finally {
    typing?.stop();
  }
}

async function answerOne(
  m: InboundCloudMessage,
  messenger: CloudMessenger,
  target: string,
  isGroup: boolean,
  stopTyping: () => void
): Promise<void> {
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
      return; // untagged group chit-chat — stay silent (already marked seen)
    }
  }

  // Voice note in → transcribe before anything else, so the rest of the
  // pipeline (persona scope, memory, policy) sees a normal text question.
  if (m.audioId) {
    const transcript = await transcribeInbound(m, messenger);
    if (!transcript) {
      // Tell the member rather than going silent — an ignored voice note is
      // indistinguishable from a broken bot. Unless they opted out while we
      // were listening to it, in which case silence is what they asked for:
      // transcription takes seconds, and this notice never passed the core's
      // consent gate on its way here.
      if (isDeliverySuppressed(m.waId)) return;
      await messenger
        .sendText(
          target,
          "Voice note andukunnanu, kaani ardham cheskoleka poyanu 🙏 Malli try cheyyandi, leda text lo type chesi pampandi.",
          isGroup
        )
        .catch((err) => logger.warn({ err }, "[cloud] voice-failure notice not sent"));
      return;
    }
    m.text = transcript;
    logger.info({ chars: transcript.length }, "[speech] voice note transcribed");
  }

  const incoming: IncomingMessage = {
    userId: m.waId, // the participant (group) or the user (1:1)
    remoteJid: target, // reply target: the group, or the user
    displayName: m.name,
    text: m.text,
    hasImage: m.hasImage,
    loadImage: async () => (m.imageId ? messenger.fetchImage(m.imageId) : null),
    persona,
  };

  // Voice reply when the member spoke first OR asked for one in words ("voice
  // lo cheppandi"), and never when they asked for text only. Decided from the
  // transcript, so it is settled before the answer exists.
  const wantsVoice = shouldSendVoiceReply(m.text, Boolean(m.audioId));

  // Did the member actually receive anything this turn? Counts the voice note
  // too — otherwise a text send that fails AFTER the audio landed would trip
  // the "nothing arrived" notice and apologise for a message they just got.
  let delivered = 0;

  const responder: Responder = {
    // Interstitials — consent, rate limit, off-topic. Straight out, no audio:
    // "please try again in a minute" is not worth a voice note.
    //
    // Deliberately NOT gated on isDeliverySuppressed. The STOP and DELETE
    // confirmations come through here *after* the opt-out has been recorded,
    // so the member is suppressed by the time we owe them the one message that
    // says so. Gating this would swallow exactly those confirmations.
    send: async (t: string) => {
      await messenger.sendText(target, t, isGroup);
      delivered += 1;
    },

    // THE answer. Voice note first, then the full text — the member hears the
    // gist in a few seconds and reads the detail underneath, which is what
    // makes it feel like a person answering rather than a document arriving.
    sendFinal: async (t: string) => {
      if (wantsVoice) {
        const spoke = await speakAnswer(t, target, isGroup, m.waId, messenger, stopTyping);
        if (spoke) delivered += 1;
      }
      // Last compliance gate. Building the voice note can take half a minute,
      // and a STOP or DELETE that arrived during it must be honoured.
      if (isDeliverySuppressed(m.waId)) throw new DeliverySuppressedError();
      stopTyping();
      await messenger.sendText(target, t, isGroup);
      delivered += 1;
    },
  };

  try {
    await processMessage(incoming, responder);
  } catch (err) {
    // A refused delivery is the opt-out policy working. The core normally
    // absorbs it; catching it here too means no future caller can turn a
    // member's STOP into an unsolicited apology.
    if (err instanceof DeliverySuppressedError) {
      logger.info({ messageId: m.messageId }, "[cloud] delivery suppressed mid-send");
      return;
    }
    logger.error({ err, messageId: m.messageId }, "[cloud] processMessage failed");
    // If it threw before ANYTHING reached the member, they are staring at
    // silence and cannot tell a crash from a slow answer. Say something —
    // unless they have since opted out, when an apology is still one more
    // message they asked not to receive.
    if (delivered === 0 && !isDeliverySuppressed(m.waId)) {
      await messenger
        .sendText(
          target,
          "Kshaminchandi 🙏 oka technical problem vachindi. Konchem sepu tarvata malli try cheyyandi.",
          isGroup
        )
        .catch((e) => logger.warn({ err: e }, "[cloud] failure notice not sent either"));
    }
  }
}

/** Voice notes are small; 20MB is generous and still bounds a hostile upload. */
const MAX_VOICE_NOTE_BYTES = 20 * 1024 * 1024;

/**
 * Download and transcribe an inbound voice note. Returns null on any failure —
 * callers surface that to the member rather than replying to silence.
 */
async function transcribeInbound(
  m: InboundCloudMessage,
  messenger: CloudMessenger
): Promise<string | null> {
  const stt = resolveStt();
  if (!stt || !messenger.fetchMedia) {
    logger.warn("[speech] voice note received but transcription is not configured");
    return null;
  }
  try {
    const audio = await messenger.fetchMedia(m.audioId!, MAX_VOICE_NOTE_BYTES, "audio/ogg");
    if (!audio) return null;
    const { text, confidence } = await stt.transcribe(audio);
    const trimmed = text.trim();
    // A transcript of one or two characters is noise (a cough, a misfire), not
    // a question — answering it produces a confusing non-sequitur.
    if (trimmed.length <= 1) return null;

    // Heard something, but not well enough to act on. Answering a garbled
    // transcript is worse than admitting we missed it: the member gets a long,
    // confident answer to a question they never asked. `undefined` means the
    // vendor gave no confidence signal — that is not a low score, so it passes.
    if (confidence !== undefined && confidence < LOW_CONFIDENCE_LOGPROB) {
      logger.warn(
        { confidence, chars: trimmed.length },
        "[speech] transcript below confidence floor — asking the member to repeat"
      );
      return null;
    }
    return trimmed;
  } catch (err) {
    logger.error({ err }, "[speech] transcription failed");
    return null;
  }
}

/**
 * Speak the answer, ahead of the text.
 *
 * Summarize for the ear, synthesize, transcode to the exact OGG/Opus WhatsApp
 * needs for a playable voice-note bubble, upload, send. Returns whether the
 * member actually heard something.
 *
 * Best-effort from end to end and bounded in time: the text reply is queued up
 * behind this, so a wedged vendor must cost the member a voice note, never the
 * answer itself. Every failure path returns false and the text follows normally.
 */
async function speakAnswer(
  replyText: string,
  target: string,
  isGroup: boolean,
  userId: string,
  messenger: CloudMessenger,
  stopTyping: () => void
): Promise<boolean> {
  if (!config.speech.enabled) return false;
  const tts = resolveTts();
  if (!tts || !messenger.uploadMedia || !messenger.sendAudio) return false;

  const startedAt = Date.now();
  try {
    const built = await withTimeout(
      buildVoiceNote(replyText, tts, messenger),
      config.speech.buildTimeoutMs
    );
    if (!built) return false;

    // The member may have sent STOP or DELETE while we were synthesizing.
    if (isDeliverySuppressed(userId)) {
      logger.info({ userId }, "[speech] member opted out mid-build — not sending the voice note");
      return false;
    }

    // Drop the indicator before the audio lands: WhatsApp dismisses it on send
    // anyway, and a refresh arriving a moment later would show "typing…" over a
    // voice note that is already on screen.
    stopTyping();
    await messenger.sendAudio!(target, built.mediaId, isGroup);
    logger.info(
      {
        provider: built.provider,
        bytes: built.bytes,
        summarized: built.summarized,
        ms: Date.now() - startedAt,
      },
      "[speech] voice reply sent ahead of the text"
    );
    return true;
  } catch (err) {
    logger.warn(
      { err, ms: Date.now() - startedAt },
      "[speech] voice reply failed — sending the text answer now"
    );
    return false;
  }
}

interface BuiltVoiceNote {
  mediaId: string;
  provider: string;
  bytes: number;
  summarized: boolean;
}

/** Summarize → synthesize → transcode → upload. Null when there's nothing to send. */
async function buildVoiceNote(
  replyText: string,
  tts: NonNullable<ReturnType<typeof resolveTts>>,
  messenger: CloudMessenger
): Promise<BuiltVoiceNote | null> {
  const spoken = await buildSpokenText(replyText);
  if (!spoken.text) return null;

  const raw = await tts.synthesize(spoken.text, detectLanguage(spoken.text));
  const voice = await toWhatsAppVoice(raw);
  const mediaId = await messenger.uploadMedia!(voice.bytes, "audio/ogg", "reply.ogg");
  if (!mediaId) return null;

  return {
    mediaId,
    provider: raw.provider ?? tts.name,
    bytes: voice.bytes.byteLength,
    summarized: spoken.summarized,
  };
}

/**
 * Stop waiting after `ms`.
 *
 * Deliberately a race, not a cancellation: the vendor calls underneath carry
 * their own timeouts, and there is no way to un-send an HTTP request already in
 * flight. Whatever finishes late is simply discarded — the point is to bound
 * how long the member waits for their text, not to save the work.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const bell = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`voice note build exceeded ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, bell]).finally(() => clearTimeout(timer));
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
