import { logger } from "../lib/logger";
import type { PolicyEngine } from "../policy/engine";
import type { OutboundCandidate } from "../policy/types";
import type {
  Trigger,
  FarmerSource,
  WeatherSource,
  MarketSource,
  RunSummary,
} from "./types";
import type { Transport } from "./transport";
import type { ApprovalQueue } from "./approvalQueue";
import type { DeliveryStore } from "./delivery";

export interface AutonomyDeps {
  policy: PolicyEngine;
  triggers: Trigger[];
  transport: Transport;
  queue: ApprovalQueue;
  delivery: DeliveryStore;
  farmers: FarmerSource;
  weather: WeatherSource;
  market?: MarketSource;
  now?: () => number;
}

/**
 * The proactive engine. Each run: gather candidates from triggers, then route
 * every candidate through the Policy Engine — the engine only PROPOSES; the
 * policy gate DECIDES. It never bypasses consent, templates, caps, or approval.
 */
export class AutonomyEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: AutonomyDeps) {}

  async runOnce(): Promise<RunSummary> {
    const now = (this.deps.now ?? Date.now)();
    const ctx = {
      now,
      farmers: this.deps.farmers.list(),
      weather: this.deps.weather.alerts(),
      market: this.deps.market?.prices() ?? [],
    };
    const candidates = this.deps.triggers.flatMap((t) => t.produce(ctx));
    const summary: RunSummary = {
      candidates: candidates.length,
      sent: 0,
      needsApproval: 0,
      suppressed: 0,
      failed: 0,
    };

    for (const c of candidates) {
      // Delivery-based anti-fatigue: stop pushing to persistently ignoring farmers.
      if (!this.deps.delivery.shouldKeepMessaging(c.farmerId)) {
        summary.suppressed++;
        continue;
      }
      const result = this.deps.policy.evaluate(c);
      if (result.decision === "allow") {
        if (await this.deliver(c, result.renderedText ?? "", now)) summary.sent++;
        else summary.failed++;
      } else if (result.decision === "needs_approval") {
        // Count only when a NEW item is queued (enqueue dedupes identical pending).
        if (this.deps.queue.enqueue(c, result.reason, now).created) summary.needsApproval++;
      } else {
        summary.suppressed++;
      }
    }
    return summary;
  }

  private async deliver(c: OutboundCandidate, text: string, now: number): Promise<boolean> {
    const res = await this.deps.transport.send(c, text);
    if (res.ok) {
      // Commit budget/idempotency ONLY after confirmed delivery.
      this.deps.policy.commitSend(c, now);
      this.deps.delivery.record(c.farmerId, "sent");
      return true;
    }
    logger.warn({ farmerId: c.farmerId, error: res.error }, "Proactive send failed");
    return false;
  }

  /** Approve a queued high-risk item and send it (re-checked through the policy gate). */
  async approveAndSend(id: string, approver: string): Promise<boolean> {
    const candidate = this.deps.queue.approve(id, approver);
    if (!candidate) return false;
    const result = this.deps.policy.evaluate(candidate);
    if (result.decision !== "allow") {
      logger.warn({ id, reason: result.reason }, "Approved item still blocked by policy");
      return false;
    }
    return this.deliver(candidate, result.renderedText ?? "", (this.deps.now ?? Date.now)());
  }

  /** Start the scheduler loop. Skips a tick if a previous run is still going. */
  start(intervalMs: number): void {
    if (this.timer) return; // already started — don't stack intervals
    const tick = (): void => {
      if (this.running) return; // a previous run is still in flight
      this.running = true;
      void this.runOnce()
        .catch((err) => logger.error({ err }, "Autonomy run failed"))
        .finally(() => {
          this.running = false;
        });
    };
    tick(); // run immediately (also guarded)
    this.timer = setInterval(tick, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
