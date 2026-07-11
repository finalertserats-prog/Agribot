import type { OutboundCandidate, PolicyResult, AuditRecord, Decision } from "./types";
import { riskOf, requiresApproval, canBeCrisis } from "./risk";
import { isApprovedTemplate, renderTemplate } from "./templates";
import { ConsentStore } from "./consent";
import { FrequencyGuard, isQuietHours } from "./frequency";
import { IdempotencyStore, idempotencyKey, dayStampFor } from "./idempotency";
import type { AuditSink } from "./audit";

export interface PolicyConfig {
  proactiveEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  defaultTzOffsetMinutes: number;
}

export interface PolicyDeps {
  consent: ConsentStore;
  frequency: FrequencyGuard;
  idempotency: IdempotencyStore;
  audit: AuditSink;
  config: PolicyConfig;
  now?: () => number;
  /** Per-farmer timezone; falls back to the configured default. */
  tzOffsetFor?: (farmerId: string) => number;
}

/**
 * The deterministic gate for all proactive outbound. No LLM — just ordered,
 * auditable checks. The Autonomy Engine PROPOSES a candidate; this DECIDES.
 * Every call produces (and records) an audit entry, whatever the outcome.
 */
export class PolicyEngine {
  constructor(private readonly deps: PolicyDeps) {}

  evaluate(candidate: OutboundCandidate): PolicyResult {
    const { consent, frequency, idempotency, audit, config } = this.deps;
    const now = (this.deps.now ?? Date.now)();
    const risk = riskOf(candidate.messageType);
    const tz = this.deps.tzOffsetFor?.(candidate.farmerId) ?? config.defaultTzOffsetMinutes;

    // Honor crisis ONLY for whitelisted emergency types — a normal message
    // can't claim crisis to skip quiet hours / fatigue caps.
    const isCrisis = candidate.priority === "crisis" && canBeCrisis(candidate.messageType);
    const finish = (decision: Decision, reason: string, renderedText?: string): PolicyResult => {
      const record: AuditRecord = {
        at: new Date(now).toISOString(),
        tenantId: candidate.tenantId,
        farmerId: candidate.farmerId,
        messageType: candidate.messageType,
        riskClass: risk,
        language: candidate.language,
        templateId: candidate.templateId,
        decision,
        reason,
        approvedBy: candidate.approvedBy,
        estimatedCost: candidate.estimatedCost,
        priority: candidate.priority,
      };
      audit.record(record);
      return { decision, reason, riskClass: risk, audit: record, renderedText };
    };

    // 1. Kill switch — degrade to reactive-only.
    if (!config.proactiveEnabled) return finish("suppress", "proactive disabled (reactive-only mode)");

    // 2. Idempotency — never send the same template to a farmer twice in a day.
    const key = idempotencyKey(candidate, dayStampFor(now, tz));
    if (idempotency.has(key)) return finish("suppress", "duplicate suppressed (idempotency)");

    // 3. Consent — opt-in required; opt-out blocks.
    if (!consent.hasValidConsent(candidate.farmerId)) return finish("suppress", "no opt-in consent");

    // 4. Risk — high-stakes advice needs a human unless already approved.
    if (requiresApproval(candidate.messageType) && !candidate.approvedBy) {
      return finish("needs_approval", "high-risk advice requires human approval");
    }

    // 5. Template — must be approved for this message type + language.
    if (!isApprovedTemplate(candidate.templateId, candidate.messageType, candidate.language)) {
      return finish("suppress", "no approved template for message type/language");
    }

    // 6. Render — sanitized variables must produce a clean message.
    const rendered = renderTemplate(candidate.templateId, candidate.vars);
    if (!rendered.ok) return finish("suppress", `template render failed: ${rendered.error}`);

    // 7. Quiet hours (farmer-local). Crisis alerts bypass — a flood warning at
    //    2am must still go out.
    if (!isCrisis && isQuietHours(now, tz, config.quietHoursStart, config.quietHoursEnd)) {
      return finish("suppress", "quiet hours");
    }

    // 8. Per-farmer anti-fatigue cap. Crisis alerts bypass the fatigue cap.
    if (!isCrisis && !frequency.withinFarmerCap(candidate.farmerId, now)) {
      return finish("suppress", "per-farmer frequency cap reached");
    }

    // 9. Per-tenant daily quota.
    if (!frequency.withinTenantQuota(candidate.tenantId, now)) {
      return finish("suppress", "tenant daily quota reached");
    }

    // Approved to send. We deliberately do NOT commit frequency/idempotency here:
    // committing before delivery would false-drop a same-day retry if the send
    // fails. The caller sends, then calls commitSend() on confirmed delivery.
    return finish("allow", "ok", rendered.text);
  }

  /**
   * Commit the side effects of a SUCCESSFUL send: consume the frequency/quota
   * budget and mark the idempotency key so a later retry is deduped. Call this
   * only after the transport confirms delivery.
   */
  commitSend(candidate: OutboundCandidate, now: number = Date.now()): void {
    const { frequency, idempotency, config } = this.deps;
    const tz = this.deps.tzOffsetFor?.(candidate.farmerId) ?? config.defaultTzOffsetMinutes;
    frequency.record(candidate.farmerId, candidate.tenantId, now);
    idempotency.add(idempotencyKey(candidate, dayStampFor(now, tz)));
  }
}
