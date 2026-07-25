import express from "express";
import path from "path";
import { config } from "../config";
import { logger } from "../lib/logger";
import { initDB, flushDB } from "../lib/database";
import { initMemory, flushMemory } from "../lib/memory";
import { initGemini } from "../lib/gemini";
import { webChat } from "./chat";
import { validateProfile, getProfileView, saveProfile, eraseProfile } from "./profile";
import { RateLimiter } from "../lib/rateLimiter";

const PORT = Number(process.env.WEB_PORT || 8080);

// Throttle the public profile endpoint so it can't be spammed to stuff the DB.
const profileLimiter = new RateLimiter(10, 60_000);

async function main(): Promise<void> {
  logger.info("Agri-Dosth web chat — starting up");
  await initDB();
  initGemini(); // initializes the configured AI provider (OpenAI/Gemini)
  initMemory();

  const app = express();
  // Behind nginx — trust the proxy so req.ip reflects the real client (via
  // X-Forwarded-For), which the profile endpoint rate-limits on.
  app.set("trust proxy", true);
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

  // NOTE (security tradeoff): the profile endpoints authorize by the random
  // client sessionId alone — a capability token, not authenticated identity.
  // Knowing a sessionId grants read/edit/delete of that profile. This is
  // acceptable for a low-risk farming pilot (IDs are unguessable and rate-
  // limited); harden with a server-issued httpOnly session cookie if needed.

  // Returning-user check on page load: does this session already have a profile?
  app.get("/api/profile", (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    if (!sessionId || sessionId.length > 100) {
      res.status(400).json({ error: "missing sessionId" });
      return;
    }
    res.json(getProfileView(sessionId));
  });

  // Save the onboarding form (name required; location/phone optional).
  app.post("/api/profile", async (req, res) => {
    try {
      const result = validateProfile(req.body);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      // Rate-limit by client IP, not the client-supplied sessionId: an attacker
      // can rotate sessionIds freely, so keying on that wouldn't stop DB stuffing.
      if (!profileLimiter.allow(req.ip || "unknown")) {
        res.status(429).json({ error: "too many requests — slow down a moment" });
        return;
      }
      const view = await saveProfile(result.value);
      res.json(view);
    } catch (err) {
      logger.error({ err }, "/api/profile save failed");
      res.status(500).json({ error: "internal error" });
    }
  });

  // Erase a web user's data (DPDP parity with the WhatsApp DELETE command).
  app.delete("/api/profile", async (req, res) => {
    try {
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
      if (!sessionId || sessionId.length > 100) {
        res.status(400).json({ error: "missing sessionId" });
        return;
      }
      await eraseProfile(sessionId);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "/api/profile erase failed");
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
