import { config } from "../config";
import { atomicWrite } from "../lib/persist";
import { logger } from "../lib/logger";
import { snapshot } from "./metrics";
import type { Heartbeat } from "./health";

let timer: NodeJS.Timeout | null = null;

async function write(status: Heartbeat["status"]): Promise<void> {
  const snap = snapshot();
  const hb: Heartbeat = {
    ts: Date.now(),
    status,
    pid: process.pid,
    uptimeSec: snap.uptimeSec,
    counters: snap.counters,
  };
  try {
    await atomicWrite(config.ops.heartbeatPath, JSON.stringify(hb));
  } catch (err) {
    logger.warn({ err }, "Failed to write heartbeat");
  }
}

/** Start writing a heartbeat file the Ops Copilot can monitor. */
export function startHeartbeat(): void {
  void write("starting");
  timer = setInterval(() => void write("ok"), config.ops.heartbeatIntervalMs);
  timer.unref(); // never keep the process alive just for the heartbeat
}

/** Write a final "stopping" heartbeat so the copilot knows the exit was intentional. */
export async function stopHeartbeat(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await write("stopping");
}
