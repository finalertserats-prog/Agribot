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
    // Members are seasoned growers who spot a confidently-wrong answer about a
    // named cultivar instantly, and a cheap model supplies exactly that. The
    // default is a frontier model on purpose — depth is the product here, not a
    // nice-to-have. Override per deployment if cost matters more than accuracy.
    OPENAI_TEXT_MODEL: z.string().min(1).default("gpt-5"),
    // Reasoning models only (gpt-5 family). Sent ONLY when set, because the
    // chat-completions API rejects it for non-reasoning models like gpt-4.1.
    // "low" is the measured sweet spot: it keeps the cultivar-level accuracy
    // that makes the answer worth sending while cutting latency ~4x vs the
    // default effort, which matters when a grower is waiting in WhatsApp.
    OPENAI_REASONING_EFFORT: z.preprocess(
      blankToUndef,
      z.enum(["minimal", "low", "medium", "high"]).optional()
    ),
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
  // Master switch for the unofficial group transport. Set "false" to run
  // Cloud-API-only — a fully stable, official 1:1 bot with zero group activity
  // (useful while a WhatsApp re-link block cools down). Default: on.
  BAILEYS_ENABLED: z.preprocess(blankToUndef, z.enum(["true", "false"]).optional()),
  // Which unofficial library serves WhatsApp GROUPS: "baileys" (default, light)
  // or "whatsapp-web" (Plan B — Puppeteer/real-Chrome, needs `npm install
  // whatsapp-web.js` + Chromium; often more resilient to WhatsApp changes).
  GROUP_TRANSPORT: z.preprocess(blankToUndef, z.enum(["baileys", "whatsapp-web"]).optional()),
  // Link Baileys by 8-digit PAIRING CODE instead of a QR (no camera needed —
  // ideal for headless/VPS setup). Value = the number to link, international
  // format, digits only, no "+" (e.g. 919951387202). Unset => QR flow.
  BAILEYS_PAIRING_NUMBER: z.preprocess(
    blankToUndef,
    z.string().regex(/^\d{7,15}$/, "digits only, international format, no '+'").optional()
  ),
  // Pin the WhatsApp Web build that whatsapp-web.js loads. WhatsApp ships page
  // changes that break the library's injected code — the symptom is receiving
  // working fine while every send throws "<wa-internal> is not a function".
  // Pinning a known-good build restores sending until the library catches up.
  // Value = a filename (minus .html) from wppconnect-team/wa-version, e.g.
  // "2.3000.1041661348-alpha". Unset => whatever WhatsApp currently serves.
  WWEB_VERSION: z.preprocess(blankToUndef, z.string().min(1).optional()),
  // --- Voice (WhatsApp voice notes in, voice notes out) ---
  // Master switch. Voice costs money per message and needs ffmpeg present, so
  // it stays opt-in rather than turning itself on the moment a key exists.
  VOICE_ENABLED: z.preprocess(blankToUndef, z.enum(["true", "false"]).optional()),
  OPENAI_STT_MODEL: z.string().min(1).default("gpt-4o-transcribe"),
  OPENAI_TTS_MODEL: z.string().min(1).default("gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: z.string().min(1).default("alloy"),
  // Sarvam (preferred for Telugu — handles code-mixed Telugu-English).
  SARVAM_API_KEY: z.preprocess(blankToUndef, z.string().min(1).optional()),
  // A second Sarvam account, tried when the primary fails. Credit exhaustion is
  // the failure that actually happens (a valid key on an empty account 402s on
  // every call), and a spare key is the cheapest real redundancy for it.
  SARVAM_API_KEY_BACKUP: z.preprocess(blankToUndef, z.string().min(1).optional()),
  SARVAM_TTS_MODEL: z.string().min(1).default("bulbul:v3"),
  SARVAM_SPEAKER: z.string().min(1).default("anand"),
  // bulbul:v3 delivery. pace 0.5-2.0 (under 1.0 = measured, not rushed);
  // temperature 0.01-2.0 (under the 0.6 default = steadier across a long
  // answer). Both are v3-only and are what "calmer voice" is tuned with.
  SARVAM_PACE: z.coerce.number().min(0.5).max(2).default(0.95),
  SARVAM_TEMPERATURE: z.coerce.number().min(0.01).max(2).default(0.5),
  // Sarvam transcription. saaras:v3 is the version with the code-mix mode CTG
  // needs; v4 exists but rejects `mode`, so switching is a deliberate choice.
  SARVAM_STT_MODEL: z.string().min(1).default("saaras:v3"),
  // Azure Speech (alternative Indic engine; region is required alongside the key).
  AZURE_SPEECH_KEY: z.preprocess(blankToUndef, z.string().min(1).optional()),
  AZURE_SPEECH_REGION: z.preprocess(blankToUndef, z.string().min(1).optional()),
  // How much of an answer the voice note may carry, in characters of SPOKEN
  // text. Roughly 11-12 chars per second at pace 0.95, so 1500 ≈ 2:10 — long
  // enough to actually explain something, short enough that a grower standing
  // in a garden will listen to the end. Anything longer than this is summarized
  // for the ear rather than truncated. Hard-capped by Sarvam's own 2500 ceiling.
  VOICE_MAX_SPOKEN_CHARS: z.coerce.number().min(200).max(2400).default(1500),
  // Ceiling on the whole build-the-voice-note step (summarize → synthesize →
  // transcode → upload). The text reply waits behind it, so this is the longest
  // the member can be kept waiting for audio before we give up and send text.
  VOICE_BUILD_TIMEOUT_MS: z.coerce.number().min(5_000).max(180_000).default(75_000),
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
      reasoningEffort: env.OPENAI_REASONING_EFFORT,
    },
  },
  botTrigger: env.BOT_TRIGGER,
  logLevel: env.LOG_LEVEL,
  // Voice pipeline. `enabled` is the only gate callers check; provider
  // selection lives in src/lib/speech/index.ts.
  speech: {
    enabled: env.VOICE_ENABLED === "true",
    sttModel: env.OPENAI_STT_MODEL,
    ttsModel: env.OPENAI_TTS_MODEL,
    ttsVoice: env.OPENAI_TTS_VOICE,
    sarvamKey: env.SARVAM_API_KEY,
    sarvamKeyBackup: env.SARVAM_API_KEY_BACKUP,
    sarvamModel: env.SARVAM_TTS_MODEL,
    sarvamSpeaker: env.SARVAM_SPEAKER,
    sarvamPace: env.SARVAM_PACE,
    sarvamTemperature: env.SARVAM_TEMPERATURE,
    sttSarvamModel: env.SARVAM_STT_MODEL,
    azureKey: env.AZURE_SPEECH_KEY,
    azureRegion: env.AZURE_SPEECH_REGION,
    maxSpokenChars: env.VOICE_MAX_SPOKEN_CHARS,
    buildTimeoutMs: env.VOICE_BUILD_TIMEOUT_MS,
  },
  // Official WhatsApp Cloud API transport (1:1 only). null => Baileys-only.
  cloud: resolveCloudConfig(env),
  // When true, Baileys serves ONLY groups (1:1 handled by the Cloud API).
  baileysGroupsOnly: env.BAILEYS_GROUPS_ONLY === "true",
  // Link Baileys via pairing code (no QR) to this number; undefined => QR flow.
  pairingNumber: env.BAILEYS_PAIRING_NUMBER,
  // Master switch for the group transport (default on). "false" => Cloud-only.
  baileysEnabled: env.BAILEYS_ENABLED !== "false",
  // Which library serves groups: "baileys" (default) or "whatsapp-web" (Plan B).
  groupTransport: env.GROUP_TRANSPORT ?? "baileys",
  // Pinned WhatsApp Web build for the whatsapp-web transport; undefined => latest.
  wwebVersion: env.WWEB_VERSION,
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
