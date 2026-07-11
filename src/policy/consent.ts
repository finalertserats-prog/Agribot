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

// Opt-out keywords across common languages/spellings for this market.
const STOP_KEYWORDS = [
  "stop",
  "unsubscribe",
  "opt out",
  "optout",
  "band",
  "band karo",
  "bas",
  "nahi",
  "mat bhejo",
  " روکو",
];

/**
 * Detect an inbound opt-out request. Normalizes punctuation and whitespace and
 * matches a leading keyword, so "STOP!", "stop, please", "  Band Karo." all
 * count — a missed opt-out is a worse failure than a false positive here.
 */
export function isOptOutMessage(text: string): boolean {
  const norm = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // drop punctuation/emoji
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return false;
  return STOP_KEYWORDS.some((k) => {
    const kn = k.trim().toLowerCase();
    return norm === kn || norm.startsWith(kn + " ");
  });
}
