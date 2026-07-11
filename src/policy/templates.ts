import type { MessageType } from "./types";

/**
 * Approved-template library. Only messages built from an APPROVED template (for
 * the farmer's language) may be sent proactively — this mirrors the WhatsApp
 * Business Platform requirement that outbound templates are pre-approved by Meta.
 */
export interface Template {
  id: string;
  messageType: MessageType;
  language: string;
  body: string; // uses {{var}} placeholders
  requiredVars: string[];
  maxVarLen: number;
}

const MAX_VAR_LEN = 60;

// A seed set. In production these mirror the exact Meta-approved templates.
const TEMPLATES: Template[] = [
  {
    id: "seasonal_tip.en.v1",
    messageType: "seasonal_tip",
    language: "en",
    body: "🌱 Hi {{name}}, a seasonal tip for your {{crop}}: {{tip}}",
    requiredVars: ["name", "crop", "tip"],
    maxVarLen: MAX_VAR_LEN,
  },
  {
    id: "seasonal_tip.hi.v1",
    messageType: "seasonal_tip",
    language: "hi",
    body: "🌱 नमस्ते {{name}}, आपकी {{crop}} के लिए सुझाव: {{tip}}",
    requiredVars: ["name", "crop", "tip"],
    maxVarLen: MAX_VAR_LEN,
  },
  {
    id: "weather_alert.en.v1",
    messageType: "weather_alert",
    language: "en",
    body: "⛅ Weather alert for {{area}}: {{alert}}. Suggested action: {{action}}",
    requiredVars: ["area", "alert", "action"],
    maxVarLen: MAX_VAR_LEN,
  },
  {
    id: "crop_stage_reminder.en.v1",
    messageType: "crop_stage_reminder",
    language: "en",
    body: "🌾 Hi {{name}}, your {{crop}} is at {{stage}}. Next step: {{step}}",
    requiredVars: ["name", "crop", "stage", "step"],
    maxVarLen: MAX_VAR_LEN,
  },
  {
    // High-risk type: only sendable once a human/expert approves (the Policy
    // Engine still requires approvedBy on the candidate).
    id: "pest_diagnosis.en.v1",
    messageType: "pest_diagnosis",
    language: "en",
    body: "🔎 Hi {{name}}, about your {{crop}}: {{finding}}. Suggested next step: {{step}}",
    requiredVars: ["name", "crop", "finding", "step"],
    maxVarLen: MAX_VAR_LEN,
  },
  {
    id: "market_price.en.v1",
    messageType: "market_price",
    language: "en",
    body: "📈 {{crop}} price at {{market}} today: {{price}}. {{note}}",
    requiredVars: ["crop", "market", "price"], // note is optional
    maxVarLen: MAX_VAR_LEN,
  },
  {
    // Crisis + high-risk: needs a pre-authorized expert approval; sent priority.
    id: "outbreak_alert.en.v1",
    messageType: "outbreak_alert",
    language: "en",
    body: "🚨 Alert for {{area}}: {{threat}}. Act now: {{action}}",
    requiredVars: ["area", "threat", "action"],
    maxVarLen: MAX_VAR_LEN,
  },
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): Template | undefined {
  return byId.get(id);
}

/** Is there an approved template with this id, matching the message type + language? */
export function isApprovedTemplate(id: string, messageType: MessageType, language: string): boolean {
  const t = byId.get(id);
  return !!t && t.messageType === messageType && t.language === language;
}

/** Sanitize a template variable: strip control chars/newlines, collapse spaces, cap length. */
export function sanitizeVar(value: string, maxLen = MAX_VAR_LEN): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export interface RenderResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/**
 * Render an approved template with sanitized variables. Rejects missing vars or
 * an unknown template — a message that can't render cleanly must not be sent.
 */
export function renderTemplate(id: string, vars: Record<string, string>): RenderResult {
  const t = byId.get(id);
  if (!t) return { ok: false, error: `unknown template: ${id}` };

  for (const v of t.requiredVars) {
    if (typeof vars[v] !== "string" || vars[v].trim() === "") {
      return { ok: false, error: `missing template var: ${v}` };
    }
  }

  const text = t.body.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    sanitizeVar(vars[key] ?? "", t.maxVarLen)
  );
  return { ok: true, text };
}
