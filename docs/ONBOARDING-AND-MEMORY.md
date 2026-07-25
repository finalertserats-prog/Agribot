# Onboarding & "Remember Me" — Design & Roadmap

How Agri-Dosth collects a farmer's details once, remembers them, and uses that
context for better answers — across the **web chat** (built) and **WhatsApp**
(planned). This is the reference for the feature.

---

## Goal
A first-time user is greeted and asked for a few details (name, area, phone).
We store them durably, and on every return we **greet them by name** and feed
their profile into the AI so answers are tailored — instead of asking the same
questions again. The farmer feels *remembered*.

---

## What's built now (Web chat) ✅

- **First-visit form.** New web users get a real 3-field card in the chat —
  **name (required)**, **village/area (optional)**, **phone (optional)** —
  instead of free-text prompting. (`public/index.html`)
- **Durable storage.** The form posts to `POST /api/profile`, which writes the
  profile via `setUserProfile()` and **flushes to disk immediately**, so a
  just-onboarded farmer survives a crash. (`src/web/profile.ts`, `src/lib/database.ts`)
- **Returning-user check.** On load the page calls `GET /api/profile?sessionId=…`;
  if the server says `onboarded`, it skips the form and shows
  **"Welcome back, {name}!"** with a *"Not {name}? tap here"* reset (for shared
  phones/kiosks).
- **Confirmed fields win.** Form-entered name/location/phone are marked
  *confirmed*; opportunistic AI extraction can no longer overwrite them (a later
  "my brother Ramesh…" can't rename a farmer who told us they're "Ravi").
- **Edit / delete.** The ⚙️ button lets a user edit their details or **erase all
  data** (`DELETE /api/profile`) — DPDP parity with the WhatsApp DELETE command.
- **Abuse guards.** The public endpoint has schema validation, length caps,
  phone sanity-check, body limit, and a per-session rate limit.

### Known limitation (web)
`sessionId` is client-generated (localStorage). It's random and rate-limited,
but not authenticated — acceptable for a farming pilot. If we ever need
stronger identity, move to a **server-issued httpOnly session cookie**.

---

## WhatsApp — the planned path 🗺️ (not built yet)

The important reality: **you cannot render "three input boxes" in a normal
WhatsApp message.** WhatsApp only allows structured input through **WhatsApp
Flows**, which are **official Cloud API only**. So there are two tiers:

### Tier 1 — MVP: conversational capture (recommended first)
This mostly **already exists** in the shared reply core and just needs to be
made explicit.

- **We already know the phone** — on WhatsApp the sender's number *is* their
  `wa_id`. So **don't ask for phone**; only collect **name + area**.
- **First contact:** the system prompt already greets a new farmer and asks for
  name + village; `extractProfile()` pulls those from the reply and
  `updateUserProfile()` stores them (now protected by the confirmed-field rule).
- **Returning farmer:** the profile is injected into context and the prompt
  greets them by name.
- **To finish this tier:** wire the WhatsApp identity (`wa_id`) to auto-fill the
  phone field on first contact, and add an explicit "Welcome back, {name}" line
  (mirroring the web `greetBack`) so it's consistent, not just model-driven.
- **Consent/DELETE/STOP:** already enforced in `core/reply.ts` for both channels.

**Effort:** small — it's polish on existing behavior. No Meta setup.

### Tier 2 — WhatsApp Flows (a real form, later)
A **Flow** shows genuine input fields (name, area) inside WhatsApp, on the
official Cloud API. It's the closest match to the web form, but it's a **separate
integration**, so treat it as an experiment *after* Tier 1 proves out.

What it takes:
1. **Cloud API live** (see `WHATSAPP-SETUP-GUIDE.md`) — Flows don't work on Baileys.
2. **Build a Flow** in Meta's Flow Builder: a form screen with `TextInput`
   components for name + area; publish it (versioned; Meta reviews).
3. **Send the Flow** as an interactive message on first contact (a `flow`-type
   message referencing the published Flow ID + a flow token).
4. **Handle the Flow response** — Meta posts the submitted fields to our webhook
   as a `nfm_reply`/interactive payload; parse it and call `setUserProfile()`.
5. **Fallback is mandatory** — if the Flow fails, expires, or the client doesn't
   support it, fall back to Tier 1 conversational capture so onboarding never
   dead-ends.

**Effort:** significant (Flow JSON, flow tokens, publish/version, webhook
parsing, review). **Only pursue if Tier 1 retention shows it's worth it.**

### Groups (Baileys)
No Flows, no structured forms. Keep it conversational and be careful **not to
carry one group's personalization into another** — group replies should stay
general unless the farmer has DM'd the bot and consented to personalization.

---

## Identity model (all channels)
- **Web:** profile keyed by the browser `sessionId` (`web-…`).
- **WhatsApp 1:1:** keyed by `wa_id`.
- **The same farmer on web and WhatsApp is two separate profiles** — we do *not*
  link them (no reliable shared key, and linking without consent is risky).
  That's acceptable; each channel remembers them independently.
- Profiles are namespaced by their channel-native id; there's no cross-channel
  key collision because the id formats differ.

---

## Build order recommendation
1. ✅ **Web form + durable profile + remember-me** (done).
2. ⏭️ **WhatsApp Tier 1** (conversational, name+area, auto-phone from `wa_id`,
   explicit welcome-back) — do this when the Cloud API goes live.
3. 🔬 **WhatsApp Flows (Tier 2)** — only if Tier 1 proves onboarding lifts
   retention, and after Cloud API operational readiness.

*Maintained alongside the code. Update when the WhatsApp path is built.*
