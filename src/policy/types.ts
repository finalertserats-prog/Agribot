/** Shared types for the Policy Engine — the deterministic gate for proactive outbound. */

export type MessageType =
  | "seasonal_tip"
  | "weather_alert"
  | "market_price"
  | "crop_stage_reminder"
  | "follow_up"
  | "pest_diagnosis"
  | "pesticide_dosage"
  | "outbreak_alert";

export type RiskClass = "low" | "medium" | "high";

export type Decision = "allow" | "needs_approval" | "suppress";

/** A proposed proactive message, produced by the Autonomy Engine. */
export interface OutboundCandidate {
  tenantId: string;
  farmerId: string;
  messageType: MessageType;
  language: string; // ISO-ish code, e.g. "hi", "en", "te"
  templateId: string; // must resolve to an APPROVED template
  vars: Record<string, string>; // template variables (untrusted — sanitized on render)
  /** Set when a human/expert has already approved a high-risk message. */
  approvedBy?: string;
  /** Estimated cost units for budgeting (e.g. WhatsApp conversation + model). */
  estimatedCost?: number;
  /**
   * "crisis" = genuine emergency (outbreak, flood, heatwave). Crisis messages
   * bypass quiet-hours and the anti-fatigue frequency cap, but STILL require
   * consent, an approved template, tenant quota, and (for high-risk) approval.
   */
  priority?: "normal" | "crisis";
}

/** The result of evaluating a candidate. Always produces an audit record. */
export interface PolicyResult {
  decision: Decision;
  reason: string;
  riskClass: RiskClass;
  audit: AuditRecord;
  /** The sanitized, rendered message text — present only when decision is "allow". */
  renderedText?: string;
}

export interface AuditRecord {
  at: string; // ISO timestamp
  tenantId: string;
  farmerId: string;
  messageType: MessageType;
  riskClass: RiskClass;
  language: string;
  templateId: string;
  decision: Decision;
  reason: string;
  approvedBy?: string;
  estimatedCost?: number;
  priority?: "normal" | "crisis";
}
