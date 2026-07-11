import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { config } from "../config";
import { logger } from "../lib/logger";
import {
  parseHeartbeat,
  healthState,
  evaluateAlert,
  RestartPolicy,
  type Heartbeat,
  type HealthState,
} from "./health";
import { notify } from "./notifier";

const execAsync = promisify(exec);
const restartPolicy = new RestartPolicy(config.ops.maxRestarts, config.ops.restartWindowMs);

let lastState: HealthState | "unknown" = "unknown";
let errorAlerted = false;

async function readHeartbeat(): Promise<Heartbeat | null> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(config.ops.heartbeatPath, "utf-8"));
    return parseHeartbeat(raw);
  } catch {
    return null; // missing or unparseable — treated as "missing" downstream
  }
}

async function attemptRestart(now: number): Promise<void> {
  const at = new Date(now).toISOString();
  if (!config.ops.restartCommand) {
    await notify({
      level: "critical",
      reason: "Bot unhealthy and no OPS_RESTART_COMMAND configured — cannot self-heal",
      at,
    });
    return;
  }
  if (!restartPolicy.recordRestart(now)) {
    await notify({
      level: "critical",
      reason: `Restart budget exhausted (${config.ops.maxRestarts} in window) — manual intervention needed`,
      at,
    });
    return;
  }
  try {
    // OPS_RESTART_COMMAND is trusted operator configuration (like any env var),
    // not user/farmer input — so a shell command here is acceptable.
    await execAsync(config.ops.restartCommand);
    await notify({ level: "warn", reason: `Self-healed: ran '${config.ops.restartCommand}'`, at });
  } catch (err) {
    await notify({ level: "critical", reason: `Restart command failed: ${String(err)}`, at });
  }
}

/** One monitoring cycle. Exposed for testing/manual runs. */
export async function runCheck(now: number = Date.now()): Promise<HealthState> {
  const hb = await readHeartbeat();
  const state = healthState(hb, now, config.ops.staleThresholdMs);
  const at = new Date(now).toISOString();

  if (state !== "healthy") {
    // Alert only on the transition into an unhealthy state (avoid spam).
    if (lastState === "healthy" || lastState === "unknown") {
      const alert = evaluateAlert(state, hb, config.ops.errorRateAlert);
      if (alert) await notify({ ...alert, at, detail: { pid: hb?.pid } });
    }
    await attemptRestart(now);
  } else {
    if (lastState !== "healthy" && lastState !== "unknown") {
      await notify({ level: "info", reason: "Bot recovered — heartbeat healthy again", at });
    }
    // Elevated error count while otherwise healthy — alert once.
    const alert = evaluateAlert("healthy", hb, config.ops.errorRateAlert);
    if (alert && !errorAlerted) {
      await notify({ ...alert, at });
      errorAlerted = true;
    }
  }

  lastState = state;
  return state;
}

async function main(): Promise<void> {
  logger.info(
    { checkIntervalMs: config.ops.checkIntervalMs, heartbeat: config.ops.heartbeatPath },
    "Ops Copilot started — monitoring AgriFriend (least privilege: no farmer data, no send authority)"
  );
  await runCheck();
  // Guard against overlapping checks: if a cycle (which may await a restart)
  // runs longer than the interval, skip the next tick rather than double-restart.
  let checking = false;
  const t = setInterval(() => {
    if (checking) return;
    checking = true;
    void runCheck()
      .catch((err) => logger.error({ err }, "Ops check failed"))
      .finally(() => {
        checking = false;
      });
  }, config.ops.checkIntervalMs);
  const stop = (): void => {
    clearInterval(t);
    logger.info("Ops Copilot stopping");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// Only start the daemon when run directly (so tests can import runCheck).
if (require.main === module) {
  main().catch((err) => {
    logger.fatal({ err }, "Ops Copilot fatal error");
    process.exit(1);
  });
}
