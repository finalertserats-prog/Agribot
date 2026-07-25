# Agri-Dosth on WhatsApp — Complete Setup Guide

**The one authoritative guide** for running Agri-Dosth (AgriDosth) on WhatsApp:
the official Cloud API path for 1:1 chats, the Baileys path for group chats,
how to set up the Meta Business account, every link, and the exact deployment
steps on our VPS.

> **Status (2026-07-25): 🟢 WhatsApp 1:1 is LIVE.** The Meta app is set up, a
> permanent token is on the server, the webhook is verified & subscribed, and a
> real test message was answered end-to-end. Open now to the ≤5 verified test
> recipients; going open-to-anyone needs a production number + business
> verification. See **§9 Current Status** for full details.

---

## Table of contents
1. [The big picture — two channels, not one](#1-the-big-picture)
2. [What numbers you actually need](#2-what-numbers-you-need)
3. [Costs (and the deadline that matters)](#3-costs)
4. [Part A — Official Cloud API (1:1 chats)](#4-part-a--official-cloud-api-11-chats)
5. [Part B — Baileys (group chats)](#5-part-b--baileys-group-chats)
6. [Deployment & operations on the VPS](#6-deployment--operations)
7. [Environment variables reference](#7-environment-variables-reference)
8. [Stability — how we compare to OpenClaw/Hermes](#8-stability)
9. [Current status & the remaining checklist](#9-current-status--remaining-checklist)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. The big picture

Agri-Dosth answers growers' questions — field farmers and terrace/home gardeners
alike — on WhatsApp. **WhatsApp has two completely
different ways for a bot to connect, and one bot cannot do both jobs with one
number.** This is the single most important thing to understand:

| | One-on-one (DMs) | Group chats |
|---|---|---|
| **Official Cloud API** (dedicated number, no ban risk) | ✅ **Yes** | ❌ **No** — Meta does not allow bots in normal WhatsApp groups on the official API |
| **Baileys** (a spare real number, unofficial "WhatsApp Web" link) | ✅ Yes | ✅ **Yes — the only way to serve groups** |

So to run Agri-Dosth **everywhere farmers are** (both DMs *and* village/co-op
groups), we run a **hybrid**:

```
                         ┌─────────────────────────────────────┐
   Farmer DMs  ──────────►  Official WhatsApp Cloud API         │
   (Cloud number)         │  (webhook → our bot)  ── 1:1 only   │
                          │                                     │
                          │        ONE bot process              │
   Group messages ────────►  Baileys (linked to a spare number) │
   (spare number)         │  ── groups (+ that number's DMs)    │
                          └───────────────┬─────────────────────┘
                                          │
                                 Shared reply "brain"
                          (consent, STOP/DELETE, AI, memory —
                              identical for both channels)
```

Both channels run in **one Node process** (`dist/index.js`, the `agrifriend`
PM2 app) so there is a single database writer — no corruption, no separate DB
migration. The reply logic lives in `src/core/reply.ts` and is shared, so
compliance (consent, opt-out, data-erasure) behaves identically on both.

**You do NOT need OpenClaw, Hermes, Kapso, or any third-party framework.** They
use the same two transports we already have (Baileys + official Cloud API). See §8.

---

## 2. What numbers you need

You need **up to two numbers**, depending on how far you want to go:

### For 1:1 official chats
- **Now (demo/testing):** Meta gives you a **free test number** (format `+1 555…`)
  inside the dashboard. It can only message **up to 5 pre-verified recipients**.
  Perfect for building and demoing; useless for real farmers.
  - ⚠️ **The test number CANNOT be used for Baileys/groups** — it's a virtual
    number, not a real SIM, and can't be logged into the WhatsApp app.
- **Production (real farmers):** a **dedicated real number** registered to the
  Cloud API. ⚠️ Registering a number to the Cloud API **removes it from the
  normal WhatsApp app** and is largely **irreversible** — use a number you're
  happy to dedicate. Requires **business verification** (see §4).

### For group chats (Baileys)
- A **separate, real, active WhatsApp number** — a cheap spare SIM you put in a
  phone, install WhatsApp on, and scan a QR to link. This is the number that
  joins the farmer groups. It carries **ban risk** (it's the unofficial method),
  so keep it reply-only and rate-limited (our code already does this).

> **Bottom line on numbers:** the official 1:1 number and the Baileys groups
> number are **two different numbers**. They can never be the same number,
> because a number on the Cloud API can't also be a Baileys/WhatsApp-app number.

---

## 3. Costs

The official Cloud API is **cheap-to-free for reactive replies**, but there's a
deadline:

| Item | Cost |
|---|---|
| Farmer-initiated replies within the **24-hour window** | **Free — until Oct 1, 2026** |
| After **Oct 1, 2026** — replies in-window | ~₹0.115 per message |
| Utility/authentication templates | ~₹0.115 each |
| Marketing templates | ~₹0.86 each |
| Our AI (OpenAI/Gemini) | unchanged from today |
| VPS hosting | the box we already pay for |

- The old **"1,000 free conversations/month" is gone** (retired 2024) — ignore
  any guide that still mentions it.
- **18% GST** applies in India.
- Going **direct to Meta** (not via a BSP like Gupshup/Twilio) avoids per-message
  markups.
- **Baileys (groups) has no Meta message cost** — but carries ban risk instead.

---

## 4. Part A — Official Cloud API (1:1 chats)

Everything here happens at **[developers.facebook.com](https://developers.facebook.com/)**
and **[business.facebook.com](https://business.facebook.com/)**.

### 4.1 Create the Business account & verify it
1. Go to **[business.facebook.com](https://business.facebook.com/)** → create a
   **Meta Business Account**. Set billing currency to **INR**.
2. **Business Verification** — Business Settings → Security Center → upload legal
   docs (GST certificate / MSME / utility bill). This lifts the sandbox cap
   (250 msgs/day) to production limits. **Takes days — start early.** (Not needed
   for the *test* number, only for going live to real farmers.)

### 4.2 Create the app & add WhatsApp
1. **[https://developers.facebook.com/apps/](https://developers.facebook.com/apps/)**
   → **Create App** → type **Business**.
2. In the app, find **WhatsApp** → **Set up**. Attach your Business Account.
   This creates your **WhatsApp Business Account (WABA)** and a **test number**.

### 4.3 Collect the 4 credentials
Once the app exists, its URL is `https://developers.facebook.com/apps/<APP_ID>/…`.
Copy that `<APP_ID>` and use these:

| # | Value | Where | Env var |
|---|---|---|---|
| 1 | **Temporary access token** | WhatsApp → **API Setup**, top of page | `WHATSAPP_CLOUD_TOKEN` |
| 2 | **Phone number ID** | WhatsApp → **API Setup**, under the "From" number | `WHATSAPP_PHONE_NUMBER_ID` |
| 3 | **App Secret** | **App Settings → Basic** → *Show* | `WHATSAPP_APP_SECRET` |
| 4 | **Verify token** — *you invent this* | any random string, e.g. `agridosth-hook-7c2f` | `WHATSAPP_VERIFY_TOKEN` |

Direct links (replace `<APP_ID>`):
- API Setup (①②, + test recipients): `https://developers.facebook.com/apps/<APP_ID>/whatsapp-business/wa-dev-console/`
- App Secret (③): `https://developers.facebook.com/apps/<APP_ID>/settings/basic/`

> ⚠️ **The temporary token (①) lasts 24 hours.** Fine for a demo. For anything
> longer, create a **permanent System User token**: Business Settings → Users →
> System Users → add a user → assign the WhatsApp asset → Generate token
> (select `whatsapp_business_messaging` + `whatsapp_business_management`).

### 4.4 The webhook endpoint (already set up for us)
Meta delivers incoming messages to an HTTPS URL. **This is already live on our
VPS:**

```
https://agridosth.187-127-166-193.sslip.io/webhook/whatsapp
```

(nginx + Let's Encrypt, proxying to the bot on port 8080. Auto-renews. Uses the
same sslip.io pattern as the other apps on the box.)

### 4.5 Put the credentials on the VPS
Add the four values to `/root/Agribot/.env` **directly on the server** (never
paste tokens into chat/email):

```bash
ssh root@187.127.166.193
nano /root/Agribot/.env
```
Add:
```
WHATSAPP_CLOUD_TOKEN=<paste token ①>
WHATSAPP_PHONE_NUMBER_ID=<paste id ②>
WHATSAPP_APP_SECRET=<paste secret ③>
WHATSAPP_VERIFY_TOKEN=<the string you picked for ④>
# WHATSAPP_GRAPH_VERSION=v22.0     # optional, default is fine
```
All four must be present — the Cloud transport stays **off** unless every one is set.

### 4.6 Start the bot
```bash
cd /root/Agribot
pm2 restart agrifriend        # brings up Baileys + the Cloud webhook
pm2 logs agrifriend           # watch for "WhatsApp Cloud API transport active"
```
The endpoint should now answer (before this it returns 502 — that's expected).

### 4.7 Verify the webhook in Meta & subscribe
WhatsApp → **Configuration** → Webhook → **Edit**:
- **Callback URL:** `https://agridosth.187-127-166-193.sslip.io/webhook/whatsapp`
- **Verify token:** the same string you chose for ④
- Click **Verify and Save** (Meta calls our endpoint; it works only because the
  bot is now running with the token set).
- Then in **Webhook fields**, **Subscribe** to `messages`.

### 4.8 Add test recipients & test
WhatsApp → **API Setup** → Step 2 → "To" → **Manage phone number list** → add up
to **5** numbers (each confirms with a code). From one of those phones, message
the test number — Agri-Dosth should reply.

### 4.9 Going to production (real farmers)
1. Finish **business verification** (§4.1).
2. Register your **real dedicated number** to the WABA (irreversible — see §2).
3. Swap in a **permanent System User token** (§4.3).
4. (Optional) Submit **message templates** if you ever want to message farmers
   *outside* the 24-hour window (proactive tips). Reactive Q&A needs no templates.

---

## 5. Part B — Baileys (group chats)

Baileys links to a **real spare WhatsApp number** like WhatsApp Web, and is the
**only** way Agri-Dosth can participate in WhatsApp groups.

### 5.1 Prepare the number
- Get a cheap spare SIM, put it in a phone, install WhatsApp, activate the number.
- Keep that phone online (or the number registered) — Baileys links to it.

### 5.2 Pair it (scan the QR)
```bash
ssh root@187.127.166.193
cd /root/Agribot
pm2 restart agrifriend
pm2 logs agrifriend           # a QR code prints in the logs
```
Scan the QR from the spare phone: **WhatsApp → Settings → Linked Devices → Link a
Device**. Once linked, Baileys stays paired (auth is saved in `auth_info/`).

### 5.3 How groups work
- Add the spare number to the farmer group(s).
- The bot **only replies when triggered** — a message must contain the trigger
  word (default `agrifriend`, configurable via `BOT_TRIGGER`) or `@`-mention it.
  This keeps it from spamming every group message.
- In DMs to the spare number it replies normally.

### 5.4 Keeping the channels clean
Once 1:1 has fully moved to the official Cloud number, set:
```
BAILEYS_GROUPS_ONLY=true
```
Then Baileys serves **only groups** and ignores DMs (which the Cloud number now
handles) — a clean split with zero chance of double-answering. Default (unset)
keeps Baileys handling its own DMs too.

### 5.5 Ban-risk hygiene (built in)
Our Baileys layer already enforces reply-only, per-user + global rate limits, and
dedup. Don't use it for bulk/broadcast messaging — that's what gets numbers
banned. Reactive replies only.

---

## 6. Deployment & operations

### The VPS
- Host: `root@187.127.166.193` (Hostinger)
- Repo: `/root/Agribot`  (remote: `finalertserats-prog/Agribot`)
- Deploy branch: **`hardening/p0-p1`**
- Node: v20 · process manager: **PM2**

### PM2 processes
| App | Script | Purpose | Port |
|---|---|---|---|
| `agrifriend` | `dist/index.js` | **The WhatsApp bot** — Baileys (groups) + Cloud webhook (1:1) | 8080 (webhook) |
| `agridosth-web` | `dist/web/server.js` | The web-chat page (separate) | 8090 |
| `agrifriend-ops` | `dist/ops/copilot.js` | Optional self-heal monitor | — |

### Deploy a new version
```bash
ssh root@187.127.166.193
cd /root/Agribot
git fetch origin
git checkout hardening/p0-p1 && git pull
npm run build                 # compiles src → dist
pm2 restart agrifriend        # and/or agridosth-web
pm2 logs agrifriend
```

### Handy commands
```bash
pm2 list                      # what's running
pm2 logs agrifriend --lines 50
pm2 restart agrifriend
curl -sik https://agridosth.187-127-166-193.sslip.io/health   # webhook health
```

---

## 7. Environment variables reference

In `/root/Agribot/.env` (see `.env.example` for the full annotated list):

```bash
# --- AI provider (at least one) ---
OPENAI_API_KEY=...            # currently in use
# GEMINI_API_KEY=...          # free alternative
# LLM_PROVIDER=openai         # force one when both set

# --- Bot behavior ---
BOT_TRIGGER=agrifriend        # group trigger word
LOG_LEVEL=info

# --- WhatsApp Business Cloud API (1:1) — all four required to enable ---
WHATSAPP_CLOUD_TOKEN=         # ① access token
WHATSAPP_PHONE_NUMBER_ID=     # ② phone number ID (not the number)
WHATSAPP_VERIFY_TOKEN=        # ④ a random string you pick
WHATSAPP_APP_SECRET=          # ③ app secret
# WHATSAPP_GRAPH_VERSION=v22.0
# WHATSAPP_WEBHOOK_PORT=8080

# --- Baileys (groups) ---
# BAILEYS_GROUPS_ONLY=true     # set once 1:1 has moved to the Cloud number
```

**Never commit real values.** Only `.env.example` (placeholders) is in git.

---

## 8. Stability — how we compare to OpenClaw/Hermes

The worry was that frameworks like **OpenClaw** and **Hermes** are "much more
stable." The honest, evidence-based picture:

- **They use the same two transports we do** — Baileys/whatsapp-web.js for the
  unofficial path, and the **official Meta Cloud API** for the stable path.
  There is no secret third method. Adopting their framework would not give us a
  more stable *transport* than we already have.
- **Stability is engineering around the transport**, and our Baileys layer
  (`src/lib/whatsapp.ts`) already implements the production checklist:

| Production-stability feature | Ours |
|---|---|
| Official Cloud API (no sessions, no ban risk) | ✅ (this build) |
| Auth/session persistence (`useMultiFileAuthState`) | ✅ |
| Exponential-backoff auto-reconnect | ✅ |
| Correct logout-vs-transient handling (`DisconnectReason`) | ✅ |
| Listener/socket-leak fix across reconnects | ✅ |
| Duplicate-delivery dedup (persisted) | ✅ |
| Rate-limiting + reply-only (anti-ban) | ✅ |

- **The one enhancement bigger frameworks add:** a **database-backed auth store**
  (Redis/Postgres) instead of file-based `auth_info/`. Nice for scale/multi-instance;
  **not required** for this pilot. This is the only "stability" item on our
  optional backlog.

**Verdict:** we're at parity. Keep our codebase.

---

## 9. Current status & remaining checklist

### 🟢 LIVE — WhatsApp 1:1 is working (as of 2026-07-25)
A real message was answered end-to-end on the test number: a verified tester's
"Hi" → *"Hello Vishnu! 🌱 …"* (greeting by name, onboarding). Live details:
- **App:** Agri-Dosth (ID `2104345650468151`) · **WABA ID** `1763036808044853`
- **Test number:** +1 (555) 152-5698 · **Phone Number ID** `1134679136406565`
- **Permanent, never-expiring token** (System User `agridosth-bot`) in the VPS `.env`
- **Webhook** verified + subscribed to `messages` + **WABA subscribed to the app**
- **2 verified test recipients** (test-number cap = 5)

### ✅ Done
- [x] Cloud API adapter built (webhook + signature check + Graph API client + shared reply core)
- [x] Codex-reviewed; tests passing; ~86% coverage
- [x] Pushed to `finalertserats-prog/Agribot` (branch `hardening/p0-p1`)
- [x] Deployed & built on the VPS; web chat live (no regression)
- [x] HTTPS webhook endpoint live (cert auto-renews)
- [x] Meta app + WhatsApp Business Platform created; business portfolio "Agri Dosth"
- [x] Credentials on the VPS `.env`; **permanent token** generated & validated
- [x] Webhook verified, subscribed to `messages`, **WABA subscribed to app** (`subscribed_apps`)
- [x] **1:1 proven end-to-end** on the test number ✅

### ⏳ Remaining — to reach real farmers (open to anyone)
- [ ] A **real dedicated number** (registering it to the Cloud API removes it from the WhatsApp app — irreversible)
- [ ] **Business verification** (GST/MSME/utility docs) — lifts the 5-recipient cap; Meta approval takes days
- [ ] Register the number to the WABA (Step 2), then it's open to any farmer (no per-user OTP)

### ⏳ Remaining — to run in group chats
- [ ] Get a **real spare WhatsApp number** (SIM) — the 555 test number can't do this (§2)
- [ ] Pair it via QR (§5.2)
- [ ] Add it to the farmer groups; trigger with `agrifriend` (§5.3)
- [ ] *(Optional)* set `BAILEYS_GROUPS_ONLY=true` once 1:1 is on the Cloud number

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Webhook URL returns **502** | The `agrifriend` process isn't running. `pm2 restart agrifriend`. |
| Meta **"Verify and Save" fails** | Bot not running, or `WHATSAPP_VERIFY_TOKEN` in `.env` ≠ the token typed in Meta. They must match exactly; restart after editing `.env`. |
| Bot doesn't reply to a **real farmer** on the test number | Test number only messages the **5 verified recipients**. Add them, or move to a production number. |
| Cloud transport not activating | All **four** `WHATSAPP_CLOUD_*` vars must be set. Check `pm2 logs agrifriend` for "running Baileys-only". |
| Webhook verified but **inbound messages never arrive** (no POST in nginx) | The WABA isn't subscribed to the app. Fix: `POST /{WABA_ID}/subscribed_apps` with the token — the app-level "messages" field subscription alone is **not** enough. This was the missing step at go-live. |
| Access token stopped working after a day | Temporary token expired (24h). Switch to a **permanent System User token** (§4.3). |
| Baileys keeps showing a **QR / won't stay linked** | The spare number's WhatsApp got unlinked, or `auth_info/` was cleared. Re-scan (§5.2). |
| Signature check rejects Meta's POSTs (403) | `WHATSAPP_APP_SECRET` is wrong/missing. Copy it again from App Settings → Basic. |

---

*Maintained alongside the code. When the setup changes, update this file.*
