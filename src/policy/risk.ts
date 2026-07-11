import type { MessageType, RiskClass } from "./types";

/**
 * Advice risk taxonomy (Doc 7 §5). High-risk message types require human
 * approval before they can be sent; low/medium can auto-send when templated.
 */
const RISK: Record<MessageType, RiskClass> = {
  seasonal_tip: "low",
  weather_alert: "low",
  market_price: "low",
  crop_stage_reminder: "medium",
  follow_up: "medium",
  pest_diagnosis: "high",
  pesticide_dosage: "high",
  outbreak_alert: "high",
};

export function riskOf(type: MessageType): RiskClass {
  return RISK[type];
}

/** High-stakes advice must be human-reviewed unless already expert-approved. */
export function requiresApproval(type: MessageType): boolean {
  return RISK[type] === "high";
}

// Only genuine emergency types may use the crisis fast-path (bypassing quiet
// hours + fatigue cap). This stops a buggy/abusive trigger from crisis-tagging
// routine outreach to escape user-protection controls.
const CRISIS_ELIGIBLE = new Set<MessageType>(["outbreak_alert", "weather_alert"]);

export function canBeCrisis(type: MessageType): boolean {
  return CRISIS_ELIGIBLE.has(type);
}
