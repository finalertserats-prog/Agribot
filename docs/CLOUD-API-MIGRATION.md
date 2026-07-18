# Agri-Dosth → WhatsApp Cloud API Migration

Moving from **Baileys** (unofficial WhatsApp Web, our current pilot) to the
**official WhatsApp Business Platform (Cloud API)**. This eliminates the
ban/logout problem entirely and unlocks sanctioned proactive messaging.

> Reviewed by all three peers (Claude + Gemini + Codex). Pricing is India-specific
> and current as of **July 2026** — reconfirm on Meta's pricing page before you commit,
> rates change.

---

## TL;DR
- **Not a config flip** — it's an *adapter* (Cloud webhook → our `handler.ts`) plus
  some production infra (webhook server, DB migration). Realistic effort: a focused
  build, not a weekend.
- **Cheap to run**: ~₹1,000/mo now (mostly hosting), ~₹1,300/mo after Oct 2026.
- **Decide 3 things first** (below) before any code.

## ⚠️ Decide these THREE things before starting

1. **Do farmers use WhatsApp GROUPS?** The Cloud API **does not support groups** the
   way Baileys does. If village/co-op groups are a channel today, migrating removes it.
   → Options: keep Baileys *only for groups*, or redesign around 1:1 DMs.
2. **Same number or a new number?** Registering a number to the Cloud API **removes it
   from the normal WhatsApp app** — largely **irreversible**, with downtime during
   cutover. A *new* dedicated number is cleaner but means farmers must re-opt-in to it.
3. **Migrate the database first.** Our `sql.js` single-file DB + flat-JSON vector store
   **cannot be safely written by two transports at once**. Move to real SQLite/Postgres
   *before* running Baileys and Cloud side-by-side.

---

## 1. Cost (India, per-message model since 1 July 2025)

Meta charges **per delivered template message**. Rates (INR, effective Jan 1 2026):

| Category | Per delivered message | What it's for |
|---|---|---|
| **Service** (user-initiated, inside 24h window) | **Free** — *until Sep 30 2026* | Our reactive Q&A replies |
| **Utility** | ~₹0.115 (~$0.0014) | Alerts, confirmations, status |
| **Authentication** | ~₹0.115 | OTPs |
| **Marketing** | ~₹0.86 (~$0.010) | Promotional / broad tips |

**Key facts:**
- The old **1,000 free conversations/month is gone.**
- **Customer Service Window (CSW):** inbound messages from a farmer *and your free-form
  replies* are **free within 24h** of their last message — **until Sep 30 2026**.
- **From Oct 1 2026:** service messages inside the window become **billable** (~₹0.115/msg,
  final rates published by Sep 1 2026). Budget for this.
- **Free entry points:** conversations from a Click-to-WhatsApp ad are free for 72h.
- **18% GST** applies on top in India.

### Pilot estimate (100–500 farmers, reactive)
| | Now (→ Sep 2026) | After Oct 1 2026 |
|---|---|---|
| Meta messaging | **₹0** (all replies in 24h window) | ~₹230 + GST (≈2,000 replies/mo × ₹0.115) |
| Server/webhook hosting | ~₹500–1,000 | ~₹500–1,000 |
| **Total** | **~₹1,000/mo** | **~₹1,300/mo** |

> Plus: OpenAI/Gemini usage (unchanged from today) and any queue/observability infra.
> Going **direct** to Meta (not via a BSP like Gupshup/Twilio) avoids per-message markups.

---

## 2. Meta-side setup (what YOU do — can start now, in parallel with the pilot)

1. **Meta Business Account** — create at business.facebook.com. Set billing currency to **INR**.
2. **Business Verification** — upload legal docs (GST certificate / MSME / utility bill).
   Lifts the sandbox cap (250 msgs/day) to production limits. Takes days — **start early.**
3. **Create a Meta App** (developer portal, type "Business") → add the **WhatsApp** product
   → this creates a **WhatsApp Business Account (WABA)**.
