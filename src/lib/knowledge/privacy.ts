/**
 * Privacy scrubbing for cross-member knowledge.
 *
 * Per-user memory is safe by construction — it is only ever read back to the
 * member it came from. Shared knowledge is not: anything promoted here can be
 * surfaced to a DIFFERENT member, so a leak is a DPDP problem rather than a
 * quality problem. This module is therefore deliberately over-eager. Losing a
 * useful sentence costs us nothing; leaking one member's phone number or
 * address to another costs us the community's trust.
 *
 * Two layers, and both matter:
 *   1. deterministic strip (here) — catches the mechanical identifiers
 *   2. semantic generalization (promote.ts) — rewrites lived detail into
 *      agronomic parameters
 * `hasResidualPii` then re-checks the generalized text as a final gate, because
 * an LLM asked to "remove personal details" sometimes helpfully keeps them.
 */

export const REDACTED = "[removed]";

/** Indian mobile numbers, with or without +91 / 0 prefix and common separators. */
const PHONE = /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;
/** Any long digit run — account numbers, Aadhaar-like strings, plot codes. */
const LONG_DIGITS = /\b\d{8,}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g;
/** CTG member IDs (CTG-7202-014) are direct identifiers. */
const MEMBER_ID = /\b[A-Z]{2,5}-\d{3,5}-\d{2,4}\b/g;
/** House / plot / flat / door numbers — "H.No 12-3-45", "Plot 27", "Flat 3B". */
const ADDRESS_NUM =
  /\b(?:h\.?\s?no\.?|house\s?no\.?|plot\s?(?:no\.?)?|flat\s?(?:no\.?)?|door\s?no\.?)\s*[:#-]?\s*[\w/-]+/gi;
/** WhatsApp JIDs that can appear in quoted context. */
const JID = /\b\d{10,15}@[a-z.]+\b/gi;

/**
 * Strip mechanical identifiers. `memberName` is removed explicitly because a
 * name is the one identifier no regex can generalize — we know it from the
 * user record, so we use it.
 */
export function scrubPii(text: string, memberName?: string): string {
  let out = text
    .replace(EMAIL, REDACTED)
    .replace(JID, REDACTED)
    .replace(MEMBER_ID, REDACTED)
    .replace(ADDRESS_NUM, REDACTED)
    .replace(PHONE, REDACTED)
    .replace(LONG_DIGITS, REDACTED);

  if (memberName) {
    for (const part of memberName.split(/\s+/).filter((p) => p.length >= 3)) {
      // Escape regex metacharacters — names legitimately contain "." and "'".
      const safe = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\b${safe}\\b`, "gi"), REDACTED);
    }
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Final gate before anything is written to shared storage.
 *
 * Returns true when text STILL looks like it carries personal data. Callers
 * must refuse promotion on true — this is the last check standing between a
 * member's private detail and every other member.
 */
export function hasResidualPii(text: string): boolean {
  for (const re of [EMAIL, JID, MEMBER_ID, PHONE, LONG_DIGITS, ADDRESS_NUM]) {
    re.lastIndex = 0; // these are /g — a stale lastIndex silently skips matches
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Phrases that mark an answer as being about ONE member's specific situation
 * rather than transferable horticultural knowledge. Such answers are useless
 * to others even after scrubbing ("your plant looks fine" tells nobody
 * anything), so they are rejected before the expensive quality gate runs.
 */
const PERSONAL_MARKERS = [
  /\byour (photo|picture|image)\b/i,
  /\bin the (photo|picture|image) you\b/i,
  /\bmember id\b/i,
  /\bwelcome to (ctg|the group)\b/i,
  /\bnice to meet you\b/i,
  /\bwhat.s your name\b/i,
];

/** True when the exchange is personal/administrative rather than knowledge. */
export function isPersonalOnly(question: string, answer: string): boolean {
  const both = `${question}\n${answer}`;
  return PERSONAL_MARKERS.some((re) => re.test(both));
}
