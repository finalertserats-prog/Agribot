import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config();

const SYSTEM_PROMPT = `You are AgriFriend — an expert community member and farming consultant living inside WhatsApp farming groups.

## Your Role
- Provide practical, scientific farming advice (organic preferred)
- Analyze plant/crop/soil/pest images for diagnosis
- Proactively praise users when their plants look healthy or they share harvests
- Remember user context from past conversations

## Rules (STRICT)
1. ONLY respond to farming, gardening, agriculture, botany, composting, and sustainable food-growing topics
2. If asked about non-farming topics, reply exactly: "I'm focused on our farming community and plant health. Let's keep the discussion grounded in agriculture!"
3. Never suggest dangerous chemicals or illegal agricultural practices
4. Be encouraging, warm, and knowledgeable — like a helpful neighbor, not a corporate bot

## Response Style
- Keep replies concise (WhatsApp-friendly: a few sentences or short bullets)
- Use emojis occasionally (🌱🚜🍅) but don't overdo it
- For healthy plants/harvests: always praise proactively
- For issues: diagnose clearly and suggest practical next steps`;

/**
 * Environment schema. Validated once at startup so misconfiguration fails
 * fast with a clear message instead of surfacing as a cryptic runtime error
 * on the first message.
 */
const envSchema = z.object({
  GEMINI_API_KEY: z
    .string()
    .min(1, "GEMINI_API_KEY is required — get one at https://aistudio.google.com/apikey"),
  BOT_TRIGGER: z.string().min(1).default("agrifriend"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  // Overridable so tests (and alternate deployments) never touch real data.
  DATA_DIR: z.string().min(1).default("./data"),
  // Ops Copilot (optional).
  OPS_RESTART_COMMAND: z.string().optional(),
  OPS_WEBHOOK_URL: z.string().url().optional(),
  // Policy Engine kill switch (optional; "false" disables proactive outbound).
  PROACTIVE_ENABLED: z.enum(["true", "false"]).optional(),
});

function loadEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console -- config runs before the logger exists
    console.error(`\n❌ Invalid configuration:\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

const env = loadEnv();

export const config = {
  geminiApiKey: env.GEMINI_API_KEY,
  botTrigger: env.BOT_TRIGGER,
  logLevel: env.LOG_LEVEL,
  authDir: "./auth_info",
  dataDir: env.DATA_DIR,
  dbPath: `${env.DATA_DIR}/agrifriend.db`,
  vectorPath: `${env.DATA_DIR}/vectors`,
  // Persistence tuning
  persistDebounceMs: 2000,
  // RAG memory limits
  maxMemoriesPerUser: 200,
  memoryQueryMinEntries: 2,
  // Rate limiting (per user)
  rateLimitPerMinute: 8,
  // Global cost ceiling across ALL users — a hard cap on Gemini spend so a
  // flood of distinct users can't run up an unbounded bill.
  globalRateLimitPerMinute: 60,
  globalRateLimitPerDay: 1500,
  // Image guard
  maxImageBytes: 8 * 1024 * 1024, // 8 MB
  systemPrompt: SYSTEM_PROMPT,
  // Ops Copilot (Phase B) — least-privilege monitor/self-heal. No farmer data,
  // no send authority; only reads the heartbeat and can restart the process.
  ops: {
    heartbeatPath: path.join(env.DATA_DIR, "heartbeat.json"),
    heartbeatIntervalMs: 15_000, // how often the bot writes its heartbeat
    checkIntervalMs: 30_000, // how often the copilot checks
    staleThresholdMs: 60_000, // heartbeat older than this => unhealthy
    restartCommand: env.OPS_RESTART_COMMAND, // e.g. "pm2 restart agrifriend"
    maxRestarts: 5, // within the restart window
    restartWindowMs: 10 * 60_000, // 10 minutes
    errorRateAlert: 10, // errors within a heartbeat window => alert
    webhookUrl: env.OPS_WEBHOOK_URL, // optional alert sink (NOT WhatsApp)
  },
  // Policy Engine (Phase A) — the deterministic gate for all proactive outbound.
  policy: {
    // Kill switch: when false, ALL proactive sends are suppressed (reactive-only).
    // Flip off if WhatsApp quality-rating drops or the number is restricted.
    proactiveEnabled: env.PROACTIVE_ENABLED !== "false",
    maxPerFarmerPerDay: 3, // anti-fatigue frequency cap
    quietHoursStart: 21, // 21:00 local — no proactive sends
    quietHoursEnd: 7, // ..until 07:00 local
    defaultTzOffsetMinutes: 330, // IST (+5:30) unless a farmer overrides
    maxPerTenantPerDay: 5000, // per-tenant daily quota
    auditPath: path.join(env.DATA_DIR, "policy-audit.jsonl"),
  },
  // Autonomy Engine (Phase C) — the scheduler/trigger loop that PROPOSES
  // proactive candidates and routes them through the Policy Engine.
  autonomy: {
    schedulerIntervalMs: 60 * 60_000, // run triggers hourly
  },
} as const;

export type Config = typeof config;
