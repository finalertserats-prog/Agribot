# Operator Runbook — Going Live on WhatsApp Business Platform

This is the **one remaining task to make AgriFriend send for real.** The whole
codebase is built and tested; it currently uses a safe *stub* transport that
logs instead of sending. This runbook walks you (the operator) through the
WhatsApp Business Platform (Cloud API) setup. When you finish Steps 1–5, hand
back the four values in **Step 6** and the developer wires the real transport
(~30 min) and flips the switch.

> Meta's console UI changes often. The concepts below are stable; when a screen
> looks different, follow the official docs at **developers.facebook.com/docs/whatsapp**.

---

## Why this is required (don't skip)

The bot currently runs on **Baileys (unofficial WhatsApp)** — fine for a reactive
pilot, but **proactive/outbound messaging on it gets numbers banned.** Outbound
at any scale **must** use the official WhatsApp Business Platform. This is the
gate for the entire proactive feature set.

---

## Prerequisites
- A **Facebook/Meta account** with admin rights.
- A **business** (name, website/social, address) for verification.
- A **phone number** that is **NOT currently registered on the WhatsApp consumer
  app** (you can migrate one, but a fresh number is simplest).
- A credit/debit card (WhatsApp conversations are paid; see Step 7).

---

## Step 1 — Create the Meta Business + WhatsApp app
1. Go to **business.facebook.com** → create/confirm a **Meta Business Account**.
2. Go to **developers.facebook.com** → **My Apps** → **Create App** → type
   **Business**.
3. In the app dashboard, **Add Product → WhatsApp → Set up**.
4. This creates a **WhatsApp Business Account (WABA)** and a free **test number**
   you can use to try the API immediately.

## Step 2 — Add and verify your real number
1. In **WhatsApp → API Setup**, click **Add phone number**.
2. Enter your business display name and the phone number; verify via SMS/call.
3. Complete **Business Verification** in **Business Settings → Security Center**
   (required to lift messaging limits and go to production). This can take a few
   days — start it early.

## Step 3 — Get a permanent access token
The token shown on the API Setup page is **temporary (24h)** — good for testing,
not production. For production:
1. **Business Settings → Users → System Users → Add** → create a *System User*
   (role: Admin).
2. **Add Assets** → assign your **app** and your **WABA** to the system user.
3. **Generate New Token** → select the app → grant **`whatsapp_business_messaging`**
   and **`whatsapp_business_management`** → set expiry to **Never**.
4. **Copy the token now** — it is shown only once. Treat it like a password
   (never paste it into chat/email; store it in a secret manager).

## Step 4 — Submit message templates for Meta approval
Outbound proactive messages **must** use pre-approved templates. Create them in
**WhatsApp Manager → Message Templates → Create Template**.

Create one per message type **per language** you support. The bodies mirror
`src/policy/templates.ts` — but Meta uses **positional** placeholders `{{1}}`,
`{{2}}`… (not named). Use this mapping:

| Template (name it exactly) | Category | Body to submit | Variables in order |
|---|---|---|---|
| `seasonal_tip` | UTILITY | `🌱 Hi {{1}}, a seasonal tip for your {{2}}: {{3}}` | name, crop, tip |
| `crop_stage_reminder` | UTILITY | `🌾 Hi {{1}}, your {{2}} is at {{3}}. Next step: {{4}}` | name, crop, stage, step |
| `weather_alert` | UTILITY | `⛅ Weather alert for {{1}}: {{2}}. Suggested action: {{3}}` | area, alert, action |
| `market_price` | UTILITY | `📈 {{1}} price at {{2}} today: {{3}}. {{4}}` | crop, market, price, note |
| `outbreak_alert` | UTILITY | `🚨 Alert for {{1}}: {{2}}. Act now: {{3}}` | area, threat, action |
| `pest_diagnosis` | UTILITY | `🔎 Hi {{1}}, about your {{2}}: {{3}}. Suggested next step: {{4}}` | name, crop, finding, step |

