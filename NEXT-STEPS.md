# AgriFriend — Next Steps (council output, 2026-07-11)

Branch: `hardening/p0-p1` (committed `40c8366`). Nothing below is done yet — this is the
LLM Council's go/no-go findings, saved for later.

## Verdict
- **Coverage is 38.8%.** Primitives well-tested; the orchestration (`index.ts`, `whatsapp.ts`,
  `gemini.ts`, `memory.ts`) is ~0–21%.
- **Council split (DIS-001, unresolved):**
  - Claude (Opus+Sonnet) + Codex → **Go with caveats** (monitored beta OK while fixing).
  - Gemini (agy) → **Block / No-Go** until B1, B2, B7 are fixed.
- Reconciliation: the fix list is identical either way; only *when users touch it* differs.
  Recommended = fix Phase 1 first, then it's genuinely beta-ready.

## STATUS: Phase 1 DONE (2026-07-11). DIS-001 resolved fix-first. Phase 2 remaining.
- B7 was **dismissed as a false positive**: `updateUserProfile` is fully synchronous
  (`getUser` → `mergeFacts` → `db.run`, no `await` between read and write), so in
  single-threaded JS with sql.js the read-modify-write is atomic — no lost update.

## Phase 1 — bug fixes ✅ DONE (do first, ~half day)
- **B1 (High):** Unhandled promise rejection — wrap `saveInteraction` in try/catch inside
  `persistAndEnrich` (`src/index.ts`); add process-level `unhandledRejection`/`uncaughtException`
  handlers. Can crash-loop under PM2.
- **B2 (High):** Image download broken — `downloadImage` passes whole `m` to
  `downloadContentFromMessage`; must pass `m.imageMessage` (`src/index.ts:~48`). Pre-existing
  since original commit; photo analysis has never worked.
- **B-dedup (High, Gemini catch):** `SeenCache` is in-memory only — a crash/restart empties it,
  and WhatsApp redelivers on reconnect → bot replies multiple times → recursive LLM cost/ban
  risk. Make dedup restart-safe (persist recent IDs, or check against saved interactions).
- **B3 (Med):** Failed reconnect may not retry (`src/lib/whatsapp.ts`) — ensure a rejected
  reconnect reschedules.
- **B4 (Med):** `groupMetadata` fetched every group message but unused (`src/lib/whatsapp.ts`) —
  remove or gate it (latency + ban vector).
- **B5 (Med):** No global cost ceiling — add a global/daily Gemini cap on top of per-user limit.
- **B6 (Low):** `getEmbedding` in `memory.ts` lacks the `withRetry` wrapper — a 429 silently
  drops a memory.
- **B7 (Low):** Read-modify-write race in `updateUserProfile` (`src/lib/database.ts`) on rapid
  same-user messages.

## Phase 2 — tests ✅ DONE (coverage 38% → 83%, 48 → 78 tests)
1. ✅ `handleMessage` integration test — extracted handler to `src/handler.ts` (side-effect-free),
   10 tests: guardrail, rate limit, groups, image routing, Gemini-failure fallback + persistence.
2. ✅ `connectWhatsApp` reconnect/backoff test — 5 tests incl. single-flight guard, loggedOut-exit, dedup.
3. ✅ `persist` failure/flush-rethrow + serialization tests.
4. ✅ `memory` queryMemory filter/skip + `gemini` withRetry/fail-open/extractProfile tests.
5. ✅ `test:coverage` script + 80% threshold gate in vitest.config.ts.

Also, live smoke test found + fixed two real bugs: reconnect-timer unref regression and
unpinned WhatsApp version (405). Bot boots cleanly to the QR pairing stage.

## To resume
- Reopen decision: `node ~/.claude/scripts/disagreement.js --open`
- Resolve when decided: `node ~/.claude/scripts/disagreement.js --resolve DIS-001 --winner <peer> --reason "..."`
