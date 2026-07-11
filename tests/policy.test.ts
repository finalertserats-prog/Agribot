import { describe, it, expect, beforeEach } from "vitest";
import { riskOf, requiresApproval } from "../src/policy/risk";
import { isApprovedTemplate, renderTemplate, sanitizeVar } from "../src/policy/templates";
import { ConsentStore, isOptOutMessage } from "../src/policy/consent";
import { FrequencyGuard, isQuietHours } from "../src/policy/frequency";
import { IdempotencyStore, idempotencyKey, dayStampFor } from "../src/policy/idempotency";
import { MemoryAuditSink } from "../src/policy/audit";
import { PolicyEngine, type PolicyConfig } from "../src/policy/engine";
import type { OutboundCandidate } from "../src/policy/types";

// ---------- units ----------
describe("risk taxonomy", () => {
  it("classifies advice by stakes", () => {
    expect(riskOf("seasonal_tip")).toBe("low");
    expect(riskOf("pesticide_dosage")).toBe("high");
  });
  it("flags high-risk types for approval", () => {
    expect(requiresApproval("pest_diagnosis")).toBe(true);
    expect(requiresApproval("seasonal_tip")).toBe(false);
  });
});

describe("templates", () => {
  it("recognizes an approved template for a message type + language", () => {
    expect(isApprovedTemplate("seasonal_tip.en.v1", "seasonal_tip", "en")).toBe(true);
    expect(isApprovedTemplate("seasonal_tip.en.v1", "seasonal_tip", "hi")).toBe(false);
  });
  it("renders with sanitized vars", () => {
    const r = renderTemplate("seasonal_tip.en.v1", { name: "Asha", crop: "tomato", tip: "water early" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Asha");
  });
  it("rejects a missing var", () => {
    const r = renderTemplate("seasonal_tip.en.v1", { name: "Asha", crop: "tomato" });
    expect(r.ok).toBe(false);
  });
  it("strips newlines from vars (template-injection guard)", () => {
    expect(sanitizeVar("line1\nline2")).toBe("line1 line2");
  });
});

describe("consent", () => {
  it("requires opt-in and honors opt-out", () => {
    const c = new ConsentStore();
    expect(c.hasValidConsent("f1")).toBe(false);
    c.grant("f1", "onboarding");
    expect(c.hasValidConsent("f1")).toBe(true);
    c.optOut("f1");
    expect(c.hasValidConsent("f1")).toBe(false);
  });
  it("detects opt-out keywords despite punctuation and casing", () => {
    expect(isOptOutMessage("STOP")).toBe(true);
    expect(isOptOutMessage("STOP!")).toBe(true);
    expect(isOptOutMessage("stop, please")).toBe(true);
    expect(isOptOutMessage("  Band Karo. ")).toBe(true);
    expect(isOptOutMessage("how do I grow tomatoes")).toBe(false);
    expect(isOptOutMessage("")).toBe(false);
  });
});

describe("quiet hours (farmer-local)", () => {
  it("wraps midnight correctly", () => {
    // 22:00 UTC + 330min (IST) = 03:30 local -> inside 21:00-07:00 window
    const t = Date.UTC(2026, 0, 1, 22, 0);
    expect(isQuietHours(t, 330, 21, 7)).toBe(true);
  });
  it("is false during the day", () => {
    const t = Date.UTC(2026, 0, 1, 6, 0); // 11:30 IST
    expect(isQuietHours(t, 330, 21, 7)).toBe(false);
  });
});

describe("idempotency", () => {
  it("is deterministic for the same candidate + day", () => {
    const c = candidate();
    const day = dayStampFor(Date.now(), 330);
    expect(idempotencyKey(c, day)).toBe(idempotencyKey(c, day));
  });
});

// ---------- engine decision matrix ----------
function candidate(over: Partial<OutboundCandidate> = {}): OutboundCandidate {
  return {
    tenantId: "t1",
    farmerId: "f1",
    messageType: "seasonal_tip",
    language: "en",
    templateId: "seasonal_tip.en.v1",
    vars: { name: "Asha", crop: "tomato", tip: "water early" },
    ...over,
  };
}

function makeEngine(cfg: Partial<PolicyConfig> = {}, farmerCap = 10, tenantCap = 1000) {
  const consent = new ConsentStore();
  const frequency = new FrequencyGuard(farmerCap, tenantCap);
  const idempotency = new IdempotencyStore();
  const audit = new MemoryAuditSink();
  const config: PolicyConfig = {
    proactiveEnabled: true,
    quietHoursStart: 0,
    quietHoursEnd: 0, // never quiet, so it doesn't interfere
    defaultTzOffsetMinutes: 330,
    ...cfg,
  };
  const engine = new PolicyEngine({ consent, frequency, idempotency, audit, config });
  return { engine, consent, frequency, idempotency, audit };
}

describe("PolicyEngine", () => {
  let ctx: ReturnType<typeof makeEngine>;
  beforeEach(() => {
    ctx = makeEngine();
    ctx.consent.grant("f1", "onboarding");
  });

  it("allows a consented, templated, low-risk message and returns rendered text", () => {
    const r = ctx.engine.evaluate(candidate());
    expect(r.decision).toBe("allow");
    expect(r.renderedText).toContain("Asha");
    expect(ctx.audit.records).toHaveLength(1);
  });

  it("suppresses when proactive is disabled (kill switch)", () => {
    const off = makeEngine({ proactiveEnabled: false });
    off.consent.grant("f1", "x");
    expect(off.engine.evaluate(candidate()).decision).toBe("suppress");
  });

  it("suppresses without consent", () => {
    const noConsent = makeEngine();
    expect(noConsent.engine.evaluate(candidate()).decision).toBe("suppress");
  });

  it("routes high-risk advice to human approval", () => {
    const r = ctx.engine.evaluate(
      candidate({ messageType: "pest_diagnosis", templateId: "pest_diagnosis.en.v1", vars: {} })
    );
    expect(r.decision).toBe("needs_approval");
  });

  it("allows high-risk advice once expert-approved AND templated", () => {
    const r = ctx.engine.evaluate(
      candidate({
        messageType: "pest_diagnosis",
        templateId: "pest_diagnosis.en.v1",
        vars: { name: "Asha", crop: "tomato", finding: "early blight", step: "remove leaves" },
        approvedBy: "agronomist-7",
      })
    );
    expect(r.decision).toBe("allow");
  });

  it("still suppresses expert-approved high-risk advice with no approved template", () => {
    const r = ctx.engine.evaluate(
      candidate({ messageType: "pest_diagnosis", templateId: "missing", vars: {}, approvedBy: "x" })
    );
    expect(r.decision).toBe("suppress");
  });

  it("suppresses when no approved template exists for the language", () => {
    const r = ctx.engine.evaluate(candidate({ language: "ta" }));
    expect(r.decision).toBe("suppress");
    expect(r.reason).toContain("template");
  });

  it("does NOT dedupe until a send is committed (no false-drop on failure)", () => {
    // Two evaluations without commitSend both pass — a failed send can retry.
    expect(ctx.engine.evaluate(candidate()).decision).toBe("allow");
    expect(ctx.engine.evaluate(candidate()).decision).toBe("allow");
  });

  it("suppresses a duplicate only AFTER the send is committed", () => {
    const c = candidate();
    expect(ctx.engine.evaluate(c).decision).toBe("allow");
    ctx.engine.commitSend(c);
    expect(ctx.engine.evaluate(c).decision).toBe("suppress"); // now a duplicate
  });

  it("commitSend consumes the per-farmer frequency budget", () => {
    const capped = makeEngine({}, 1); // farmerCap 1
    capped.consent.grant("f1", "x");
    const a = candidate({ templateId: "seasonal_tip.en.v1" });
    expect(capped.engine.evaluate(a).decision).toBe("allow");
    capped.engine.commitSend(a);
    // A different template to the same farmer now exceeds the cap.
    const b = candidate({
      messageType: "weather_alert",
      templateId: "weather_alert.en.v1",
      vars: { area: "Pune", alert: "rain", action: "cover" },
    });
    expect(capped.engine.evaluate(b).reason).toContain("frequency");
  });

  it("suppresses during quiet hours", () => {
    const quiet = makeEngine({ quietHoursStart: 0, quietHoursEnd: 24 }); // always quiet
    quiet.consent.grant("f1", "x");
    expect(quiet.engine.evaluate(candidate()).reason).toContain("quiet");
  });

  it("suppresses when the per-farmer cap is reached", () => {
    const capped = makeEngine({}, 0); // farmerCap 0
    capped.consent.grant("f1", "x");
    expect(capped.engine.evaluate(candidate()).reason).toContain("frequency");
  });

  it("suppresses when the tenant quota is reached", () => {
    const capped = makeEngine({}, 10, 0); // tenantCap 0
    capped.consent.grant("f1", "x");
    expect(capped.engine.evaluate(candidate()).reason).toContain("tenant");
  });

  // A crisis-eligible candidate (weather_alert is whitelisted for the crisis path).
  const crisisCand = (priority: "normal" | "crisis") =>
    candidate({
      messageType: "weather_alert",
      templateId: "weather_alert.en.v1",
      vars: { area: "Pune", alert: "flood", action: "move livestock" },
      priority,
    });

  it("crisis priority bypasses quiet hours", () => {
    const quiet = makeEngine({ quietHoursStart: 0, quietHoursEnd: 24 }); // always quiet
    quiet.consent.grant("f1", "x");
    expect(quiet.engine.evaluate(crisisCand("normal")).decision).toBe("suppress");
    expect(quiet.engine.evaluate(crisisCand("crisis")).decision).toBe("allow");
  });

  it("crisis priority bypasses the per-farmer frequency cap", () => {
    const capped = makeEngine({}, 0); // farmerCap 0
    capped.consent.grant("f1", "x");
    expect(capped.engine.evaluate(crisisCand("crisis")).decision).toBe("allow");
  });

  it("a non-eligible type cannot use the crisis fast-path", () => {
    const quiet = makeEngine({ quietHoursStart: 0, quietHoursEnd: 24 });
    quiet.consent.grant("f1", "x");
    // seasonal_tip is NOT crisis-eligible -> crisis flag ignored -> still suppressed
    expect(quiet.engine.evaluate(candidate({ priority: "crisis" })).decision).toBe("suppress");
  });

  it("crisis still requires consent (no bypass of consent)", () => {
    const e = makeEngine({ quietHoursStart: 0, quietHoursEnd: 24 });
    expect(e.engine.evaluate(crisisCand("crisis")).decision).toBe("suppress");
  });

  it("records an audit entry for every decision", () => {
    ctx.engine.evaluate(candidate());
    ctx.engine.evaluate(candidate({ language: "ta" }));
    expect(ctx.audit.records).toHaveLength(2);
    expect(ctx.audit.records.every((r) => r.decision && r.reason)).toBe(true);
  });
});
