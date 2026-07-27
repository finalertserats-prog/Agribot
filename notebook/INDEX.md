# AgriFriend Notebook — Index

Master map of project knowledge. Load this first at session start.

## Sessions
- [2026-07-27 — wweb QR link, the status@broadcast send bug, and the expert-depth persona](sessions/2026-07-27-wweb-qr-link-status-bug-expert-persona.md)
  — QR-linked 7013356256 (blank `BAILEYS_PAIRING_NUMBER` ⇒ QR, not pairing code); found the
  "every send throws" bug was OUR code replying into `status@broadcast`, not a stale library;
  rewrote the CTG persona for expert growers (exact quantities, mechanism, multi-part
  decomposition, accuracy guard). SCARS: changing `WWEB_VERSION` invalidates the session
  irreversibly; OpenClaw is Baileys-based and is NOT a viable fallback.
  Pending: re-scan the QR, then test a real send.
- [2026-07-26 — CTG Admn multi-persona rebrand + group-transport saga (Baileys is dead → whatsapp-web.js)](sessions/2026-07-26-ctg-admn-multipersona-and-baileys-crackdown.md)
- [2026-07-25 — WhatsApp 1:1 GO-LIVE (Meta app, permanent token, proven end-to-end)](sessions/2026-07-25-whatsapp-golive.md)
  — co-drove the full Meta setup in-browser; app 2104345650468151, WABA 1763036808044853,
  test number, permanent System-User token, webhook + `subscribed_apps`. Real message answered.
  Pending: production number for real farmers; Baileys groups.
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
