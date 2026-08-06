# AgriFriend Notebook — Index

Master map of project knowledge. Load this first at session start.

## Sessions
- [2026-08-06 — Sarvam key, and the answer a member never received](sessions/2026-08-06-sarvam-key-and-the-lost-answer.md)
  — deployed `SARVAM_API_KEY`; it AUTHENTICATES but the account has **zero credits** (402 on
  every call; 403 would mean a bad key), so Telugu voice + Sarvam STT stay dormant until topped
  up. Built TTS/STT **fallback chains** so a dead vendor costs quality, never the message.
  Then reviewed the 9676807316 thread and found a member asked (by voice, in Telugu) how to grow
  tomatoes and **received nothing**: a 5252-char answer exceeded WhatsApp's 4096 cap → 400 →
  `reply.ts` swallowed the error, disabling the "say something" fallback, and skipped the owed
  voice note too — while the DB recorded a flawless answer. Fixed: chunking (now the delivery
  mechanism for DEPTH, which the user explicitly wants — not a length cap), rethrow, a
  `delivered` ledger, conversation continuity (no re-introducing/re-asking every turn), a
  transcript-confidence floor via logprobs, and voice-or-text on request. 359 tests.
  SCARS: `| tail` swallows git's exit code (shipped a silent no-op deploy — verify by SHA);
  the VPS remote is `origin`, not `deploy`; JS `\b` doesn't work with Telugu script.
  Then (`8eb888f`) declared `whatsapp-web.js` with the lockfile copied FROM the running VPS so
  `npm ci` reproduces the proven tree (verified by dry-run: adds wweb+puppeteer, 0 removals),
  and rewrote DEPLOY.md around the pipeline-exit-code trap.
  Key was then ROTATED by the user — the new one has credits, so **Telugu voice is LIVE**; the
  old key is kept as `SARVAM_API_KEY_BACKUP` (still zero credits = placeholder, not redundancy).
  Proved the fixes live by uploading a real voice note to Meta and POSTing a signed webhook:
  same question that vanished at 12:55 came back answered + spoken (`id 79 delivered=0` →
  `id 82 delivered=1`), and a 7,736-char answer **chunked into 3 messages** in production.
  Voice picked BY EAR from six candidates → **`anand`** (vendor documents no tone/gender).
  Also fixed: Sarvam was returning 24 kHz and being upsampled, and `enable_preprocessing` was
  being sent to v3 which ignores it.
  **NEXT: pilot with real users** — the Cloud number is still a Meta TEST number, so only
  allowlisted testers receive anything (hard cap 5, Meta App Dashboard → WhatsApp → API Setup).
  Watch `SELECT * FROM interactions WHERE delivered=0` during the pilot: anyone there got
  nothing. Baseline is exactly 1 row (the historical id 79).
  Also pending: top up the BACKUP Sarvam account for real redundancy; re-scan the group QR.
  Closed the day green — 0 errors since restart, 126 MB, 375 tests, VPS clean.
- [2026-08-05 — Voice notes, the answer-depth root cause, and a regression suite](sessions/2026-08-05-voice-notes-answer-depth-regression-suite.md)
  — shallow/WRONG answers traced to the silent `gpt-4o-mini` default, not the persona (it called
  low-chill HRMN-99 a temperate 700–1000-chill-hour variety, and invented two different "HRMN"
  acronym expansions); now `gpt-5` + `OPENAI_REASONING_EFFORT=low`. Shipped voice notes in AND
  out (STT → reply → spoken rewrite into Telugu SCRIPT → TTS → OGG/Opus → upload). Codex review
  caught 5 real bugs in the shipped voice code. Built an answer-quality regression suite
  harvested from real member failures (`npm run regression`, 3 samples, majority rule) — the
  first keyword-only version was worthless because it passed the known-bad model 4/4.
  DECIDED: correctness outranks latency/cost (answers now 15–30s) — do not re-raise.
  Pending: `SARVAM_API_KEY` for a real Telugu voice; shared-knowledge RETRIEVAL half.
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
