import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../src/policy/engine";
import { ConsentStore } from "../src/policy/consent";
import { FrequencyGuard } from "../src/policy/frequency";
import { IdempotencyStore } from "../src/policy/idempotency";
import { MemoryAuditSink } from "../src/policy/audit";
import type { OutboundCandidate } from "../src/policy/types";
import { AutonomyEngine } from "../src/autonomy/engine";
import { DEFAULT_TRIGGERS, seasonalTipTrigger, cropStageTrigger } from "../src/autonomy/triggers";
import { ApprovalQueue } from "../src/autonomy/approvalQueue";
import { DeliveryStore } from "../src/autonomy/delivery";
import { InMemoryFarmerSource, StaticWeatherSource } from "../src/autonomy/index";
import type { Transport, SendResult } from "../src/autonomy/transport";
import type { FarmerRecord, WeatherAlert, Trigger } from "../src/autonomy/types";

const NOW = Date.UTC(2026, 0, 1, 6, 0); // 11:30 IST — daytime

class RecordingTransport implements Transport {
  sends: { farmerId: string; text: string }[] = [];
  ok = true;
  async send(c: OutboundCandidate, text: string): Promise<SendResult> {
    this.sends.push({ farmerId: c.farmerId, text });
    return { ok: this.ok };
  }
}

const farmer = (over: Partial<FarmerRecord> = {}): FarmerRecord => ({
  farmerId: "f1",
  tenantId: "t1",
  name: "Asha",
  language: "en",
  crop: "tomato",
  ...over,
});

function makeAutonomy(
  farmers: FarmerRecord[],
  weather: WeatherAlert[] = [],
  triggers: Trigger[] = DEFAULT_TRIGGERS
) {
  const consent = new ConsentStore();
  const frequency = new FrequencyGuard(10, 1000);
  const idempotency = new IdempotencyStore();
  const audit = new MemoryAuditSink();
  const policy = new PolicyEngine({
    consent,
    frequency,
    idempotency,
    audit,
    now: () => NOW,
    config: { proactiveEnabled: true, quietHoursStart: 0, quietHoursEnd: 0, defaultTzOffsetMinutes: 330 },
  });
  const transport = new RecordingTransport();
  const queue = new ApprovalQueue();
  const delivery = new DeliveryStore();
  const engine = new AutonomyEngine({
    policy,
    triggers,
    transport,
    queue,
    delivery,
    farmers: new InMemoryFarmerSource(farmers),
    weather: new StaticWeatherSource(weather),
    now: () => NOW,
  });
  return { engine, policy, consent, transport, queue, delivery, audit };
}

// ---------- triggers ----------
describe("triggers", () => {
  it("seasonal tip fires for a farmer with a crop", () => {
    const c = seasonalTipTrigger.produce({ now: NOW, farmers: [farmer()], weather: [] });
    expect(c).toHaveLength(1);
    expect(c[0].messageType).toBe("seasonal_tip");
  });
  it("skips farmers with incomplete profiles (data quality)", () => {
    const c = seasonalTipTrigger.produce({ now: NOW, farmers: [farmer({ crop: undefined })], weather: [] });
    expect(c).toHaveLength(0);
  });
  it("crop-stage trigger needs a stage", () => {
    expect(cropStageTrigger.produce({ now: NOW, farmers: [farmer()], weather: [] })).toHaveLength(0);
    expect(
      cropStageTrigger.produce({ now: NOW, farmers: [farmer({ cropStage: "flowering" })], weather: [] })
    ).toHaveLength(1);
  });
});

// ---------- approval queue ----------
describe("ApprovalQueue", () => {
  const cand = (): OutboundCandidate => ({
    tenantId: "t1", farmerId: "f1", messageType: "pest_diagnosis",
    language: "en", templateId: "pest_diagnosis.en.v1", vars: {},
  });
  it("enqueues and approves with approvedBy set", () => {
    const q = new ApprovalQueue();
    const { id, created } = q.enqueue(cand(), "needs review");
    expect(created).toBe(true);
    expect(q.size).toBe(1);
    const approved = q.approve(id, "agronomist-7");
    expect(approved?.approvedBy).toBe("agronomist-7");
    expect(q.size).toBe(0);
  });
  it("dedupes identical pending items", () => {
    const q = new ApprovalQueue();
    expect(q.enqueue(cand(), "r").created).toBe(true);
    expect(q.enqueue(cand(), "r").created).toBe(false);
    expect(q.size).toBe(1);
  });
});

