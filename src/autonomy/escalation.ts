import { createHash } from "crypto";

/**
 * Routes high-stakes cases to a human expert (agronomist). Used when the bot
 * shouldn't answer autonomously — e.g. a serious disease, chemical dosage, or a
 * farmer explicitly asking for a person.
 */
export interface EscalationRequest {
  id: string;
  farmerId: string;
  tenantId: string;
  reason: string;
  context?: string;
  at: string;
  resolved: boolean;
}

export class EscalationService {
  private readonly items = new Map<string, EscalationRequest>();

  constructor(private readonly onEscalate?: (r: EscalationRequest) => void) {}

  escalate(
    farmerId: string,
    tenantId: string,
    reason: string,
    context?: string,
    now: number = Date.now()
  ): EscalationRequest {
    const id = createHash("sha256")
      .update(`${tenantId}|${farmerId}|${reason}|${now}`)
      .digest("hex")
      .slice(0, 16);
    const req: EscalationRequest = {
      id,
      farmerId,
      tenantId,
      reason,
      context,
      at: new Date(now).toISOString(),
      resolved: false,
    };
    this.items.set(id, req);
    this.onEscalate?.(req);
    return req;
  }

  pending(): EscalationRequest[] {
    // Return copies so callers can't mutate stored state directly.
    return [...this.items.values()].filter((r) => !r.resolved).map((r) => ({ ...r }));
  }

  resolve(id: string): boolean {
    const r = this.items.get(id);
    if (!r) return false;
    r.resolved = true;
    return true;
  }
}
