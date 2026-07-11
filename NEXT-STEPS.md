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

## Autonomy — Phase B (Ops Copilot) ✅ DONE
Purpose-built, least-privilege ops daemon (NOT OpenClaw/Hermes — safer, fully controlled):
- Bot writes a heartbeat (`data/heartbeat.json`, counts only — no farmer data).
- `src/ops/`: metrics, heartbeat writer, pure health logic (100% tested), notifier
  (log + optional webhook, no WhatsApp send), and the copilot daemon (`npm run ops`).
- Monitors heartbeat → alerts (info/warn/critical) → self-heals via OPS_RESTART_COMMAND
  with a bounded restart budget → recovery alert. Live-smoke-tested end to end.

## Autonomy — Phase A (Policy Engine) ✅ DONE (code side)
`src/policy/`: deterministic gate — kill-switch → idempotency → consent → risk/approval
→ approved-template → render → quiet-hours → farmer-cap → tenant-quota → allow, every
decision audited; side effects commit only after confirmed delivery (commitSend).
Consent (+ opt-out), template library (+ var sanitization), risk taxonomy, frequency/
quiet-hours (farmer-local tz), idempotency. Operator task remaining: WhatsApp Business
Platform account + Meta-approved templates.

## Autonomy — Phase C (Proactive Engine) ✅ DONE
`src/autonomy/`: triggers (seasonal/crop-stage/weather, with data-quality gates) →
Policy Engine → LoggingTransport (stub; real WhatsApp Business Platform transport is a
placeholder) → commitSend on success. Approval queue for high-risk, delivery-feedback
anti-fatigue, scheduler (`npm run autonomy`). Live-demoed: correctly suppressed night-time
sends via quiet hours.

## Autonomy — Phase D (Agentic Actions) ✅ DONE (code side)
- Market-price source + trigger + template (indexed by crop, template-gated).
- Crisis/priority path: outbreak/weather crisis bypasses quiet-hours + fatigue cap
  (whitelisted types only; still consent/template/quota-gated).
- Expert escalation service (route high-stakes cases to a human).
- Phone-call transport interface + stub + CallGuard (separate call consent per
  tenant+farmer, daily cost budget). Real telephony = operator setup.

## Autonomy — Phase E (Self-Improvement) ✅ DONE (governed)
`src/learning/`: OutcomeStore (honest labels, 'unclear' excluded), SkillGovernance
(propose→approve→rollback, never auto-applies, frozen copies), Experiment (deterministic
+ guardrail halt-to-control if agronomic quality drops).

150 tests, 84% coverage. **Remaining = item 1 only:** WhatsApp Business Platform account
+ Meta-approved templates + wiring the real transport (operator task).

## LLM Council — Full Readiness Review (2026-07-11) — ACTION LIST FOR NEXT SESSION

**Unanimous verdict (Opus + Sonnet + Codex + Gemini):** PILOT-READY (small, supervised,
reactive) — **NOT production-ready for autonomous outbound.** Architecture is excellent
("Policy Engine is the strongest file in the repo"); the *implementation* of the safety
layer is a scaffold. 150 tests / 84% coverage / never run live at scale.

**Two findings verified this session (real gaps, not opinion):**
- `isOptOutMessage` is defined + tested but **called NOWHERE in the live path** — a farmer
  texting "STOP" does not opt out. (grep: only in `consent.ts` + `policy/index.ts`.)
- **No `tenantId` column** in the reactive DB (`src/lib/database.ts`) — "multi-tenant" is
  real only in the proactive half; the reactive layer is single-tenant (one socket/DB/vectors).

**Prioritized action list (do in this order):**
1. **Wire opt-out into the live path** (small, high-value bug fix): call `isOptOutMessage`
   in `handler.ts`; on match, flip a *persisted* consent record. Bridge reactive `senderJid`
   ↔ proactive consent store.
2. **Persist the safety-critical stores** (THE #1 blocker, all reviewers): move ConsentStore,
   IdempotencyStore, FrequencyGuard, ApprovalQueue, DeliveryStore, OutcomeStore from in-memory
   Map/Set to a real DB (Postgres). Idempotency via `UNIQUE(tenant,farmer,template,day)`;
   atomic counter writes for caps; consent = durable source of truth. Add a test that proves
   an opted-out farmer can't receive a proactive msg AFTER a process restart.
3. **Make the reactive layer genuinely multi-tenant** — `tenantId` on users/interactions,
   per-tenant isolation, per-tenant config/quota.
4. **Wire the real WhatsAppCloudTransport** (after operator WhatsApp Business Platform setup —
   see `docs/OPERATOR-RUNBOOK.md`).
5. **Load/scale test** + migrate `sql.js` (whole-DB rewrite) + flat-JSON vector store to
   Postgres + a real vector DB before real volume.
6. **India layer** (Gemini): regional languages + voice; agronomist-reviewed content mapped to
   State Ag University package-of-practices; pesticide-dosage liability guards; disclaimers.

**THE non-negotiable (unanimous) before any real farmer gets an autonomous message:**
Durable, atomic, tenant-scoped consent + inbound opt-out wired end-to-end, proven to survive
a restart. (Items 1 + 2 above.)

## To resume
- Read this file + `HARDENING.md` + `docs/OPERATOR-RUNBOOK.md`.
- Start with action #1 (wire opt-out), then #2 (persist safety state).
- Reopen decision: `node ~/.claude/scripts/disagreement.js --open`
