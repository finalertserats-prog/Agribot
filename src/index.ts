import type http from "http";
import { config } from "./config";
import { logger } from "./lib/logger";
import { connectWhatsApp, flushSeen } from "./lib/whatsapp";
import { initGemini } from "./lib/gemini";
import { initDB, flushDB } from "./lib/database";
import { initMemory, flushMemory } from "./lib/memory";
import { handleMessage, backgroundTasks } from "./handler";
import { startHeartbeat, stopHeartbeat } from "./ops/heartbeat";
import { startCloudWebhookServer } from "./web/cloudServer";
import { WhatsAppCloudClient } from "./lib/whatsappCloud";

void config; // ensure config (env validation) is evaluated at startup

// The Cloud API webhook server (1:1 transport). Held so shutdown can close it.
// Runs in THIS process alongside Baileys so there's a single DB writer.
let cloudServer: http.Server | undefined;

function registerShutdown(): void {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down — draining background work and flushing state");
    try {
      // Let in-flight persistence schedule its writes, but bound the wait so a
      // stuck Gemini/network call can't hang past PM2/systemd stop timeouts.
      // Tasks that finish within the window have already scheduled their writes,
      // so the flush below captures them; any still running past the bound are
      // logged as possible loss rather than lost silently.
      let timedOut = false;
      const drainTimeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, 5000).unref()
      );
      await Promise.race([Promise.allSettled([...backgroundTasks]), drainTimeout]);
      if (timedOut && backgroundTasks.size > 0) {
        logger.warn(
          { pending: backgroundTasks.size },
          "Drain timed out — some background writes may not have persisted"
        );
      }
      if (cloudServer) await new Promise<void>((r) => cloudServer!.close(() => r()));
      await Promise.all([flushDB(), flushMemory(), flushSeen(), stopHeartbeat()]);
      process.exit(0);
    } catch (err) {
      // A flush failure means state may not have persisted — exit non-zero so
      // PM2/operators see the failure rather than a clean exit hiding data loss.
      logger.error({ err }, "Failed to flush state on shutdown — possible data loss");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Safety net: an unhandled rejection should NOT crash the bot — log and keep
  // serving. An uncaught exception is unrecoverable, so flush state and exit so
  // PM2 restarts cleanly rather than crash-looping with unpersisted data.
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection — continuing");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception — flushing and exiting");
    void shutdown("uncaughtException");
  });
}

async function main(): Promise<void> {
  logger.info("AgriFriend Bot — starting up");

  await initDB();
  logger.info("Database initialized");

  initGemini(); // initializes the configured AI provider (Gemini or OpenAI)

  initMemory();
  logger.info("RAG memory system ready");

  startHeartbeat();
  logger.info("Heartbeat started (Ops Copilot can monitor)");

  registerShutdown();

  // Baileys — handles DMs AND groups (groups stay on Baileys; the Cloud API
  // can't serve real community groups).
  await connectWhatsApp(handleMessage);

  // Official WhatsApp Cloud API — 1:1 transport, started only when configured.
  // Shares this process (and DB) with Baileys.
  if (config.cloud) {
    const messenger = new WhatsAppCloudClient(config.cloud, { maxImageBytes: config.maxImageBytes });
    const port = Number(process.env.WHATSAPP_WEBHOOK_PORT || 8080);
    const started = await startCloudWebhookServer(config.cloud, messenger, port);
    cloudServer = started.server;
    logger.info({ port: started.port }, "WhatsApp Cloud API transport active (1:1)");
  } else {
    logger.info("WhatsApp Cloud API not configured — running Baileys-only");
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error");
  process.exit(1);
});
