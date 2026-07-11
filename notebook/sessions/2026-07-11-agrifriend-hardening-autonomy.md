# Session: 2026-07-11 — AgriFriend: clone → hardening → full autonomous product + docs

## What Was Done
Took `agrifriend-bot` from a raw clone to a code-complete autonomous product, all pushed to
the NEW repo `github.com/finalertserats-prog/Agribot` (branch `hardening/p0-p1` → its `main`).

- **Cloned + analyzed** the original (`Shivaganesh-dev/agrifriend-bot`): a reactive WhatsApp
  farming bot (Baileys + Gemini 2.0 Flash + sql.js + hand-rolled JSON RAG), ~662 LOC.
- **Hardening pass (P0–P2)** — commit `40c8366`. Atomic/debounced async persistence
  (`src/lib/persist.ts`), reconnect-leak fix, RAG scaling, per-user + global rate limits,
  guardrail classifier fallback, restart-safe dedup, Zod config, pino logs, 48 tests.
- **Phase 1 bug fixes** — `eeb5621`. B1 unhandled-rejection crash, B2 broken image download
  (`m.imageMessage`), restart-safe dedup, reconnect retry, cost ceilings. (B7 dismissed —
  sync read-modify-write is atomic.)
- **Live smoke test** — found + fixed 2 real bugs (`8204895`): reconnect-timer `unref`
  regression (process exited mid-backoff); unpinned WhatsApp version → 405 (added
  `fetchLatestBaileysVersion`, cached + timeout). Bot boots cleanly to the QR pairing stage.
- **Phase 2 integration tests** — `bc87e5e`. Extracted handler to `src/handler.ts`
  (side-effect-free) so it's testable; coverage 38% → 83%, 48 → 78 tests. 80% gate.
- **Autonomy Phase B (Ops Copilot)** — `4c2b0f2`. `src/ops/*`: heartbeat, health logic
  (100% tested), notifier, self-heal daemon (`npm run ops`). Live-smoke-tested.
- **Autonomy Phase A (Policy Engine)** — `df0d90a`. `src/policy/*`: deterministic gate
  (kill-switch → idempotency → consent → risk/approval → template → render → quiet-hours →
  farmer-cap → tenant-quota → allow), `commitSend` only after delivery, audit everything.
- **Autonomy Phase C (Proactive Engine)** — `47987bc`. `src/autonomy/*`: triggers →
  policy gate → transport (stub); approval queue, delivery anti-fatigue, scheduler.
- **Autonomy Phase D+E** — `f6a487b`. Market trigger, crisis whitelist, escalation, call
  guard; `src/learning/*`: OutcomeStore, SkillGovernance (propose→approve→rollback),
  Experiment (guardrail halt). Final: 150 tests, 84% coverage.
- **Documentation pack** — 8 docs × (Detailed + Summary) × (Word + PDF) = 32 files, in
  `../Documentation/{Detailed version,Summary version}`; reproducible generator committed to
  `docs/_generator/`. Plus `docs/OPERATOR-RUNBOOK.md` (WhatsApp Business Platform steps).
- **LLM Council full readiness review** — verdict recorded in `NEXT-STEPS.md`.

## Key Decisions Made
- **Ops Copilot built purpose-built, NOT OpenClaw/Hermes** — security (Codex flagged it as a
  privileged compromise target; ClawHub audit ~12% malicious skills) + full control + it's
  what we can actually run. OpenClaw/Hermes are single-user assistants, wrong shape for a
  multi-tenant product.
- **Autonomy = two systems + a deterministic Policy Engine gate** (from Codex adversarial
  review). Autonomy Engine PROPOSES; Policy Engine (no LLM) DECIDES. Prevents split-brain;
  keeps a non-deterministic model out of the safety path.
- **"Fully autonomous" reframed to "supervised proactive with bounded automation"** — for
  farmer advice, human-in-the-loop on high-stakes; autonomy grows as safety is proven.
- **commitSend after delivery** (not in `evaluate`) — a failed send must be retryable, not
  false-dropped.
