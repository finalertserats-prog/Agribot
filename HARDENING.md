# AgriFriend Bot — Hardening Notes

Changes applied in the `hardening/p0-p1` branch, plus known operational risks.

## What changed

### P0 — Correctness & data integrity
- **Atomic, debounced, async persistence.** The DB and vector store no longer do
  a synchronous full-file rewrite on every message. Writes are coalesced
  (`persistDebounceMs`, default 2s) and written via a temp-file + `rename`
  (`src/lib/persist.ts`), so a reader or crash mid-write never sees a torn
  (half-written) file. This guarantees *consistency*, not *durability*: there is
  no `fsync`, so a power-loss immediately after a write can still lose the newest
  data. State is flushed on `SIGINT`/`SIGTERM` (`registerShutdown` in `index.ts`),
  which drains in-flight background work (bounded at 5s) before flushing.
- **User profile is now real.** `plants` / `issues` / `location` were never
  populated (dead context). Profile facts are now extracted opportunistically
  after each reply (`extractProfile` in `gemini.ts` → `updateUserProfile`),
  non-blocking and best-effort.
- **Reconnect leak fixed.** `connectWhatsApp` used to recurse on disconnect,
  stacking event listeners and sockets. It now detaches old listeners and
  reconnects with capped exponential backoff (`src/lib/whatsapp.ts`).
- **Interaction ordering fixed.** Recent-history query now orders by
  autoincrement `id`, not `timestamp` (same-millisecond ties were undefined).

### P1 — Scalability & robustness
- **RAG scales.** `queryMemory` filters to the current user *before* scoring,
  skips the (paid) embedding call when a user has < `memoryQueryMinEntries`
  memories, and caps per-user memories at `maxMemoriesPerUser`.
- **Rate limiting + cost controls.** Per-user sliding-window limiter
  (`rateLimitPerMinute`) guards the Gemini path; oversized images
  (`maxImageBytes`, 8 MB) are rejected before base64 encoding; Gemini calls
  retry on 429 with backoff (`withRetry` in `gemini.ts`).
- **Guardrail fallback.** Keyword miss no longer hard-rejects — it falls back to
  a lightweight Gemini yes/no classifier (`isFarmingTopic`), which fails *open*.
- **Duplicate delivery dropped.** `SeenCache` (`src/lib/seen.ts`) skips repeat
  message IDs that Baileys can redeliver on resync.

### P2 — Quality
- **Config validation.** `config/index.ts` validates env with Zod and fails fast
  with a clear message if `GEMINI_API_KEY` is missing.
- **Structured logging.** All `console.*` replaced with a shared `pino` logger
  (`src/lib/logger.ts`). (QR-code output stays on `console` intentionally — it
  must render as raw art.)
- **Tests.** 31 Vitest tests cover domain filtering, cosine similarity, the rate
  limiter, the dedup cache, the debounced saver, and a DB round-trip.

## Accepted tradeoffs (deliberate decisions)

- **Persistence runs before send completes.** `persistAndEnrich` is started
  before `socket.sendMessage`, so a transient WhatsApp send failure cannot cost
  us the interaction/memory/profile. The tradeoff: if a send fails, the DB still
  records a reply the user never saw (minor RAG-history noise). We prioritize not
  losing conversation state over avoiding that noise; send failures are rare and
  transient (Baileys reconnects).
- **Rate limit bounds messages, not individual API calls.** One allowed message
  can fan out to several Gemini calls (memory embedding, classifier, generation,
  profile extraction, memory store). Total spend is therefore bounded by a
  constant factor of `rateLimitPerMinute`, not a hard per-call budget. For this
  scale that proxy is sufficient; a per-call-class budget would be the next step
  under heavier load.
- **Shutdown drain is bounded at 5s.** Background work still running past the
  bound may not persist; this is logged (`pending` count) rather than hung on, to
  respect PM2/systemd stop timeouts.

## Known operational risks (inherent — not bugs)

1. **WhatsApp ban risk.** Baileys is an *unofficial* WhatsApp Web client. The
   linked number can be banned at any time. Use a dedicated burner number and
   **back up `auth_info/`** (it holds the linked-device session — treat it as a
   credential; never commit it).
2. **Gemini free-tier quotas.** Rate limiting and 429 retries reduce but do not
   eliminate quota exhaustion under heavy group traffic. Tune
   `rateLimitPerMinute` and consider a paid tier for production load.
3. **Single-process, single-file stores.** Fine for hundreds of users / tens of
   thousands of memories on one VPS. Beyond that, migrate the vector store to
   `sqlite-vec` or a dedicated vector DB.

## Tuning knobs

All in `src/config/index.ts`:

| Key | Default | Purpose |
|-----|---------|---------|
| `persistDebounceMs` | 2000 | Max delay before a pending write flushes |
| `maxMemoriesPerUser` | 200 | Per-user vector-store cap |
| `memoryQueryMinEntries` | 2 | Skip RAG embedding below this many memories |
| `rateLimitPerMinute` | 8 | Per-user Gemini call budget per minute |
| `maxImageBytes` | 8 MB | Reject images larger than this |
