/**
 * Consent store for proactive outreach. Opt-in is required before any proactive
 * message; an opt-out (e.g. the farmer texts "STOP") must immediately and
 * permanently block further proactive sends.
 *
 * In-memory here for the scaffold; a production build persists this (and a
 * multi-instance build makes opt-out an atomic write) — see the audit note.
 */
export interface ConsentRecord {
  farmerId: string;
  optedIn: boolean;
  basis: string; // how consent was captured (e.g. "onboarding-2026-07")
  at: string; // ISO timestamp of the last change
}

export class ConsentStore {
  private readonly records = new Map<string, ConsentRecord>();

  grant(farmerId: string, basis: string, now: number = Date.now()): void {
    this.records.set(farmerId, {
      farmerId,
      optedIn: true,
      basis,
      at: new Date(now).toISOString(),
    });
  }

  /** Opt a farmer out — immediate and sticky; overrides any prior opt-in. */
  optOut(farmerId: string, now: number = Date.now()): void {
    const prev = this.records.get(farmerId);
    this.records.set(farmerId, {
      farmerId,
      optedIn: false,
      basis: prev?.basis ?? "opt-out",
      at: new Date(now).toISOString(),
    });
  }

  hasValidConsent(farmerId: string): boolean {
    return this.records.get(farmerId)?.optedIn === true;
  }

  get(farmerId: string): ConsentRecord | undefined {
    return this.records.get(farmerId);
  }
}

// Opt-out keywords for this market (English + Hinglish/regional).
// Deliberately excludes bare ambiguous words — "nahi" (a plain "no"), "band"
// ("off/closed", or "band gobhi" = cabbage) and "bas" ("enough"/"bus") are
// everyday farming vocabulary and caused false opt-outs (Gemini domain review,
// confirmed by Codex). We keep only unambiguous commands and the clear
// multi-word Hinglish phrases a farmer actually types to unsubscribe.
const STOP_KEYWORDS = [
  "stop",
  "unsubscribe",
  "opt out",
  "optout",
  "band karo",
  "mat bhejo",
  "message band karo",
  "msg band karo",
  "updates band karo",
  "message nahi chahiye",
  "aage se mat bhejo",
  "list se hatao",
  "group se hatao",
  "روکو",
];

// Resume keywords — how an opted-out farmer asks to start hearing from us again.
// Kept deliberately explicit (not just "yes") so an ordinary farming question
// can never accidentally re-subscribe someone who opted out.
const START_KEYWORDS = [
  "start",
  "resume",
  "subscribe",
  "chalu",
  "chalu karo",
  "shuru",
  "shuru karo",
];

function normalizeKeywordText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // drop punctuation/emoji
    .replace(/\s+/g, " ")
    .trim();
}

// Trailing filler that may follow a command word without changing intent, so
// "stop please" / "resume now" still count. Deliberately a closed allowlist:
// anything else after the keyword (e.g. "stop APHIDS", "start PLANTING rice")
// is real content, which means the message is a question, not a command.
const TRAILING_FILLER = new Set([
  "please", "pls", "plz", "now", "thanks", "thank", "thankyou", "ty",
  "kindly", "ok", "okay", "again", "it", "this", "na", "karo", "kar",
]);

/**
 * True only when `text` is essentially the command word itself — the keyword
 * (which may be multi-word) optionally followed by nothing but trailing filler.
 * This keeps a genuine "STOP" working while refusing to opt someone out just
 * because their farming question happened to start with "stop"/"nahi"/"bas".
 */
function matchesCommand(text: string, keywords: readonly string[]): boolean {
  const norm = normalizeKeywordText(text);
  if (!norm) return false;
  const words = norm.split(" ");
  return keywords.some((k) => {
    const kw = k.trim().toLowerCase().split(" ");
    if (words.length < kw.length) return false;
    for (let i = 0; i < kw.length; i++) {
      if (words[i] !== kw[i]) return false;
    }
    return words.slice(kw.length).every((w) => TRAILING_FILLER.has(w));
  });
}

/**
 * Detect an inbound opt-out request. Normalizes punctuation and whitespace and
 * matches a leading keyword, so "STOP!", "stop, please", "  Band Karo." all
 * count — a missed opt-out is a worse failure than a false positive here.
 */
export function isOptOutMessage(text: string): boolean {
  return matchesCommand(text, STOP_KEYWORDS);
}

/**
 * Detect a request to re-subscribe after opting out. Mirrors isOptOutMessage;
 * a false positive here is low-harm (an opted-out user gets one welcome-back),
 * but it must never fire on a normal farming question.
 */
export function isResumeMessage(text: string): boolean {
  return matchesCommand(text, START_KEYWORDS);
}

// Data-erasure keywords (DELETE / DPDP right-to-erasure). Whole-message match
// so a normal question like "how do I delete weeds" never wipes a farmer's data.
const DELETE_KEYWORDS = [
  "delete",
  "delete my data",
  "delete data",
  "erase",
  "erase my data",
  "data delete karo",
  "mera data delete karo",
  "mera data hatao",
];

/** Detect a data-erasure request. Whole-message match to avoid false wipes. */
export function isDeleteMessage(text: string): boolean {
  return matchesCommand(text, DELETE_KEYWORDS);
}
