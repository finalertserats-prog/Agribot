import { logger } from "../lib/logger";
import { RateLimiter } from "../lib/rateLimiter";

/**
 * Phone-call channel (the OpenClaw-style "call the farmer" capability), for
 * high-value/high-stakes cases. Calls carry EXTRA obligations beyond messaging:
 * separate call consent, a recording policy, language matching, a strict cost
 * cap, retry limits, and telecom compliance. The real transport needs a
 * telephony provider (operator setup) — this is a guarded stub.
 */
export interface CallRequest {
  farmerId: string;
  tenantId: string;
  language: string;
  reason: string;
}
export interface CallResult {
  ok: boolean;
  error?: string;
}
export interface CallTransport {
  call(req: CallRequest, script: string): Promise<CallResult>;
}

export class StubCallTransport implements CallTransport {
  async call(req: CallRequest): Promise<CallResult> {
    logger.info(
      { farmerId: req.farmerId, reason: req.reason },
      "[autonomy] (stub) would place a call"
    );
    return { ok: false, error: "telephony provider not configured" };
  }
}

/**
 * Gate for calls: requires EXPLICIT call consent (distinct from message consent)
 * and enforces a per-day call budget so autonomous calling can't run up cost.
 */
export class CallGuard {
  private readonly callConsent = new Set<string>();
  private readonly limiter: RateLimiter;

  constructor(maxCallsPerDay: number) {
    this.limiter = new RateLimiter(maxCallsPerDay, 24 * 60 * 60_000);
  }

  // Consent is keyed by (tenant, farmer) — a farmerId is only unique within a
  // tenant, so keying by farmerId alone would leak consent across tenants.
  private key(tenantId: string, farmerId: string): string {
    return `${tenantId}|${farmerId}`;
  }

  grantCallConsent(tenantId: string, farmerId: string): void {
    this.callConsent.add(this.key(tenantId, farmerId));
  }
  revokeCallConsent(tenantId: string, farmerId: string): void {
    this.callConsent.delete(this.key(tenantId, farmerId));
  }

  /** May we call this farmer right now? (consent + budget, non-mutating peek) */
  canCall(tenantId: string, farmerId: string, now: number = Date.now()): boolean {
    return this.callConsent.has(this.key(tenantId, farmerId)) && this.limiter.wouldAllow("global", now);
  }

  /** Record a placed call against the budget. */
  recordCall(now: number = Date.now()): void {
    this.limiter.allow("global", now);
  }
}
