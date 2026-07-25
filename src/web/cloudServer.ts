import http from "http";
import express from "express";
import { logger } from "../lib/logger";
import { createWhatsAppWebhook, type CloudMessenger } from "./whatsappWebhook";
import type { CloudConfig } from "../config";

/**
 * Stand up the WhatsApp Cloud API webhook server. Runs in the SAME process as
 * the Baileys bot (single DB writer — no two-transport corruption). Put a TLS
 * reverse proxy (nginx/Caddy) in front; Meta requires HTTPS on 443.
 *
 * Pass port 0 to bind an ephemeral port (used by tests).
 */
export function startCloudWebhookServer(
  cfg: CloudConfig,
  messenger: CloudMessenger,
  port: number
): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.get("/health", (_req, res) => res.json({ ok: true, transport: "whatsapp-cloud" }));
  app.use(createWhatsAppWebhook(cfg, messenger));

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      logger.info({ port: boundPort }, "WhatsApp Cloud webhook server listening");
      resolve({ server, port: boundPort });
    });
    server.on("error", reject);
  });
}