// ---------- delivery ----------
describe("DeliveryStore", () => {
  it("keeps messaging until enough ignored sends accumulate", () => {
    const d = new DeliveryStore();
    for (let i = 0; i < 6; i++) d.record("f1", "sent"); // 6 sent, 0 engaged
    expect(d.shouldKeepMessaging("f1")).toBe(false);
  });
  it("keeps messaging an engaged farmer", () => {
    const d = new DeliveryStore();
    for (let i = 0; i < 6; i++) d.record("f1", "sent");
    for (let i = 0; i < 3; i++) d.record("f1", "read");
    expect(d.shouldKeepMessaging("f1")).toBe(true);
  });
});

// ---------- engine (full pipeline) ----------
describe("AutonomyEngine.runOnce", () => {
  it("sends a consented, templated proactive message through the policy gate", async () => {
    const a = makeAutonomy([farmer()]);
    a.consent.grant("f1", "onboarding", NOW);
    const s = await a.engine.runOnce();
    expect(s.sent).toBe(1);
    expect(a.transport.sends[0].text).toContain("Asha");
    expect(a.audit.records.some((r) => r.decision === "allow")).toBe(true);
  });

  it("suppresses when the farmer has not opted in", async () => {
    const a = makeAutonomy([farmer()]);
    const s = await a.engine.runOnce();
    expect(s.sent).toBe(0);
    expect(s.suppressed).toBeGreaterThanOrEqual(1);
  });

  it("does not resend the same message the same day (idempotency after delivery)", async () => {
    const a = makeAutonomy([farmer()]);
    a.consent.grant("f1", "x", NOW);
    expect((await a.engine.runOnce()).sent).toBe(1);
    expect((await a.engine.runOnce()).sent).toBe(0); // deduped
  });

  it("does NOT commit on a failed send (so it can retry)", async () => {
    const a = makeAutonomy([farmer()]);
    a.consent.grant("f1", "x", NOW);
    a.transport.ok = false;
    expect((await a.engine.runOnce()).failed).toBe(1);
    a.transport.ok = true;
    expect((await a.engine.runOnce()).sent).toBe(1); // retried successfully
  });

  it("routes a high-risk candidate to the approval queue", async () => {
    const highRisk: Trigger = {
      name: "hr",
      produce: () => [
        {
          tenantId: "t1", farmerId: "f1", messageType: "pest_diagnosis",
          language: "en", templateId: "pest_diagnosis.en.v1",
          vars: { name: "Asha", crop: "tomato", finding: "blight", step: "remove leaves" },
        },
      ],
    };
    const a = makeAutonomy([farmer()], [], [highRisk]);
    a.consent.grant("f1", "x", NOW);
    const s = await a.engine.runOnce();
    expect(s.needsApproval).toBe(1);
    expect(a.queue.size).toBe(1);
  });

  it("sends a weather alert to farmers in the affected area", async () => {
    const a = makeAutonomy(
      [farmer({ area: "Pune" })],
      [{ area: "Pune", alert: "heavy rain", action: "delay spraying" }]
    );
    a.consent.grant("f1", "x", NOW);
    const s = await a.engine.runOnce();
    expect(a.transport.sends.some((x) => x.text.includes("heavy rain"))).toBe(true);
    expect(s.sent).toBeGreaterThanOrEqual(1);
  });
});

describe("AutonomyEngine.approveAndSend", () => {
  it("sends a queued item once a human approves it", async () => {
    const a = makeAutonomy([farmer()]);
    a.consent.grant("f1", "x", NOW);
    const { id } = a.queue.enqueue(
      {
        tenantId: "t1", farmerId: "f1", messageType: "pest_diagnosis",
        language: "en", templateId: "pest_diagnosis.en.v1",
        vars: { name: "Asha", crop: "tomato", finding: "blight", step: "remove leaves" },
      },
      "review"
    );
    expect(await a.engine.approveAndSend(id, "agronomist-7")).toBe(true);
    expect(a.transport.sends).toHaveLength(1);
  });
});
