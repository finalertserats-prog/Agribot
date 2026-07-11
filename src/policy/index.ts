import { config } from "../config";
import { ConsentStore } from "./consent";
import { FrequencyGuard } from "./frequency";
import { IdempotencyStore } from "./idempotency";
import { FileAuditSink } from "./audit";
import { PolicyEngine } from "./engine";

export * from "./types";
export { ConsentStore, isOptOutMessage } from "./consent";
export { FrequencyGuard, isQuietHours } from "./frequency";
export { IdempotencyStore, idempotencyKey, dayStampFor } from "./idempotency";
export { MemoryAuditSink, FileAuditSink } from "./audit";
export { PolicyEngine } from "./engine";
export { riskOf, requiresApproval } from "./risk";
export {
  getTemplate,
  isApprovedTemplate,
  renderTemplate,
  sanitizeVar,
} from "./templates";

/**
 * Build a PolicyEngine wired from the app config. The shared collaborators
 * (consent, frequency, idempotency) are returned too so the Autonomy Engine can
 * feed them (e.g. record an opt-out) later in Phase C.
 */
export function createPolicyEngine(opts: { tzOffsetFor?: (farmerId: string) => number } = {}) {
  const consent = new ConsentStore();
  const frequency = new FrequencyGuard(
    config.policy.maxPerFarmerPerDay,
    config.policy.maxPerTenantPerDay
  );
  const idempotency = new IdempotencyStore();
  const audit = new FileAuditSink(config.policy.auditPath);
  const engine = new PolicyEngine({
    consent,
    frequency,
    idempotency,
    audit,
    tzOffsetFor: opts.tzOffsetFor,
    config: {
      proactiveEnabled: config.policy.proactiveEnabled,
      quietHoursStart: config.policy.quietHoursStart,
      quietHoursEnd: config.policy.quietHoursEnd,
      defaultTzOffsetMinutes: config.policy.defaultTzOffsetMinutes,
    },
  });
  return { engine, consent, frequency, idempotency, audit };
}
