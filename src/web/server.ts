import express from "express";
import path from "path";
import { config } from "../config";
import { logger } from "../lib/logger";
import { initDB, flushDB } from "../lib/database";
import { initMemory, flushMemory } from "../lib/memory";
import { initGemini } from "../lib/gemini";
import { webChat } from "./chat";

const PORT = Number(process.env.WEB_PORT || 8080);

async function main(): Promise<void> {
  logger.info("Agri-Dosth web chat — starting up");
  await initDB();
  initGemini(); // initializes the configured AI provider (OpenAI/Gemini)
  initMemory();

  const app = express();
  // Room for a base64-encoded crop photo in the JSON body.
  app.use(express.json({ limit: "12mb" }));
  // Serve the chat page from /public at the repo root (dist/web -> ../../public).
  app.use(express.static(path.join(__dirname, "../../public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, provider: config.llm.provider });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { sessionId, name, message, imageDataUrl } = req.body ?? {};
      if (!sessionId || typeof sessionId !== "string") {
        res.status(400).json({ error: "missing sessionId" });
        return;
      }
      const text = typeof message === "string" ? message.slice(0, 2000) : "";

      let imageBytes: Uint8Array | undefined;
      let mimeType: string | undefined;
      if (typeof imageDataUrl === "string" && imageDataUrl.startsWith("data:")) {
        const m = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          const buf = Buffer.from(m[2], "base64");
          if (buf.length > config.maxImageBytes) {
            res.status(413).json({ error: "image too large (max 8 MB)" });
            return;
          }
          imageBytes = new Uint8Array(buf);
          mimeType = m[1];
        }
      }

      if (!text && !imageBytes) {
        res.status(400).json({ error: "empty message" });
        return;
      }

      const result = await webChat({ sessionId, name, message: text, imageBytes, mimeType });
      res.json({ reply: result.reply });
    } catch (err) {
      logger.error({ err }, "/api/chat failed");
      res.status(500).json({ error: "internal error" });
    }
  });

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, provider: config.llm.provider }, "Agri-Dosth web chat listening");
  });

  const shutdown = async (): Promise<void> => {
    logger.info("web chat shutting down — flushing state");
    server.close();
    try {
      await Promise.all([flushDB(), flushMemory()]);
    } catch (err) {
      logger.error({ err }, "flush failed on shutdown");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  logger.fatal({ err }, "web server fatal");
  process.exit(1);
});
