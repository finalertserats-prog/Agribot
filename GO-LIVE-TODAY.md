# 🚀 AgriFriend — Go-Live Today (Reactive Pilot)

This is the runbook to put AgriFriend in front of **real farmers today**, safely.
It covers the *reactive* pilot: farmers text the bot, it answers farming
questions and diagnoses plant photos, and it honors "STOP". For the mechanical
VPS install steps see **SETUP.md**; this doc adds the pilot-safety layer.

---

## What is live today vs. not

| Capability | Today? | Why |
|---|---|---|
| **Reactive** — farmer texts → bot replies (Q&A + photo diagnosis) | ✅ **Yes** | Connects via WhatsApp QR pairing (Baileys). Needs only a Gemini key + a spare number. |
| **Opt-out** — farmer texts STOP → bot goes silent (durable) | ✅ **Yes** | Wired into the live path, persisted across restarts. |
| **Autonomous outbound** — bot messages farmers *first* | ❌ **Not today** | Legally requires a Meta WhatsApp Business Platform account, business verification, and Meta-approved templates (multi-day). See `docs/OPERATOR-RUNBOOK.md`. |

> **Do not enable proactive/outbound for the pilot.** Keep `PROACTIVE_ENABLED=false`
> (the default). The pilot is reactive-only — it replies when spoken to.

---

## What you need (10 minutes of your time)

1. **An AI key — either provider works:**
   - **Gemini** (free) — https://aistudio.google.com/apikey → set `GEMINI_API_KEY`
   - **OpenAI** — https://platform.openai.com/api-keys → set `OPENAI_API_KEY`
   - Set at least one. The bot auto-selects whichever key is present; set
     `LLM_PROVIDER=gemini|openai` to force one when both are configured. See
     `.env.example` for model overrides.
2. **A dedicated WhatsApp number** — a spare SIM / second number. The bot logs
   in *as* this number. **Never use your personal number.**
3. **A host to run it 24/7** — the Hostinger VPS from SETUP.md (or any Linux box
   / a laptop that stays on for the pilot).

> **One AI provider per deployment.** Semantic memory embeddings are
> provider-specific — don't switch providers on a running bot with existing
> memories. To switch, start with a fresh vector store (`data/vectors_*`).

---

## Go-live sequence

1. **Install** — follow SETUP.md Steps 1–4 (clone, `./setup.sh`, put your Gemini
   key in `.env`).
2. **Confirm the config** — in `.env`, leave `PROACTIVE_ENABLED` unset or `false`.
3. **Start + pair** — SETUP.md Steps 5–6: `pm2 start agrifriend`, then
   `pm2 logs agrifriend`, scan the QR with the spare phone
   (WhatsApp → Linked Devices → Link a Device). Wait for "connected".
4. **Smoke test** — SETUP.md Step 7 (DM a farming question, send a plant photo,
   try a group with the `agrifriend` trigger word).
5. **Test the opt-out** — from another phone, DM the bot "STOP". It should reply
   once ("You've been unsubscribed… reply START to resume") and then **ignore**
   further messages. Text "START" — it should welcome you back. This is the
   safety guarantee; verify it before onboarding anyone.
6. **Turn on the watchdog (recommended)** — in a second session run
   `npm run ops` (the Ops Copilot). Set `OPS_RESTART_COMMAND=pm2 restart agrifriend`
   in `.env` so it auto-restarts the bot if the heartbeat goes stale.

---

## Tell farmers this when you onboard them

Put this in your onboarding message / group pin — it's how you stay compliant
and respectful:

> 🌱 *Namaste! I'm AgriFriend. Ask me anything about farming, crops, or plant
> health — you can even send a photo of a sick plant. To stop getting replies,
> just reply **STOP**. To start again, reply **START**.*

Opt-out phrases the bot understands (whole message): **STOP**, **unsubscribe**,
`band karo`, `mat bhejo`, `message band karo`, `updates band karo`,
`message nahi chahiye`, `aage se mat bhejo`, `list se hatao`.
Resume: **START**, `resume`, `chalu karo`, `shuru`.

---

## Day-1 safety guardrails (already built in — know they exist)

- **Farming-only:** off-topic questions get a canned redirect, no AI spend.
- **Per-user rate limit:** 8 messages/min/user (`config.rateLimitPerMinute`).
- **Global cost ceiling:** hard caps on total Gemini calls
  (`globalRateLimitPerMinute` 60, `globalRateLimitPerDay` 1500) so a flood can't
  run up an unbounded bill. Tune these down for a small pilot if you want.
- **Opt-out honored before any AI call** and durable across restarts.
- **Image size cap:** 8 MB, oversized images rejected.

**Start small:** one group or a handful of DMs on day 1. Watch `pm2 logs
agrifriend` for errors, confirm replies are sensible and on-topic, then widen.

---

## Kill switch

If anything looks wrong (bad replies, quality-rating risk, cost spike):

```bash
pm2 stop agrifriend      # bot goes silent immediately
```

Farmer data (`data/agrifriend.db`) and opt-outs are on disk and survive the stop.

---

## Known limits of the pilot (be honest with stakeholders)

- **Single number / single tenant.** The reactive layer is one WhatsApp number,
  one database. Multi-tenant isolation is not wired yet.
- **In-memory safety stores for the *proactive* half** are not production-grade —
  which is exactly why proactive stays OFF for the pilot.
- **Unofficial transport (Baileys).** Fine for a supervised pilot; migrate to the
  official WhatsApp Business Platform before scaling or enabling outbound.
- **Content is AI-generated.** For a supervised pilot keep a human watching the
  logs. Before wide rollout, get agronomist review of advice quality and add
  pesticide-dosage disclaimers (see NEXT-STEPS.md item 6).