Notes:
- Add a template for **each language** (Hindi, Marathi, Telugu, …). Meta approves
  each language separately. The code already refuses to send a candidate with no
  approved template, so start with English + your top regional language.
- **Category matters for pricing/rules.** UTILITY is for transactional/service
  content; if Meta reclassifies advisory tips as MARKETING, they require opt-in
  and are priced as marketing conversations.
- Approval usually takes minutes to a few hours; rejected templates tell you why.

## Step 5 — Configure webhooks (delivery + inbound + opt-out)
Webhooks feed the bot's delivery-quality and opt-out logic.
1. In the app: **WhatsApp → Configuration → Webhooks → Edit**.
2. **Callback URL:** the developer will give you an HTTPS endpoint (e.g.
   `https://your-vps/whatsapp/webhook`). **Verify token:** any secret string —
   share it with the developer.
3. **Subscribe** to at least: `messages` (inbound + status: sent/delivered/read/
   failed).
4. Copy the app's **App Secret** (Settings → Basic) — used to verify webhook
   signatures. Treat as a secret.

## Step 6 — Hand these back to the developer (securely)
Provide via a **secret manager / password vault**, never plaintext chat/email:

| Value | Where it came from | Env var it maps to |
|---|---|---|
| Permanent access token | Step 3 | `WHATSAPP_ACCESS_TOKEN` |
| Phone Number ID | API Setup page (not the phone number itself) | `WHATSAPP_PHONE_NUMBER_ID` |
| WABA ID | API Setup / Business Settings | `WHATSAPP_WABA_ID` |
| App Secret + webhook verify token | Step 5 | `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |

The developer then: implements `WhatsAppCloudTransport.send()` (POST to the
Graph API `/{phone-number-id}/messages` with the approved template + variables),
wires the webhook to the `DeliveryStore` + opt-out path, sets the env vars, and
flips **`PROACTIVE_ENABLED=true`**. Done — it sends for real.

---

## Step 7 — Costs (India, budget before you scale)
- WhatsApp charges **per conversation** (a 24-hour session), not per message.
- India rates vary by category (marketing / utility / service) and change —
  check the current **WhatsApp pricing** page. Budget this into unit economics
  (see the Go-to-Market document).
- The bot's **global + daily Gemini ceilings** and **per-farmer frequency caps**
  already bound volume; set `maxPerTenantPerDay` / rate limits to your budget.

## Step 8 — Consent & compliance (do this in parallel)
- Collect **explicit opt-in** before any proactive message (WhatsApp policy +
  India DPDP Act). The code enforces consent, but *you* must capture it — e.g.
  during dealer onboarding — and record the basis.
- Support **opt-out**: the code detects "STOP"/regional equivalents; make sure
  your onboarding tells farmers how to opt out.
- Add a short **advisory disclaimer** ("informational, not a substitute for a
  certified agronomist") to onboarding.

## Step 9 — Watch the quality rating
- Meta assigns your number a **quality rating** (green/yellow/red). Spammy or
  ignored messages drop it and can **restrict or suspend** sending.
- If it drops: the operator flips **`PROACTIVE_ENABLED=false`** to degrade to
  **reactive-only** instantly (the code supports this) while you investigate.

---

## Quick checklist
- [ ] Meta Business account + WhatsApp app created (Step 1)
- [ ] Real number added + **business verification** started (Step 2)
- [ ] **Permanent** system-user token generated & stored securely (Step 3)
- [ ] Templates submitted & **approved** for EN + top regional language (Step 4)
- [ ] Webhooks configured; app secret captured (Step 5)
- [ ] 4 values handed to developer via secret manager (Step 6)
- [ ] Opt-in capture + opt-out messaging live (Step 8)
- [ ] Budget set; pricing understood (Step 7)

When Steps 1–6 are done, tell the developer — final wiring is ~30 minutes.
