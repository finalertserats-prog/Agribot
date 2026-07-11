import { config } from "../config";
import { logger } from "../lib/logger";
import type { AlertLevel } from "./health";

export interface OpsAlert {
  level: AlertLevel;
  reason: string;
  at: string; // ISO timestamp
  detail?: Record<string, unknown>;
}

/**
 * Emit an operational alert. Always logs; optionally POSTs to a webhook
 * (e.g. a Slack/Telegram/ops channel). Deliberately has NO ability to message
 * farmers — the Ops Copilot never touches the WhatsApp send path.
 */
export async function notify(alert: OpsAlert): Promise<void> {
  const logFn =
    alert.level === "critical" ? logger.error : alert.level === "warn" ? logger.warn : logger.info;
  logFn.call(logger, { alert }, `[ops] ${alert.reason}`);

  const url = config.ops.webhookUrl;
  if (!url) return;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `AgriFriend ops [${alert.level.toUpperCase()}]: ${alert.reason}`,
        ...alert,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
  } catch (err) {
    logger.warn({ err }, "Failed to POST ops alert to webhook");
  }
}
