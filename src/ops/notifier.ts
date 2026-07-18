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
    const message = `Agri-Dosth ops [${alert.level.toUpperCase()}]: ${alert.reason}`;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `text` works for Slack; `content` works for Discord — send both so any
      // common incoming-webhook URL renders the alert without extra config.
      body: JSON.stringify({ text: message, content: message, ...alert }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
  } catch (err) {
    logger.warn({ err }, "Failed to POST ops alert to webhook");
  }
}
