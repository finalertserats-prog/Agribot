import { createHash } from "crypto";
import type { OutboundCandidate } from "./types";

/**
 * Deterministic idempotency key so a retry (network blip, restart) can't send
 * the same proactive message twice. Keyed by tenant + farmer + template + the
 * local calendar day, so at most one of a given template lands per farmer per day.
 */
export function idempotencyKey(candidate: OutboundCandidate, dayStamp: string): string {
  const basis = `${candidate.tenantId}|${candidate.farmerId}|${candidate.templateId}|${dayStamp}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/** Local calendar day (YYYY-MM-DD) for the farmer's timezone. */
export function dayStampFor(now: number, tzOffsetMinutes: number): string {
  return new Date(now + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Records idempotency keys that have already been sent. In-memory for the
 * scaffold; production persists it (a UNIQUE constraint enforces once-only).
 */
export class IdempotencyStore {
  private readonly seen = new Set<string>();

  has(key: string): boolean {
    return this.seen.has(key);
  }

  add(key: string): void {
    this.seen.add(key);
  }

  reset(): void {
    this.seen.clear();
  }
}
