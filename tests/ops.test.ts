import { describe, it, expect } from "vitest";
import {
  parseHeartbeat,
  healthState,
  evaluateAlert,
  RestartPolicy,
  type Heartbeat,
} from "../src/ops/health";
import { bump, snapshot, resetMetrics } from "../src/ops/metrics";

const hb = (over: Partial<Heartbeat> = {}): Heartbeat => ({
  ts: 1000,
  status: "ok",
  pid: 123,
  uptimeSec: 10,
  counters: {},
  ...over,
});

describe("parseHeartbeat", () => {
  it("accepts a valid heartbeat", () => {
    expect(parseHeartbeat(hb())?.pid).toBe(123);
  });
  it("rejects a non-object", () => {
    expect(parseHeartbeat("nope")).toBeNull();
  });
  it("rejects a bad status", () => {
    expect(parseHeartbeat({ ts: 1, status: "weird", pid: 1 })).toBeNull();
  });
  it("defaults missing counters to an empty object", () => {
    expect(parseHeartbeat({ ts: 1, status: "ok" })?.counters).toEqual({});
  });
});

describe("healthState", () => {
  it("is missing when there is no heartbeat", () => {
    expect(healthState(null, 5000, 60_000)).toBe("missing");
  });
  it("is healthy within the stale threshold", () => {
    expect(healthState(hb({ ts: 1000 }), 5000, 60_000)).toBe("healthy");
  });
  it("is stale past the threshold", () => {
    expect(healthState(hb({ ts: 1000 }), 100_000, 60_000)).toBe("stale");
  });
  it("treats a FRESH 'stopping' as healthy (graceful shutdown in progress)", () => {
    expect(healthState(hb({ ts: 1000, status: "stopping" }), 5000, 60_000)).toBe("healthy");
  });
  it("treats a STALE 'stopping' as unhealthy (went down, never came back)", () => {
    expect(healthState(hb({ ts: 1000, status: "stopping" }), 100_000, 60_000)).toBe("stale");
  });
  it("ignores a non-numeric error counter when evaluating alerts", () => {
    expect(evaluateAlert("healthy", hb({ counters: { errors: NaN } }), 10)).toBeNull();
  });
});

describe("RestartPolicy", () => {
  it("allows restarts up to the budget then blocks", () => {
    const p = new RestartPolicy(2, 60_000);
    expect(p.recordRestart(1000)).toBe(true);
    expect(p.recordRestart(1000)).toBe(true);
    expect(p.recordRestart(1000)).toBe(false); // budget exhausted
  });
  it("frees the budget once the window passes", () => {
    const p = new RestartPolicy(1, 60_000);
    p.recordRestart(1000);
    expect(p.canRestart(1000)).toBe(false);
    expect(p.canRestart(70_000)).toBe(true);
  });
});

describe("evaluateAlert", () => {
  it("is critical when the heartbeat is missing", () => {
    expect(evaluateAlert("missing", null, 10)?.level).toBe("critical");
  });
  it("is critical when stale", () => {
    expect(evaluateAlert("stale", hb(), 10)?.level).toBe("critical");
  });
  it("warns on an elevated error count", () => {
    expect(evaluateAlert("healthy", hb({ counters: { errors: 12 } }), 10)?.level).toBe("warn");
  });
  it("returns null when healthy and quiet", () => {
    expect(evaluateAlert("healthy", hb({ counters: { errors: 1 } }), 10)).toBeNull();
  });
});

describe("metrics", () => {
  it("bumps and snapshots counters without message content", () => {
    resetMetrics();
    bump("messages");
    bump("messages");
    bump("errors", 3);
    const snap = snapshot();
    expect(snap.counters.messages).toBe(2);
    expect(snap.counters.errors).toBe(3);
    expect(typeof snap.uptimeSec).toBe("number");
  });
});
