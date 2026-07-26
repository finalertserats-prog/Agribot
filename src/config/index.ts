import dotenv from "dotenv";
import path from "path";
import { z } from "zod";
import { getDefaultPersona } from "./personas";

dotenv.config();

// The default persona (CTG Admn) supplies the baseline system prompt + consent
// copy. One bot hosts many personas (see config/personas.ts); transports route
// each message to the right one and these defaults cover 1:1/web channels.
const defaultPersona = getDefaultPersona();
const SYSTEM_PROMPT = defaultPersona.systemPrompt;

/**
 * Environment schema. Validated once at startup so misconfiguration fails
 * fast with a clear message instead of surfacing as a cryptic runtime error
 * on the first message.
 */
// Treat a blank env var (e.g. a leftover `OPENAI_API_KEY=` in .env) as unset,
// so an empty placeholder never fails validation or forces a provider.
const blankToUndef = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const envSchema = z
  .object({
    // AI provider keys — supply at least one. The bot picks a provider from
    // whichever key is present (or LLM_PROVIDER if you want to force one).
    GEMINI_API_KEY: z.preprocess(blankToUndef, z.string().min(1).optional()),
    OPENAI_API_KEY: z.preprocess(blankToUndef, z.string().min(1).optional()),
    LLM_PROVIDER: z.preprocess(blankToUndef, z.enum(["gemini", "openai"]).optional()),
    // Per-provider model overrides (sensible defaults below).
    GEMINI_TEXT_MODEL: z.string().min(1).default("gemini-2.0-flash"),
    GEMINI_EMBED_MODEL: z.string().min(1).default("text-embedding-004"),
    OPENAI_TEXT_MODEL: z.string().min(1).default("gpt-4o-mini"),
    OPENAI_EMBED_MODEL: z.string().min(1).default("text-embedding-3-small"),
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
  // WhatsApp Business Cloud API (optional — official 1:1 transport). Cloud is
  // ENABLED only when all four are set; otherwise the bot runs Baileys-only.
  // Groups always stay on Baileys (the Cloud API can't serve real groups).
  WHATSAPP_CLOUD_TOKEN: z.preprocess(blankToUndef, z.string().min(1).optional()),
  WHATSAPP_PHONE_NUMBER_ID: z.preprocess(blankToUndef, z.string().min(1).optional()),
  WHATSAPP_VERIFY_TOKEN: z.preprocess(blankToUndef, z.string().min(1).optional()),
  WHATSAPP_APP_SECRET: z.preprocess(blankToUndef, z.string().min(1).optional()),
  WHATSAPP_GRAPH_VERSION: z.preprocess(blankToUndef, z.string().min(1).default("v22.0")),
  // When "true", Baileys ignores 1:1 DMs and serves ONLY groups — use this once
  // 1:1 has moved to the Cloud API number, to enforce a clean split. Default
  // (unset/false) keeps Baileys handling its own DMs too (no behavior change).
  BAILEYS_GROUPS_ONLY: z.preprocess(blankToUndef, z.enum(["true", "false"]).optional()),
  // Link Baileys by 8-digit PAIRING CODE instead of a QR (no camera needed —
  // ideal for headless/VPS setup). Value = the number to link, international
  // format, digits only, no "+" (e.g. 919951387202). Unset => QR flow.
  BAILEYS_PAIRING_NUMBER: z.preprocess(
    blankToUndef,
    z.string().regex(/^\d{7,15}$/, "digits only, international format, no '+'").optional()
  ),
  })
  .refine((e) => resolveProviderName(e) !== null, {
    message:
      "No AI key configured. Set GEMINI_API_KEY or OPENAI_API_KEY " +
      "(get a free Gemini key at https://aistudio.google.com/apikey). " +
      "Optionally set LLM_PROVIDER=gemini|openai to force one.",
  });

// Which provider to use: an explicit LLM_PROVIDER wins (but only if its key is
// present); otherwise auto-select from whichever key is configured, preferring
// Gemini. Returns null when nothing usable is set (drives the refine above).
export function resolveProviderName(
  e: { LLM_PROVIDER?: "gemini" | "openai"; GEMINI_API_KEY?: string; OPENAI_API_KEY?: string }
): "gemini" | "openai" | null {
  if (e.LLM_PROVIDER === "gemini") return e.GEMINI_API_KEY ? "gemini" : null;
  if (e.LLM_PROVIDER === "openai") return e.OPENAI_API_KEY ? "openai" : null;
  if (e.GEMINI_API_KEY) return "gemini";
  if (e.OPENAI_API_KEY) return "openai";
  return null;
}

/** Resolved WhatsApp Business Cloud API settings (all fields required to enable). */
export interface CloudConfig {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
  graphVersion: string;
}

// Cloud transport is enabled ONLY when all four credentials are present:
// access token + phone-number-id (to send), verify token + app secret (to
// receive & authenticate webhooks). Any missing piece → null → Baileys-only.
export function resolveCloudConfig(e: {
  WHATSAPP_CLOUD_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_GRAPH_VERSION?: string;
}): CloudConfig | null {
  if (
    !e.WHATSAPP_CLOUD_TOKEN ||
    !e.WHATSAPP_PHONE_NUMBER_ID ||
    !e.WHATSAPP_VERIFY_TOKEN ||
    !e.WHATSAPP_APP_SECRET
  ) {
    return null;
  }
  return {
    accessToken: e.WHATSAPP_CLOUD_TOKEN,
    phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: e.WHATSAPP_VERIFY_TOKEN,
    appSecret: e.WHATSAPP_APP_SECRET,
    graphVersion: e.WHATSAPP_GRAPH_VERSION || "v22.0",
  };
}

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

const llmProvider = resolveProviderName(env) as "gemini" | "openai"; // refine guarantees non-null

export const config = {
  geminiApiKey: env.GEMINI_API_KEY,
  // Provider-agnostic AI configuration. `provider` is the resolved backend; the
  // per-provider blocks carry the key + model names the factory needs.
  llm: {
    provider: llmProvider,
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      textModel: env.GEMINI_TEXT_MODEL,
      embedModel: env.GEMINI_EMBED_MODEL,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      textModel: env.OPENAI_TEXT_MODEL,
      embedModel: env.OPENAI_EMBED_MODEL,
    },
  },
  botTrigger: env.BOT_TRIGGER,
  logLevel: env.LOG_LEVEL,
  // Official WhatsApp Cloud API transport (1:1 only). null => Baileys-only.
  cloud: resolveCloudConfig(env),
  // When true, Baileys serves ONLY groups (1:1 handled by the Cloud API).
  baileysGroupsOnly: env.BAILEYS_GROUPS_ONLY === "true",
  // Link Baileys via pairing code (no QR) to this number; undefined => QR flow.
  pairingNumber: env.BAILEYS_PAIRING_NUMBER,
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
  // One-time consent/onboarding notice sent the first time a farmer messages.
  // Bilingual (Hindi + English) and states what data is used + how to control it
  // (STOP to unsubscribe, DELETE to erase) — the minimum for an honest pilot.
  consentMessage: defaultPersona.consentMessage,
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
    maxCallsPerDay: 200, // global cap on autonomous phone calls (cost guard)
  },
} as const;

export type Config = typeof config;
