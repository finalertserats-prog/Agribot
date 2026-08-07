import { config } from "../config";
import { logger } from "../lib/logger";
import { generateTextResponse, analyzeImage, isFarmingTopic, extractProfile } from "../lib/gemini";
import {
  upsertUser,
  getUser,
  updateUserProfile,
  saveInteraction,
  markInteractionDelivered,
  getRecentInteractions,
  isOptedOut,
  setOptOut,
  clearOptOut,
  deleteUserData,
} from "../lib/database";
import { isOptOutMessage, isResumeMessage, isDeleteMessage } from "../policy/consent";
import { storeMemory, queryMemory, deleteUserMemories } from "../lib/memory";
import { getDefaultPersona, isInPersonaScope, type Persona } from "../config/personas";
import { RateLimiter } from "../lib/rateLimiter";
import { bump } from "../ops/metrics";

/**
 * A normalized inbound message, decoupled from any transport (Baileys / Cloud
 * API / web). The transport is responsible for parsing its own wire format
 * (including group trigger handling) and producing this shape.
 */
export interface IncomingMessage {
  /** Stable per-user key — Baileys senderJid or Cloud API wa_id. */
  userId: string;
  /** Conversation id used for persistence context (a group jid or the DM jid). */
  remoteJid: string;
  /** Display name for greetings / stored interactions. */
  displayName: string;
  /** Message text, already trigger-stripped by the transport. */
  text: string;
  hasImage: boolean;
  /** Lazily fetch the image bytes — only called when we're about to analyze it. */
  loadImage: () => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  /** Which persona should answer, resolved by the transport from the group /
   *  number this message arrived on. Defaults to the default persona. */
  persona?: Persona;
}

/** How the core sends a reply back — the transport binds this to its channel. */
export interface Responder {
  /**
   * Send an interstitial: a consent notice, a rate-limit note, an off-topic
   * redirect. Goes out immediately, on its own.
   */
  send(text: string): Promise<void>;
  /**
   * Send THE answer — the one message this turn exists to deliver.
   *
   * Separate from `send` so a transport can treat it differently: the Cloud
   * transport speaks it as a voice note before delivering the text, which it
   * must not do for a "please try again in a minute". A transport that has no
   * such distinction simply omits this and the core falls back to `send`.
   *
   * Must resolve only once the text has actually left, and must throw if it
   * has not — the delivery ledger and the transport's failure notice both key
   * off that.
   */
  sendFinal?(text: string): Promise<void>;
}