4. **Register a phone number** to the WABA (verify via SMS/voice OTP).
   - ⚠️ The number **must not be active** on the WhatsApp app first (delete that account if so).
   - This is the **irreversible** step — pick the number per decision #2 above.
5. **Generate a permanent access token** — create a **System User** in Business Settings,
   assign the WhatsApp assets, generate a token. (Treat it as a rotextable secret, not "forever".)
6. **Create + submit message templates** — needed only for **outbound outside the 24h window**
   (proactive tips/alerts). Approval is usually minutes, but farming *advisory* wording can be
   **rejected** as too personalized/promotional — expect iteration.
7. **Configure the webhook** — point Meta at our HTTPS webhook URL (built below); subscribe to
   `messages` + status events.

---

## 3. Code-side work (what I build)

The repo already has a `WhatsAppCloudTransport` placeholder + `OPERATOR-RUNBOOK.md`. The real
work is an **adapter layer** — `handler.ts` is Baileys-shaped and must not be fed raw Cloud payloads.

- **Webhook server** (Express/Fastify): HTTPS endpoint that
  - verifies `X-Hub-Signature-256` against the **raw request body** (not parsed JSON),
  - **ACKs 200 fast**, then processes async (queue) — Meta retries on slow responses → duplicates,
  - handles the `GET` verification challenge.
- **Cloud → handler adapter**: normalize Cloud's `wa_id` / `messages[]` / media objects into the
  shape `handleMessage` expects (sender, text, image). Outbound: POST to Graph `/messages`.
- **Durable dedup by `wamid`** — replace the Baileys-message-id `SeenCache` with a persistent
  store keyed by Cloud's `wamid` (Meta redelivers; we must not double-reply).
- **24h-window tracking** — record each farmer's **last inbound timestamp from Cloud events**;
  gate free-form replies vs template-required on it (don't infer from local rows).
- **ID canonicalization to E.164** — so existing `STOP`/`DELETE` opt-outs (keyed by Baileys JIDs)
  still apply to the same farmer under Cloud's phone-number identity. **Critical for opt-out continuity.**
- **Media via the Media API** — Cloud gives short-lived, bearer-authed URLs (different from Baileys'
  decrypted `imageMessage`); download + size/MIME checks in the adapter.
- **Status webhooks** — handle `sent/delivered/read/failed`; a `failed` (blocked user, invalid number,
  template rejected) means the farmer never got it — surface it, don't assume success.
- **DB migration first** — move `sql.js` → SQLite/Postgres and the JSON vector store → a real store,
  so a single writer owns the data (prerequisite for any dual-run).
- **Outbound policy** — extend the existing Policy Engine to also understand Meta **template category,
  language, opt-in basis, CSW state, and quality rating** — an "approved templateId" gate alone isn't enough.
- **Contract tests** — real Cloud webhook fixtures (text, image, status callbacks, duplicate delivery,
  malformed payloads). Our current tests are Baileys-shaped and won't catch Cloud failures.

---

## 4. Recommended sequence

1. **Now:** finish warming up 9176207316 → run the **free Baileys pilot** to prove farmers love
   Agri-Dosth. Zero cost, zero Meta dependency.
2. **In parallel:** start **Meta business verification** (the slow part — days).
3. **Then:** migrate the DB off `sql.js`; build the CloudTransport adapter + webhook server.
4. **Cutover:** register the number (or a new one), get templates approved, dual-run briefly if the
   DB is ready, then retire Baileys. Communicate the number to farmers if it changed.

---

## Watch-outs (from the adversarial review)
- **Groups vanish** on Cloud API — biggest silent regression if farmers use them.
- **Number registration is one-way** — no easy rollback to the app.
- **Quality rating** — spammy/repeated proactive alerts can throttle or restrict the WABA fast.
- **Token isn't truly "permanent"** — add health checks + rotation + alerting.
- **Template rejection** — farming "spray now" / market-price nudges may need careful, locked wording.
- **Costs beyond messaging** — media bandwidth, queue infra, observability, higher AI usage from
  reliable delivery.
