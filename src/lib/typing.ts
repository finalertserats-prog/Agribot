import { logger } from "./logger";

/**
 * Keeping "typing…" on screen for as long as CTG Admn is actually thinking.
 *
 * WhatsApp auto-dismisses a typing indicator 25 seconds after it is raised (or
 * the instant we send a message). A real answer takes far longer than that —
 * transcribe the voice note, think, summarize for the ear, synthesize, upload —
 * so a single one-shot call leaves the member watching the indicator blink out
 * and then staring at nothing for a minute, which reads as "it ignored me".
 *
 * The indicator is addressed by the id of the message being replied to, so
 * re-posting the same read+typing payload before the 25s expiry is what keeps
 * it alive. There is no "stop typing" call: sending the reply dismisses it.
 */

/** Just the slice of the transport this needs — keeps it trivially fakeable. */
export interface TypingCapable {
  markReadAndTyping?(messageId: string): Promise<void>;
}

export interface TypingHandle {
  /** Stop refreshing. Idempotent — safe to call from a `finally` twice. */
  stop(): void;
}

/** Comfortably inside WhatsApp's 25s expiry, without hammering the API. */
const REFRESH_MS = 20_000;

/**
 * Stop pretending to type after this long. If a reply genuinely takes five
 * minutes something is wrong upstream, and an indicator that never stops is a
 * worse lie than one that gives up.
 */
const MAX_DURATION_MS = 5 * 60_000;

/**
 * Give up on refreshing after this many failures in a row. If Meta rejects
 * repeat calls for an already-read message, the loop is achieving nothing and
 * should not spend a request every 20 seconds discovering that again.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

const NOOP: TypingHandle = { stop: () => {} };

/**
 * One live indicator per chat. WhatsApp only shows one at a time, so two
 * overlapping loops for the same conversation (a member firing off two messages
 * back to back) would just double the API traffic to no visible effect. The
 * newer message wins — it is the one we are actually answering.
 */
const active = new Map<string, TypingHandle>();

/**
 * Show "typing…" and keep it alive until `stop()`.
 *
 * Best-effort throughout: this is a human-feel touch, and no failure here is
 * ever worth costing a member their answer. A transport without
 * `markReadAndTyping` (or a group chat, where the indicator does not apply)
 * gets an inert handle.
 *
 * @param chatId Conversation key used to coalesce overlapping indicators.
 */
export function startTyping(
  messenger: TypingCapable,
  messageId: string,
  chatId: string
): TypingHandle {
  if (!messenger.markReadAndTyping) return NOOP;

  // A newer message for this chat supersedes whatever was being refreshed.
  active.get(chatId)?.stop();

  let stopped = false;
  let failures = 0;
  let refreshes = 0;

  const poke = (): void => {
    if (stopped) return;
    refreshes += 1;
    messenger.markReadAndTyping!(messageId).then(
      () => {
        failures = 0;
      },
      (err) => {
        failures += 1;
        // First failure is worth a warn: a silently dead indicator is exactly
        // the kind of regression that only ever surfaces as "it feels broken".
        const level = failures === 1 ? "warn" : "debug";
        logger[level]({ err, messageId, failures }, "[typing] refresh failed");
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          logger.warn(
            { messageId, failures },
            "[typing] giving up on the indicator — the transport keeps rejecting it"
          );
          handle.stop();
        }
      }
    );
  };

  const timer = setInterval(poke, REFRESH_MS);
  // Never let a typing indicator hold the process open at shutdown.
  timer.unref?.();

  const deadline = setTimeout(() => {
    logger.warn({ messageId }, "[typing] reply exceeded the indicator ceiling — dropping it");
    handle.stop();
  }, MAX_DURATION_MS);
  deadline.unref?.();

  const handle: TypingHandle = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      clearTimeout(deadline);
      if (active.get(chatId) === handle) active.delete(chatId);
      logger.debug({ messageId, pokes: refreshes }, "[typing] indicator stopped");
    },
  };

  active.set(chatId, handle);
  poke(); // immediately, so the indicator appears while we are still decoding
  return handle;
}

/** Test seam — drops any indicator left running by a previous case. */
export function resetTypingForTests(): void {
  for (const handle of [...active.values()]) handle.stop();
  active.clear();
}
