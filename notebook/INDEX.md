# AgriFriend Notebook — Index

Master map of project knowledge. Load this first at session start.

## Sessions
- [2026-07-25 — WhatsApp Cloud API adapter + web onboarding/memory + live deploy](sessions/2026-07-25-whatsapp-cloud-onboarding.md)
  — hybrid transport (Baileys=groups, official Cloud API=1:1) via extracted shared reply core;
  web onboarding form + durable "remember me"; deployed live to VPS (web chat at :8090); HTTPS
  webhook endpoint stood up; setup + test-invite PDFs (QR). 237 tests, ~87% coverage. Pending:
  user provides Meta creds (1:1) + a spare SIM (groups).
- [2026-07-11 — Hardening → full autonomous product + docs](sessions/2026-07-11-agrifriend-hardening-autonomy.md)
  — clone→P0-P2 hardening→Phase 1 fixes→smoke test→Phase 2 tests→Autonomy A/B/C/D/E→8-doc
  pack→LLM council readiness review. 150 tests, 84% coverage. Verdict: pilot-ready, not
  production-ready for autonomous outbound.

## Key project docs (in repo)
- `NEXT-STEPS.md` — resumption doc + council readiness action list (READ FIRST on resume).
- `HARDENING.md` — every hardening change + accepted tradeoffs.
- `docs/OPERATOR-RUNBOOK.md` — WhatsApp Business Platform go-live steps (operator task).
- `docs/_generator/` — reproducible source for the 8-document pack.

## Repos
- Original: github.com/Shivaganesh-dev/agrifriend-bot
- Current (ours): github.com/finalertserats-prog/Agribot (branch hardening/p0-p1 → main)

## Resume
Say "resume AgriFriend" → start with NEXT-STEPS action #1 (wire opt-out) then #2 (persist safety state).
