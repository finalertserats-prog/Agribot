/**
 * Pure operational-health logic for the Ops Copilot. No I/O here so it is
 * fully unit-testable: heartbeat parsing, staleness, restart policy, alerting.
 */

export interface Heartbeat {
  ts: number; // epoch ms of last write
  status: "starting" | "ok" | "stopping";
  pid: number;
  uptimeSec: number;
  counters: Record<string, number>;
}

export type HealthState = "healthy" | "stale" | "missing";

/** Validate an unknown value as a Heartbeat (defensive — file is external). */
export function parseHeartbeat(raw: unknown): Heartbeat | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  if (typeof h.ts !== "number") return null;
  if (h.status !== "starting" && h.status !== "ok" && h.status !== "stopping") return null;
  return {
    ts: h.ts,
    status: h.status,
    pid: typeof h.pid === "number" ? h.pid : 0,
    uptimeSec: typeof h.uptimeSec === "number" ? h.uptimeSec : 0,
    counters:
      h.counters && typeof h.counters === "object"
        ? (h.counters as Record<string, number>)
        : {},
  };
}

/** Derive health from a heartbeat (or null if the file was missing/unparseable). */
export function healthState(
  hb: Heartbeat | null,
  now: number,
  staleThresholdMs: number
): HealthState {
  if (!hb) return "missing";
  // A FRESH "stopping" heartbeat is an intentional shutdown (don't restart mid
  // graceful stop). But if it stays "stopping" past the stale threshold, the bot
  // went down and never came back — treat that as unhealthy so we self-heal.
  return now - hb.ts > staleThresholdMs ? "stale" : "healthy";
}

/**
 * Bounded restart policy: allow at most `maxRestarts` within a rolling window.
 * Prevents a crash-looping bot from being restarted forever.
 */
export class RestartPolicy {
  private readonly stamps: number[] = [];

  constructor(
    private readonly maxRestarts: number,
    private readonly windowMs: number
  ) {}

  /** Would a restart be allowed right now? (non-mutating) */
  canRestart(now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    return this.stamps.filter((t) => t > cutoff).length < this.maxRestarts;
  }

  /** Record a restart attempt; returns true if it was within budget. */
  recordRestart(now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = this.stamps.filter((t) => t > cutoff);
    if (recent.length >= this.maxRestarts) {
      this.stamps.length = 0;
      this.stamps.push(...recent);
      return false;
    }
    recent.push(now);
    this.stamps.length = 0;
    this.stamps.push(...recent);
    return true;
  }
}

export type AlertLevel = "info" | "warn" | "critical";

/**
 * Decide whether an alert is warranted from the current health + counters.
 * Returns null when nothing needs attention.
 */
export function evaluateAlert(
  state: HealthState,
  hb: Heartbeat | null,
  errorRateThreshold: number
): { level: AlertLevel; reason: string } | null {
  if (state === "missing") {
    return { level: "critical", reason: "No heartbeat found — bot may be down or never started" };
  }
  if (state === "stale") {
    return { level: "critical", reason: "Heartbeat is stale — bot appears unresponsive" };
  }
  const rawErrors = hb?.counters.errors;
  const errors = typeof rawErrors === "number" && Number.isFinite(rawErrors) ? rawErrors : 0;
  if (errors >= errorRateThreshold) {
    return { level: "warn", reason: `Elevated error count (${errors}) since last window` };
  }
  return null;
}