- **Crisis whitelist** (`canBeCrisis`) — only outbreak/weather can bypass quiet-hours/fatigue,
  so a buggy trigger can't crisis-tag routine outreach.
- **Every commit went through Codex adversarial review** before push; Gemini (via **agy**, not
  the dead `gemini` CLI) used for design/market input.
- **package-lock.json left uncommitted** — avoids pinning Baileys' `git+ssh` libsignal dep
  that could break fresh VPS deploys.

## What's Pending / Next Steps  (see NEXT-STEPS.md "Council Readiness Review")
Council verdict: **PILOT-READY, not production-ready for autonomous outbound.** Priority order:
1. **Wire opt-out into the live path** — `isOptOutMessage` is coded+tested but called NOWHERE
   in `handler.ts`/`whatsapp.ts` (verified). Real bug. Flip a persisted consent record.
2. **Persist the safety-critical stores** (THE #1 blocker) — consent, idempotency, frequency,
   approvals, delivery are all in-memory Map/Set → restart loses opt-outs/caps/dedup. Move to
   Postgres; idempotency via `UNIQUE(tenant,farmer,template,day)`. Test survives restart.
3. **Real multi-tenancy in the reactive layer** — no `tenantId` column in `src/lib/database.ts`
   (verified); one socket/DB/vector store today.
4. Wire real `WhatsAppCloudTransport` (after operator WhatsApp Business Platform setup).
5. Load/scale test; migrate sql.js + JSON vector store to Postgres + real vector DB.
6. India layer (Gemini): regional languages + voice, SAU package-of-practices alignment,
   pesticide-dosage liability guards.
- **Operator task (only the user):** WhatsApp Business Platform account + Meta-approved
  templates → then ~30-min transport wiring. See `docs/OPERATOR-RUNBOOK.md`.

## Council Sessions
- Fast-mode council ran twice: (1) test/go-no-go earlier; (2) full readiness review this
  session (Opus/Sonnet/Codex/Gemini all read the code). Both unanimous: pilot-ready, not
  production-ready. DIS-001 (earlier "ship readiness") resolved fix-first.

## Patterns Learned
- **agy, not `gemini` CLI** — the `gemini` CLI is server-side dead (IneligibleTierError);
  `~/.claude/council/agy_oneshot.sh` is the working Gemini lane. (User caught me using the
  dead one.)
- **`codex_review.sh` can exceed the Bash tool's 120s default** — pass `timeout: 300000`.
- **Write tool + literal control chars in regex** — typing `[\x00-\x1F]` as control bytes
  corrupts the source; use readable escapes and a node fixer script if it slips in.
- **Windows/Git Bash can't deliver SIGINT** to a detached node process (can't test graceful
  shutdown live); `taskkill //F` to clean up.
- **docx2pdf works** because MS Word is installed; matplotlib for diagrams (no graphviz/dot).
- **Coverage gate:** exclude side-effectful entrypoints (index.ts, ops daemon, transport
  stubs) with a documented rationale; they're verified by live smoke tests.

## Files Changed (this session — major)
- Core: `src/index.ts`, `src/handler.ts` (new), `src/lib/{persist,whatsapp,gemini,memory,database,logger,domain,rateLimiter,seen}.ts`, `src/config/index.ts`
- Ops: `src/ops/{metrics,heartbeat,health,notifier,copilot}.ts`
- Policy: `src/policy/{types,risk,templates,consent,frequency,idempotency,audit,engine,index}.ts`
- Autonomy: `src/autonomy/{types,triggers,approvalQueue,transport,delivery,escalation,call,engine,index}.ts`
- Learning: `src/learning/{outcomes,governance,experiments,index}.ts`
- Tests: `tests/*.test.ts` (15 files, 150 tests)
- Docs: `docs/_generator/*.py`, `docs/{README,MANIFEST,OPERATOR-RUNBOOK}.md`, `NEXT-STEPS.md`, `HARDENING.md`
- Rendered pack: `../Documentation/` (32 binaries, outside git)

## Open Questions
- Persistence store choice (Postgres assumed — confirm with user).
- Whether reactive path also migrates off unofficial Baileys to the official Cloud API.