const rateLimiter = new RateLimiter(config.rateLimitPerMinute);
const globalMinuteLimiter = new RateLimiter(config.globalRateLimitPerMinute, 60_000);
const globalDayLimiter = new RateLimiter(config.globalRateLimitPerDay, 24 * 60 * 60_000);
// Periodically release memory held for idle users. Unref'd so it never keeps
// the process (or a test runner) alive.
setInterval(() => {
  rateLimiter.sweep();
  globalMinuteLimiter.sweep();
  globalDayLimiter.sweep();
  sweepErased();
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
// Drop expired erasure guards even for users who never message again, so the
// map can't grow unbounded (wasRecentlyErased only cleans on re-check).
function sweepErased(): void {
  const now = Date.now();
  for (const [jid, exp] of recentlyErased) {
    if (now > exp) recentlyErased.delete(jid);
  }
}

/**
 * Must nothing at all be delivered to this user right now?
 *
 * True when they erased their data or opted out. Exported because the send is
 * no longer instantaneous: a transport that spends half a minute building a
 * voice note before it delivers has to re-ask this question on the way out,
 * or a STOP that arrives during the build gets answered anyway.
 */
export function isDeliverySuppressed(userId: string): boolean {
  return wasRecentlyErased(userId) || isOptedOut(userId);
}

/**
 * Raised by a transport that stopped mid-delivery because the member opted out
 * or erased their data while the reply was being prepared. Distinct from a send
 * failure: nothing went wrong, so nobody should be told a technical problem
 * occurred and nothing should be marked delivered.
 */
export class DeliverySuppressedError extends Error {
  constructor() {
    super("delivery suppressed — the member opted out or erased mid-flight");
    this.name = "DeliverySuppressedError";
  }
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

/**
 * Write the turn and hand back its row id. Synchronous on purpose, and kept
 * separate from `enrich` below: the id has to be in hand before the send so a
 * success can be recorded the instant it happens. Chaining that off the slow
 * enrichment (which makes an LLM call) would leave a delivered reply marked
 * undelivered whenever the process restarted in between — the delivery ledger
 * exists to be trustworthy, so it must not depend on background work finishing.
 *
 * Returns 0 when nothing was stored; callers treat that as "nothing to mark".
 */
function recordInteraction(
  senderJid: string,
  remoteJid: string,
  pushName: string,
  text: string,
  response: string,
  hasImage: boolean
): number {
  // If this farmer issued DELETE while this (older) message was still being
  // processed, don't re-create the data we just erased.
  if (wasRecentlyErased(senderJid)) return 0;
  try {
    return saveInteraction(senderJid, remoteJid, pushName, text || "[image]", response, hasImage);
  } catch (err) {
    logger.error({ err }, "saveInteraction failed (non-critical)");
    return 0;
  }
}

/**
 * Slow, non-critical enrichment — vector memory and opportunistic profile
 * extraction. Runs in the background and never blocks or fails the reply.
 */
async function enrich(
  senderJid: string,
  remoteJid: string,
  pushName: string,
  text: string,
  response: string
): Promise<void> {
  if (wasRecentlyErased(senderJid)) return;

  try {
    const memText = `User ${pushName}: ${text || "[shared a plant image]"} | Assistant: ${response}`;
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

/**
 * Transport-agnostic Agri-Dosth turn: consent/opt-out/erasure gates, rate
 * limits, farming guardrail, the AI brain, persistence, and the reply. Both the
 * Baileys handler and the WhatsApp Cloud webhook feed this so compliance
 * behavior (STOP / START / DELETE / consent) lives in exactly one place.
 */
export async function processMessage(msg: IncomingMessage, res: Responder): Promise<void> {
  const { userId, remoteJid, displayName: pushName, text, hasImage } = msg;
  // The transport routes each message to a persona (by group/number). Fall back
  // to the default persona for 1:1/web channels or any unrouted message.
  const persona = msg.persona ?? getDefaultPersona();

  // Whether this is the farmer's very first message (checked before any upsert)
  // so we can send the one-time consent/onboarding notice to new contacts.
  const isNewContact = !getUser(userId);

  // Data erasure (DELETE) — honored before everything else, even for opted-out
  // users, so a farmer can always exercise their right to be forgotten (DPDP).
  if (text && isDeleteMessage(text)) {
    // Guard first so any in-flight message for this farmer can't re-persist
    // their data after we erase it.
    markErased(userId);
    await deleteUserData(userId);
    await deleteUserMemories(userId);
    await res.send(
      `🗑️ Done, ${pushName}. I've erased everything I had about you. Message me anytime to start fresh — I'm always here to help. 🌱\n— ${persona.displayName}`
    );
    return;
  }

  // Consent / opt-out gate — honored before any AI spend and durable across
  // restarts (backed by the optouts table). An opted-out farmer hears nothing
  // from us until they explicitly resume, so a "STOP" is respected even if the
  // process crashes and WhatsApp redelivers the message on reconnect.
  if (isOptedOut(userId)) {
    if (text && isResumeMessage(text)) {
      await clearOptOut(userId);
      await res.send(
        `🌱 Welcome back, ${pushName}! Good to hear from you again. Ask me anything about your plants and garden. (Reply STOP anytime to unsubscribe.)\n— ${persona.displayName}`
      );
    }
    // Opted out and not resuming → stay silent; replying would defeat the opt-out.
    return;
  }

  if (text && isOptOutMessage(text)) {
    // Persist the opt-out to disk BEFORE confirming, so the promise we make the
    // farmer ("you won't receive further replies") is durable across a restart.
    await setOptOut(userId);
    await res.send(
      `👋 You've been unsubscribed, ${pushName}. I won't message you further. Reply START anytime to come back — take care! 🌱\n— ${persona.displayName}`
    );
    return;
  }

  // First-contact consent/onboarding — sent BEFORE any AI spend (classifier,
  // model) so a new farmer sees who they're talking to and how to control their
  // data (STOP/DELETE) before we process their message. One-time (a returning
  // contact already has a user row).
  if (isNewContact) {
    try {
      await res.send(persona.consentMessage);
    } catch (err) {
      logger.warn({ err }, "Failed to send consent notice (non-critical)");
    }
  }

  // Rate limit the expensive AI path (per user) BEFORE any Gemini call —
  // including the guardrail classifier below — so off-topic spam that misses
  // the keyword filter can't burn quota on the classifier.
  if (!rateLimiter.allow(userId)) {
    logger.info({ senderJid: userId }, "Rate limit hit — throttling user");
    await res.send("🌱 One moment please — I'm catching up on messages. Try again in a minute!");
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
    await res.send("🌱 We're very busy right now — please try again a little later!");
    return;
  }
  globalMinuteLimiter.allow("global", nowMs);
  globalDayLimiter.allow("global", nowMs);

  // Domain guardrail — keyword fast-path (free), model fallback on a miss.
  // Images bypass entirely so Gemini can analyze the photo. A brand-new contact
  // also bypasses so their first "hi"/"namaste" gets Agri-Dosth's warm greeting
  // (which then collects name/place/phone) instead of a cold farming-only reply.
  // Recent history — fetched once; drives BOTH the guardrail and the context.
  // "Mid-conversation" means a prior turn within the last hour — not just "ever
  // chatted". Beyond the window the guardrail re-applies (a genuine farming
  // question still passes; only stale off-topic gets the canned redirect).
  const recent = getRecentInteractions(userId, 3);
  const CONVERSATION_WINDOW_MS = 60 * 60_000;
  const lastTs = recent.length ? Date.parse(recent[0].timestamp) : NaN;
  const inConversation = Date.now() - lastTs < CONVERSATION_WINDOW_MS;

  // Domain guardrail — hard-gate only COLD messages (no prior history). Once a
  // farmer is mid-conversation, let the AI handle follow-ups naturally ("yes",
  // "ok", "tell me more") and gently redirect any true off-topic itself (per the
  // system prompt). Judging a follow-up in isolation wrongly rejected legitimate
  // replies like "Yes please" to the bot's own offer.
  if (!hasImage && text && !isNewContact && !inConversation) {
    if (!isInPersonaScope(persona, text) && !(await isFarmingTopic(text))) {
      await res.send(persona.offTopicReply);
      return;
    }
  }

  upsertUser(userId, pushName, remoteJid, undefined, persona.idPrefix);

  // Assemble context: recent history + vector memory + profile.
  const contextParts: string[] = [];

  if (recent.length > 0) {
    // Oldest → newest. getRecentInteractions returns newest-first (it's a "last
    // N" query), but a conversation reads forwards: handing the model a
    // reversed thread makes "what did I just ask them?" the hardest thing in
    // the context to see, which is exactly what continuity depends on.
    const history = [...recent]
      .reverse()
      .map((r) => `User said: "${r.message}" | You replied: "${r.response}"`)
      .join("\n");
    contextParts.push(`Recent conversation history (oldest first):\n${history}`);
  }

  try {
    const memoryResults = await queryMemory(text || "plant photo", userId);
    if (memoryResults.length > 0) {
      contextParts.push(`Past memories about this user:\n${memoryResults.join("\n")}`);
    }
  } catch (err) {
    logger.debug({ err }, "Memory query failed (non-critical)");
  }

  const user = getUser(userId);
  if (user) {
    const profile = [];
    // Only treat a real name as known — the "Farmer" fallback means we still
    // don't know it, so the model should ask (per the system prompt).
    const knownName = user.name && user.name !== "Farmer" ? user.name : "";
    if (user.ctgId) profile.push(`Member ID: ${user.ctgId}`);
    if (knownName) profile.push(`Name: ${knownName}`);
    if (user.phone) profile.push(`Phone: ${user.phone}`);
    if (user.plants) profile.push(`Growing: ${user.plants}`);
    if (user.issues) profile.push(`Past issues: ${user.issues}`);
    if (user.location) profile.push(`Location: ${user.location}`);
    // Flag a first-time member so the persona greets them and states their ID once.
    if (isNewContact) profile.push("(This is their FIRST message — welcome them and tell them their Member ID once.)");
    if (profile.length > 0) {
      contextParts.push(`User profile:\n${profile.join(", ")}`);
    }
  }

  const context = contextParts.length > 0 ? contextParts.join("\n\n") : undefined;

  let response: string;

  try {
    if (hasImage) {
      const imageData = await msg.loadImage();
      if (imageData) {
        response = await analyzeImage(imageData.bytes, imageData.mimeType, text || undefined, context, persona.systemPrompt);
      } else {
        response = "I couldn't process the image. Could you try sending it again? 📷";
      }
    } else {
      response = await generateTextResponse(text, context, persona.systemPrompt);
    }
  } catch (err) {
    bump("errors");
    logger.error({ err }, "Gemini generation failed");
    response = "I'm having trouble processing that right now. Please try again in a moment. 🌱";
  }

  // Persist BEFORE sending so a transient send failure can't cost us the
  // interaction. The row lands as NOT delivered; a successful send promotes it
  // below, so a dropped reply stays visibly dropped instead of reading as a
  // clean answer. (Both helpers skip writes if the user was just erased.)
  const interactionId = recordInteraction(userId, remoteJid, pushName, text, response, hasImage);
  // Memory + profile enrichment is slow and non-critical — background it, and
  // track it so shutdown can drain it.
  trackBackground(enrich(userId, remoteJid, pushName, text, response));

  // Compliance re-check: a DELETE or STOP may have arrived WHILE this (older)
  // message was still generating. Sending now would deliver a reply after the
  // farmer asked to be erased/unsubscribed — so suppress the send in that case.
  // The transport re-checks again on its way out; see isDeliverySuppressed.
  if (isDeliverySuppressed(userId)) {
    logger.info({ userId }, "User erased/opted-out mid-flight — suppressing reply");
    return;
  }

  try {
    // The answer, not an interstitial — transports that voice their replies key
    // off this. Falls back to plain send for transports that don't distinguish.
    await (res.sendFinal ? res.sendFinal(response) : res.send(response));
    // Confirmed out the door. Synchronous and immediate — the row id is already
    // in hand, so nothing about this depends on background work completing.
    if (interactionId) markInteractionDelivered(interactionId);
  } catch (err) {
    // The transport aborted on a STOP/DELETE that landed mid-delivery. That is
    // the policy working, not a failure: swallow it so no caller apologises for
    // a "technical problem" and the row stays honestly marked undelivered.
    if (err instanceof DeliverySuppressedError) {
      logger.info({ userId }, "Delivery suppressed by the transport mid-send");
      return;
    }
    logger.error({ err }, "Failed to send WhatsApp reply");
    // Rethrow. Swallowing this here is what turned a rejected 5252-char answer
    // into total silence for the member (2026-08-06): the transport's "say
    // something rather than leave them staring at nothing" fallback keys off a
    // thrown error, so catching it here disabled the only safety net. Every
    // caller already wraps this in its own try/catch, so the process is safe.
    throw err;
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
