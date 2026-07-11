# -*- coding: utf-8 -*-
"""Content for the 5-document AgriFriend pack.

Single source of truth: each document exposes detailed() and summary() so the
two variants cannot drift. Honesty-first (Codex review) + India-market realism
(Gemini review) are baked in.
"""

DATE = "11 July 2026"
COMMIT = "73e7cf9"
VERDICT = "GO WITH CAVEATS"

DOCS = ["01_Original_Repo", "02_What_We_Built", "03_Deployment_VPS_Scaling",
        "04_Risks_and_Readiness", "05_GoToMarket_Monetization"]

TITLES = {
    "01_Original_Repo": "The Original AgriFriend Bot",
    "02_What_We_Built": "What We Built — The Hardening",
    "03_Deployment_VPS_Scaling": "Going Live: Deployment, VPS & Scaling",
    "04_Risks_and_Readiness": "Production Readiness, Risks & Mitigations",
    "05_GoToMarket_Monetization": "Go-to-Market, Monetization & Growth",
}
SUBTITLES = {
    "01_Original_Repo": "What the original repository is and how it works",
    "02_What_We_Built": "From prototype to hardened service — engineered and reviewed",
    "03_Deployment_VPS_Scaling": "Running it for real: servers, operations, and how it scales",
    "04_Risks_and_Readiness": "An honest go/no-go, the risks, and how to close them",
    "05_GoToMarket_Monetization": "Turning a working bot into a useful, revenue-yielding product",
}

HONESTY = ("honesty", "Read this first",
           "This pack is deliberately honest. The bot's engineering foundations are strong, "
           "but it has **never been run against live WhatsApp + Gemini**, its core message "
           "handler is **not yet covered by tests**, and it runs on an **unofficial WhatsApp "
           "library**. Every claim here is written to be defensible, not to sell.")


# ============================================================ DOC 1
def doc01():
    d = [
        ("h1", "1. Executive Overview"),
        ("callout",) + HONESTY,
        ("p", "**AgriFriend** is a WhatsApp chatbot that acts as a farming consultant. A farmer "
              "sends a question — or a photo of a sick plant — into a WhatsApp group or a direct "
              "message, and the bot replies with practical, AI-generated agricultural advice. It is "
              "designed to live inside the WhatsApp farming communities that Indian smallholders "
              "already use every day, rather than asking them to download a new app."),
        ("kpi", [("~662", "lines of TypeScript"), ("8", "source files"),
                 ("5", "core features"), ("1", "VPS to run it")]),
        ("p", "This document describes the **original** repository "
              "(github.com/Shivaganesh-dev/agrifriend-bot) exactly as it was — its features, "
              "architecture, and its real limitations. The companion document *\"What We Built\"* "
              "covers the hardening we layered on top."),

        ("h1", "2. What Problem It Solves"),
        ("p", "Smallholder farmers rarely have on-demand access to an agronomist. Extension "
              "officers are stretched thin, and generic web search is a poor fit for a farmer in a "
              "field holding a leaf with brown spots. AgriFriend meets the user where they already "
              "are — WhatsApp — and answers in plain language:"),
        ("bul", [
            "**Crop & gardening questions** — fertiliser, watering, pests, soil, seasons.",
            "**Plant-photo diagnosis** — the user sends a picture; the bot analyses it for disease or health.",
            "**Memory** — it remembers a user's past conversations for continuity.",
            "**Encouragement** — it proactively praises healthy plants and harvests.",
            "**Focus** — it politely declines non-farming topics to stay on-mission.",
        ]),

        ("h1", "3. Feature Set"),
        ("table", ["Feature", "How it works", "Notes"], [
            ["Text Q&A", "Gemini 2.0 Flash answers farming questions", "Concise, WhatsApp-friendly tone"],
            ["Image diagnosis", "Gemini vision analyses a plant photo", "See limitations — was broken originally"],
            ["Conversation memory", "Last 3 messages + vector recall", "Per-user context"],
            ["Domain guardrail", "Keyword list filters off-topic text", "Canned reply if off-topic"],
            ["Group etiquette", "Only replies when 'agrifriend' is used", "Avoids spamming groups"],
        ]),

        ("h1", "4. Technology Stack"),
        ("table", ["Layer", "Choice", "Why / caveat"], [
            ["Runtime", "Node.js 22 + TypeScript", "Strict typing"],
            ["WhatsApp", "Baileys (@whiskeysockets)", "**Unofficial** WhatsApp Web library — ban risk"],
            ["AI", "Google Gemini 2.0 Flash", "Text + vision; free tier used"],
            ["Database", "sql.js (SQLite in WebAssembly)", "Whole DB is exported to file on write"],
            ["Vector memory", "Hand-rolled JSON store", "Brute-force cosine similarity"],
            ["Process mgmt", "PM2", "Auto-restart, boot persistence"],
            ["Hosting", "Single Ubuntu VPS (Hostinger)", "One process, one number"],
        ]),

        ("h1", "5. System Architecture"),
        ("p", "The original design is a single Node.js process. Baileys maintains the WhatsApp "
              "connection; a central handler in `index.ts` applies the domain guardrail, assembles "
              "context, and routes the message to Gemini; results are persisted to SQLite and a JSON "
              "vector store."),
        ("img", "01_original_architecture.png", "Original AgriFriend system architecture."),

        ("h1", "6. Message Handling Flow"),
        ("p", "Every inbound message runs through the same pipeline: group-trigger check, domain "
              "guardrail, context assembly, Gemini call, persistence, and reply."),
        ("img", "02_message_flow.png", "How one inbound message becomes a reply."),

        ("h1", "7. Memory & Context"),
        ("p", "For each user the bot assembles up to three context sources before calling the model: "
              "recent conversation history from SQLite, semantically similar past memories from the "
              "vector store, and a stored user profile (plants / issues / location)."),
        ("img", "05_memory_layers.png", "Three-layer context assembly (as hardened)."),
        ("callout", "note", "Profile layer was inert originally",
         "In the original code the user-profile fields were **never populated** — the context block "
         "existed but was always empty. We made it real in the hardening pass."),

        ("h1", "8. Data Model"),
        ("bul", [
            "**users** — id, name, groupId, plants, issues, location, firstSeen, lastSeen.",
            "**interactions** — id, userId, groupId, userName, message, response, hasImage, timestamp.",
            "Persistence: the entire sql.js database is exported and rewritten to disk on every write.",
        ]),

        ("h1", "9. How It Was Deployed"),
        ("p", "A one-command `setup.sh` provisioned an Ubuntu VPS: install Node 22, install PM2, "
              "`npm install`, build, and start under PM2. The operator then scanned a QR code with a "
              "spare WhatsApp phone to link the device."),

        ("h1", "10. Limitations of the Original (Honest)"),
        ("p", "The original was a capable **prototype**, but it carried real weaknesses that would "
              "bite in production. These are exactly what the hardening pass set out to fix:"),
        ("bul", [
            "**Event-loop blocking** — the whole database was rewritten synchronously on every message.",
            "**Crash risk** — an unhandled error could kill the process.",
            "**Reconnect leak** — repeated reconnects stacked event listeners.",
            "**Broken image analysis** — the vision feature passed the wrong argument and silently failed.",
            "**Dead profile feature** — profile context was always empty.",
            "**No rate limiting or cost controls** on paid Gemini calls.",
            "**No tests, no config validation, console-only logging.**",
            "**Unofficial WhatsApp library** — inherent account-ban risk (unchanged by any amount of code).",
        ]),
        ("callout", "note", "Where this leads",
         "The next document, *What We Built*, addresses items 1–7 above directly. Item 8 (unofficial "
         "WhatsApp) is a product-level decision covered in *Risks & Readiness*."),
    ]
    s = [
        ("h1", "AgriFriend — The Original, in Brief"),
        ("callout",) + HONESTY,
        ("p", "**AgriFriend** is a WhatsApp bot that gives farmers practical, AI-generated farming "
              "advice — including diagnosing plant photos — inside the WhatsApp groups they already "
              "use. This is the original repository (Shivaganesh-dev/agrifriend-bot): ~662 lines of "
              "TypeScript, a single Node.js process on one VPS."),
        ("kpi", [("~662", "lines of code"), ("Gemini", "2.0 Flash AI"),
                 ("Baileys", "WhatsApp (unofficial)"), ("1 VPS", "single process")]),
        ("h2", "What it does"),
        ("bul", [
            "Answers farming / gardening / plant questions in plain language.",
            "Diagnoses plant photos for disease and health.",
            "Remembers past conversations; praises healthy plants; stays on farming topics.",
        ]),
        ("img", "01_original_architecture.png", "Original architecture at a glance."),
        ("h2", "The honest caveats"),
        ("bul", [
            "Blocking writes, crash risk, reconnect leak, and a **broken image feature**.",
            "No tests, no rate limiting, no config validation.",
            "Runs on an **unofficial** WhatsApp library — inherent ban risk.",
        ]),
        ("p", "These are the exact weaknesses the hardening pass (next document) set out to fix."),
    ]
    return d, s


# ============================================================ DOC 2
def doc02():
    d = [
        ("h1", "1. From Prototype to Hardened Service"),
        ("callout",) + HONESTY,
        ("p", "The original AgriFriend worked as a demo, but several of its behaviours would fail in "
              "production — some quietly. We ran a structured hardening pass: fix the correctness and "
              "safety issues, add cost and abuse controls, introduce a test suite, and — crucially — "
              "have every change independently reviewed. This document is a source-backed account of "
              "exactly what changed."),
        ("kpi", [("30+", "issues addressed"), ("48", "unit tests added"),
                 ("7", "adversarial review rounds"), ("3", "commits")]),
        ("callout", "note", "Traceability",
         "Everything here maps to real commits on the hardened repo "
         "(github.com/finalertserats-prog/Agribot): `40c8366` (P0–P2 hardening), "
         "`eeb5621` (Phase 1 bug fixes), `73e7cf9` (tooling)."),

        ("h1", "2. How We Worked"),
        ("p", "The pass was not a single edit. It followed a review-driven loop:"),
        ("num", [
            "**Prioritise** issues into P0 (correctness), P1 (scale/robustness), P2 (quality).",
            "**Implement** each fix with a focused unit test where the logic is pure.",
            "**Adversarial review** — an independent code reviewer (OpenAI Codex) challenged every "
            "change; findings were fixed and re-reviewed across multiple rounds.",
            "**Council go/no-go** — a multi-model panel assessed production readiness (see *Risks & Readiness*).",
            "**Verify** — type-check, build, and full test run had to pass before commit.",
        ]),

        ("h1", "3. The Hardened Architecture"),
        ("img", "03_hardened_architecture.png", "Hardened architecture — green marks what we added or rewrote."),

        ("h1", "4. Before vs After"),
        ("img", "04_before_after.png", "The hardening delta at a glance."),

        ("h1", "5. Correctness & Safety (P0)"),
        ("table", ["Area", "What we changed", "Why it matters"], [
            ["Persistence", "Atomic + debounced async writes (temp-file + rename)",
             "No more event-loop stalls or torn files on crash"],
            ["Crash safety", "Wrapped fallible calls; process-level safety nets",
             "A stray error logs instead of crash-looping under PM2"],
            ["Reconnect", "Detach old listeners; capped backoff; retry on failure",
             "No listener leak; bot recovers instead of staying offline"],
            ["Image download", "Pass the media message, not the whole envelope",
             "Restores photo diagnosis (was broken since v1)"],
            ["User profile", "Opportunistic extraction + merge",
             "The profile context is now real, not always-empty"],
            ["History order", "Order by row id, not timestamp",
             "Same-millisecond messages no longer sort unpredictably"],
        ]),

        ("h1", "6. Scale & Robustness (P1)"),
        ("table", ["Area", "What we changed", "Why it matters"], [
            ["RAG memory", "Filter by user first; per-user cap; skip when few",
             "Bounds compute and paid embedding calls"],
            ["Rate limiting", "Per-user sliding window + global + daily ceiling",
             "Caps abuse and total Gemini spend"],
            ["Guardrail", "Keyword fast-path, then model classifier (fails open)",
             "Fewer wrong rejections; classifier is rate-limited"],
            ["Deduplication", "Restart-safe: id persisted only after success",
             "No double-replies after a restart"],
            ["Retry", "429 backoff on all Gemini calls incl. embeddings",
             "A rate-limit blip no longer drops data"],
        ]),

        ("h1", "7. Quality (P2)"),
        ("bul", [
            "**Config validation** — environment is validated with Zod and fails fast with a clear message.",
            "**Structured logging** — all output routed through pino instead of console.log.",
            "**Documentation** — a HARDENING.md records every change and its trade-offs.",
            "**Tests** — 48 unit tests covering the pure logic (see §8).",
        ]),

        ("h1", "8. Security Hardening"),
        ("p", "User text is untrusted. Because we now persist model-extracted profile facts and feed "
              "conversation history back into prompts, we added defences against **stored prompt "
              "injection**: extracted fields are sanitised, and all retrieved context is wrapped and "
              "labelled as data-only, with delimiter characters stripped so it cannot break out of "
              "its wrapper."),
        ("callout", "warn", "Mitigation, not prevention",
         "Prompt-injection framing **reduces** risk; it does not eliminate it. The model still "
         "receives untrusted context and the user's live message. Treat the guardrail as "
         "defence-in-depth, not a guarantee."),

        ("h1", "9. Test Suite & Coverage (Honest)"),
        ("p", "We added 48 unit tests. They give real confidence in the **primitives** — the rate "
              "limiter, deduplication cache, persistence engine, database round-trips, cosine "
              "similarity, and domain filtering are all well covered."),
        ("callout", "honesty", "The coverage gap that matters",
         "Overall line coverage is **~38%**. The two most production-critical files — the WhatsApp "
         "message handler (`index.ts`) and the connection lifecycle (`whatsapp.ts`) — are at **0% "
         "test coverage**. Their logic is reviewed and reasoned about, but nothing yet exercises it "
         "end-to-end. Closing this is 'Phase 2' and is required before an unattended production run."),
        ("table", ["Module", "Coverage", "Status"], [
            ["seen / logger / rateLimiter", "96–100%", "Strong"],
            ["database / domain / persist", "87–93%", "Strong"],
            ["gemini.ts", "~12%", "Only a string helper tested"],
            ["memory.ts", "~21%", "Only cosine tested"],
            ["index.ts (handler)", "0%", "Untested — Phase 2"],
            ["whatsapp.ts (lifecycle)", "0%", "Untested — Phase 2"],
        ]),

        ("h1", "10. What We Deliberately Did Not Do"),
        ("bul", [
            "**Integration tests** for the message handler and reconnect logic (Phase 2).",
            "**A live run** — the bot has not been booted against real WhatsApp + Gemini.",
            "**Multi-instance scaling** — deferred; see the scaling roadmap.",
            "**Migration off the unofficial WhatsApp library** — a product decision, not a code fix.",
        ]),
        ("h1", "11. Net Result"),
        ("p", "The engineering foundations are now solid and independently reviewed: the crash risk "
              "is gone, the broken image feature works, persistence is crash-consistent, and cost and "
              "abuse are bounded. What remains before a confident production launch is **proving** the "
              "system — integration tests plus a real live run — and the product-level decision about "
              "the WhatsApp platform."),
    ]
    s = [
        ("h1", "What We Built — In Brief"),
        ("callout",) + HONESTY,
        ("p", "We took the AgriFriend prototype and ran a review-driven hardening pass: fix the "
              "correctness and safety bugs, add cost/abuse controls, and introduce tests — with every "
              "change independently reviewed by an adversarial code reviewer across several rounds."),
        ("kpi", [("30+", "issues fixed"), ("48", "tests added"),
                 ("~38%", "coverage (honest)"), ("GO w/ caveats", "readiness")]),
        ("img", "04_before_after.png", "The hardening delta."),
        ("h2", "Highlights"),
        ("bul", [
            "**Fixed:** crash risk, broken image analysis, reconnect leak, blocking writes, dead profile.",
            "**Added:** atomic persistence, per-user + global cost ceilings, restart-safe dedup, retries.",
            "**Hardened:** prompt-injection framing (mitigation, not prevention), Zod config, pino logs.",
        ]),
        ("callout", "honesty", "The honest gap",
         "Coverage is ~38%; the **core message handler and connection lifecycle are at 0% test "
         "coverage**, and the bot has never been run live. That is the work between here and a "
         "confident production launch."),
    ]
    return d, s


# ============================================================ DOC 3
def doc03():
    d = [
        ("h1", "1. Overview"),
        ("p", "This document explains how to take the hardened AgriFriend from a repository to a "
              "**running, live-like service**: what server to use, how to deploy and pair it with "
              "WhatsApp, how to operate it safely, and how it can scale. It is written for an operator, "
              "not only a developer."),
        ("callout", "warn", "Not yet run live",
         "The steps below are correct against the code, but the system has **not been exercised in a "
         "live deployment yet**. Treat the first deployment as a supervised pilot, not a hands-off launch."),

        ("h1", "2. Prerequisites"),
        ("bul", [
            "An **Ubuntu VPS** (e.g. Hostinger) with SSH access.",
            "**Node.js 22+** and **PM2**.",
            "A **Google Gemini API key** (from Google AI Studio).",
            "A **dedicated spare phone number** for WhatsApp (never a personal/business-critical number).",
        ]),

        ("h1", "3. Server Sizing (with assumptions)"),
        ("p", "CPU is **not** the bottleneck — Google's Gemini API dominates latency and cost. The "
              "VPS mainly needs enough RAM for Node plus the in-memory SQLite image and image "
              "handling. Sizing therefore depends on message volume and image share, not raw compute."),
        ("callout", "note", "Sizing assumptions",
         "The tiers below assume mostly-text traffic with a minority of images, a single WhatsApp "
         "number, and modest retention. Heavy image volume or long retention shifts you up a tier."),
        ("table", ["Tier", "Load assumption", "Suggested VPS", "Notes"], [
            ["Pilot", "1 group, < 500 msg/day", "1 vCPU / 1–2 GB RAM", "Fine for a supervised pilot"],
            ["Small", "Several groups, < 5k msg/day", "2 vCPU / 4 GB RAM", "Headroom for sql.js image + images"],
            ["Growing", "< 30k msg/day, 1 number", "4 vCPU / 8 GB RAM", "Watch Gemini quota, not CPU"],
            ["Beyond", "Sustained load / multi-number", "Move to Stage 2–3", "See scaling roadmap (§9)"],
        ]),
        ("callout", "warn", "The real cost is Gemini, not the VPS",
         "A busy bot's dominant cost is Gemini text + vision calls (and, on the official platform, "
         "per-conversation WhatsApp fees). Size the **budget** before the server."),

        ("h1", "4. Step-by-Step Deployment"),
        ("num", [
            "SSH to the VPS and clone the hardened repository.",
            "Run the setup script (installs Node, PM2, dependencies, builds).",
            "Create `.env` and set `GEMINI_API_KEY` (see §6 on secrets).",
            "Start under PM2 and enable boot persistence (`pm2 save`, `pm2 startup`).",
            "Watch the logs, scan the QR code with the spare phone to link the device (§5).",
            "Send test messages: a text question, a plant photo, an off-topic message, and a rapid burst.",
        ]),
        ("img", "06_deployment.png", "Single-VPS deployment topology."),

        ("h1", "5. WhatsApp QR / Auth Lifecycle"),
        ("p", "A WhatsApp bot is not a stateless web service — it holds a **linked-device session** "
              "that operators must manage. Losing or corrupting it means re-pairing."),
        ("img", "07_auth_lifecycle.png", "The QR / auth lifecycle operators must manage."),
        ("bul", [
            "On first run with no session, the bot prints a QR code; scan it via WhatsApp → Linked Devices.",
            "The session is saved under `auth_info/` and reused on restart — **back this folder up securely**.",
            "A logout or ban requires deleting `auth_info/` and re-scanning.",
            "Treat `auth_info/` as a **credential**: never commit it, never share it in plaintext.",
        ]),

        ("h1", "6. Configuration & Secrets"),
        ("bul", [
            "Secrets live only in `.env`, which is git-ignored — never commit it.",
            "The app validates configuration at startup (Zod) and refuses to boot on a missing key.",
            "Tunable ceilings (per-user / global / daily rate limits, image size) live in one config file.",
            "Back up `data/` (database + vectors + dedup) and `auth_info/` (session) on a schedule.",
        ]),

        ("h1", "7. Observability (Honest Gap)"),
        ("callout", "honesty", "PM2 logs are not observability",
         "Today the only operational signal is PM2 process status and pino logs. That is enough for a "
         "supervised pilot but **not** for production. Before scaling, add the items below."),
        ("bul", [
            "**Uptime / liveness** checks and alerting on process exit or a stuck reconnect loop.",
            "**Metrics** — messages processed, Gemini success/failure rate, latency, cost per day.",
            "**Error alerting** — pipe pino errors to a channel (email/Slack/Telegram).",
            "**Cost monitoring** — track Gemini usage against the daily ceiling.",
        ]),

        ("h1", "8. Gemini Failure Modes to Plan For"),
        ("table", ["Failure", "Current handling", "Recommended addition"], [
            ["Rate limit (429)", "Retry with backoff", "Alert when sustained; raise quota"],
            ["Quota exhausted", "Global/daily ceiling defers replies", "Budget alert; graceful message"],
            ["Safety block / empty", "Generic fallback reply", "Log + human review of pattern"],
            ["Bad JSON (profile)", "Falls back to empty profile", "Fine as-is"],
            ["Oversized image", "Rejected before upload", "User-facing 'photo too large' hint"],
            ["Model deprecation", "—", "Pin model; watch Google changelog"],
        ]),

        ("h1", "9. Scaling Roadmap"),
        ("p", "A crucial constraint: **one WhatsApp number binds to one active session.** You cannot "
              "simply run more replicas behind a load balancer. Real scale means sharding by number "
              "and/or moving to the official WhatsApp Business Platform with an inbound queue."),
        ("img", "08_scaling.png", "Scaling stages — shard by number, don't naively replicate."),
        ("table", ["Stage", "Shape", "Trigger to advance"], [
            ["0 — Now", "Single VPS, one number", "—"],
            ["1 — Vertical", "Bigger VPS + backups + monitoring", "Sustained load, need reliability"],
            ["2 — Official platform", "WhatsApp Business Platform (Cloud API) + inbound queue",
             "Ban risk, paying customers, compliance"],
            ["3 — Sharded", "Workers sharded by number + shared store + vector DB",
             "Many numbers / high concurrency"],
        ]),
        ("callout", "note", "A vector DB is not a free upgrade",
         "Moving the hand-rolled JSON memory to a real vector database helps at scale but does not by "
         "itself fix retrieval quality, privacy, retention, or consent. Advance on evidence, not fashion."),

        ("h1", "10. Go-Live Checklist"),
        ("bul", [
            "Dedicated spare number; `auth_info/` and `data/` backups scheduled.",
            "Gemini key set; daily cost ceiling configured; budget alert wired.",
            "Monitoring/alerting on process exit and error rate.",
            "Supervised pilot in **one** group before any broad rollout.",
            "A rollback plan (previous build) and a session re-pair runbook.",
        ]),
    ]
    s = [
        ("h1", "Deployment & Scaling — In Brief"),
        ("p", "AgriFriend runs as a single Node.js process under PM2 on one Ubuntu VPS, paired to a "
              "spare WhatsApp number via a QR code. **The dominant cost and bottleneck is the Gemini "
              "API, not the server.**"),
        ("kpi", [("1 VPS", "to start"), ("PM2", "process mgr"),
                 ("QR link", "spare number"), ("Gemini", "main cost")]),
        ("img", "06_deployment.png", "Single-VPS topology."),
        ("h2", "Operating essentials"),
        ("bul", [
            "Back up `auth_info/` (WhatsApp session) and `data/` — treat the session as a credential.",
            "Add real monitoring before scaling — PM2 logs alone are not enough.",
            "Configure the daily Gemini cost ceiling and a budget alert.",
        ]),
        ("h2", "Scaling"),
        ("img", "08_scaling.png", "Scale by sharding numbers / official platform — not naive replicas."),
        ("callout", "warn", "First run = supervised pilot",
         "The system has not been run live. Launch into one group under supervision, not hands-off."),
    ]
    return d, s


# ============================================================ DOC 4
def doc04():
    d = [
        ("h1", "1. Verdict First"),
        ("callout", "honesty", "Go with caveats",
         "A multi-model review panel assessed AgriFriend as **GO WITH CAVEATS**: suitable for a "
         "**monitored, small-scale pilot**, but **not** for an unattended, general-availability launch "
         "until the test gap is closed and the platform risk is decided. One reviewer argued for a "
         "stricter 'fix first, then pilot' stance — which we adopted for the crash and image bugs."),
        ("kpi", [("GO w/ caveats", "verdict"), ("~38%", "test coverage"),
                 ("0%", "core handler tested"), ("Not yet", "run live")]),

        ("h1", "2. Readiness Scorecard"),
        ("img", "10_scorecard.png", "Production-readiness by dimension (conservative)."),
        ("p", "Code quality and the security posture score well; **integration testing, runtime "
              "proof, observability, and compliance** are the weak dimensions. None are blockers for "
              "a supervised pilot; all are blockers for hands-off production."),

        ("h1", "3. How the Verdict Was Reached"),
        ("p", "Readiness was assessed by an LLM council — several independent models plus an "
              "adversarial code reviewer — that read the actual code and coverage. They converged on "
              "'go with caveats', with a logged disagreement over whether even a pilot should wait for "
              "the crash/image fixes. We resolved it conservatively: those fixes shipped first."),

        ("h1", "4. Risk Matrix"),
        ("img", "09_risk_matrix.png", "Likelihood vs impact for the principal risks."),

        ("h1", "5. Risk Register & Mitigations"),
        ("table", ["Risk", "Likelihood", "Impact", "Mitigation"], [
            ["WhatsApp account ban (unofficial library)", "High", "Severe",
             "Burner number; plan migration to official platform (see §6)"],
            ["Gemini cost runaway", "Medium", "High",
             "Per-user + global + daily ceilings; budget alerts"],
            ["Untested core handler", "Medium", "High",
             "Phase 2 integration tests; supervised pilot"],
            ["Data loss on power failure", "Low–Med", "Medium",
             "Crash-consistent writes; scheduled backups (no fsync — see note)"],
            ["Wrong / harmful agri advice", "Medium", "Severe",
             "Disclaimers; escalation to experts; safe-advice system prompt (see §7)"],
            ["Privacy / DPDP non-compliance", "Medium", "High",
             "Consent, retention, deletion, access control (see §8)"],
            ["Localization gap", "High", "Medium",
             "Regional languages + voice roadmap (see GTM doc)"],
            ["Model / API deprecation", "Low", "Medium",
             "Pin model version; monitor Google changelog"],
        ]),
        ("callout", "note", "On 'crash-consistent'",
         "Atomic writes prevent **torn files**, but there is no fsync — a power loss immediately after "
         "a write can still lose the newest record. This guarantees consistency, not durability. "
         "Scheduled backups cover the residual risk."),

        ("h1", "6. The WhatsApp Platform Risk (Existential)"),
        ("p", "This deserves emphasis beyond a single row. AgriFriend uses **Baileys**, an unofficial "
              "WhatsApp Web client. Meta can ban the number at any time, especially under load — and a "
              "ban can be permanent. This is not a normal bug; it is a **product-level, existential "
              "risk** to a WhatsApp-first business."),
        ("table", ["Path", "Pros", "Cons"], [
            ["Unofficial (Baileys) — current",
             "Free, fast to prototype, no approval", "Ban risk, no SLA, ToS violation, not scalable"],
            ["WhatsApp Business Platform (Cloud API)",
             "Official, compliant, scalable, supported", "Per-conversation fees, business verification, template rules"],
        ]),
        ("callout", "warn", "Recommendation",
         "Treat the current Baileys build as a **prototype / pilot** vehicle only. Any commercial "
         "launch should budget and plan a migration to the official WhatsApp Business Platform, "
         "including its India conversation fees, in the unit economics."),

        ("h1", "7. Agricultural-Advice Liability & Safety"),
        ("p", "Advice about pesticides, dosages, and crop treatment carries real-world consequences — "
              "crop loss, wasted spend, or human/animal safety issues. The system prompt already "
              "refuses dangerous or illegal practices, but that is not sufficient governance."),
        ("bul", [
            "**Disclaimers** — every session should carry a clear 'informational, not a substitute for "
            "a certified agronomist' notice.",
            "**Escalation** — a path to a human expert / agronomist for high-stakes cases.",
            "**Regional accuracy** — pesticide legality and dosage vary by state and crop; advice must "
            "account for local regulation.",
            "**Safety guardrails** — never recommend banned chemicals or unsafe dosages; log and review "
            "edge cases.",
        ]),

        ("h1", "8. Privacy & Compliance (India DPDP)"),
        ("p", "The bot stores personal and sensitive data: WhatsApp numbers, locations, crop problems, "
              "images, and chat history. India's Digital Personal Data Protection (DPDP) Act imposes "
              "obligations that must be designed in, not bolted on."),
        ("bul", [
            "**Consent** at onboarding; a clear purpose statement.",
            "**Retention limits** and a **deletion** path on request.",
            "**Access control & encryption** for stored data and backups.",
            "**Data minimisation** — collect only what advice needs.",
        ]),

        ("h1", "9. The Test / Runtime Gap"),
        ("callout", "honesty", "The single biggest readiness gap",
         "The core message handler and connection lifecycle have **0% test coverage**, and the bot has "
         "**never been run against live WhatsApp + Gemini**. Everything else is secondary to closing "
         "this. A mocked integration test plus one real live run would move the readiness needle more "
         "than any other single activity."),

        ("h1", "10. Path to 'Good to Go'"),
        ("num", [
            "**Phase 2 tests** — integration tests for the handler and reconnect logic; a coverage gate.",
            "**Live pilot** — supervised, one group, a spare number, for a week.",
            "**Observability** — metrics, alerting, cost monitoring (see Deployment doc).",
            "**Compliance & disclaimers** — consent, retention, liability notices.",
            "**Platform decision** — commit to a migration plan for the official WhatsApp platform.",
        ]),
    ]
    s = [
        ("h1", "Readiness & Risks — In Brief"),
        ("callout", "honesty", "Verdict: GO WITH CAVEATS",
         "Fit for a **monitored pilot**, not an unattended launch. The engineering is sound; the gaps "
         "are testing, runtime proof, observability, and compliance."),
        ("kpi", [("GO w/ caveats", "verdict"), ("~38%", "coverage"),
                 ("0%", "core tested"), ("Not yet", "run live")]),
        ("img", "10_scorecard.png", "Readiness scorecard (conservative)."),
        ("h2", "Top risks"),
        ("bul", [
            "**WhatsApp ban** (unofficial library) — existential; plan migration to the official platform.",
            "**Untested core + never run live** — the #1 gap; needs Phase 2 tests + a live pilot.",
            "**Agri-advice liability** — needs disclaimers and expert escalation.",
            "**Privacy / DPDP** — consent, retention, deletion must be designed in.",
        ]),
        ("img", "09_risk_matrix.png", "Principal risks by likelihood and impact."),
    ]
    return d, s


# ============================================================ DOC 5
def doc05():
    d = [
        ("h1", "1. The Opportunity"),
        ("p", "India has hundreds of millions of farmers, near-universal WhatsApp usage in rural "
              "communities, and a chronic shortage of on-demand agronomy. AgriFriend meets farmers "
              "on the channel they already trust, in the format they already use — text and voice "
              "notes. The product is credible; the challenge is **distribution and monetisation**, "
              "which for this market look very different from a typical SaaS app."),
        ("callout", "honesty", "Numbers here are illustrative",
         "This document provides a **model to fill in**, not a forecast. Market sizes, prices, and "
         "unit economics are illustrative assumptions that must be validated with real pilots, real "
         "Gemini/WhatsApp costs, and real willingness-to-pay before any commitment."),

        ("h1", "2. Who Pays — and Who Doesn't"),
        ("p", "The central go-to-market insight: **smallholder farmers will generally not pay a direct "
              "SaaS subscription.** Sustainable revenue is **B2B-led** — organisations that benefit "
              "from reaching or serving farmers pay, and farmers use the bot for free."),
        ("table", ["Segment", "Pays?", "Motivation"], [
            ["Smallholder farmers (B2C)", "Rarely direct", "Free advice; value but low ability/willingness to pay"],
            ["Agri-input companies (seeds, fertiliser, agrochem)", "Yes", "Reach + contextual product recommendation"],
            ["FPOs / cooperatives", "Yes (per-farmer)", "Member service, retention, advisory at scale"],
            ["Government / schemes / NGOs", "Yes (contracts)", "Extension services, scheme awareness"],
            ["Agri-dealers (village shops)", "Indirect", "Footfall, trust, referral commissions"],
        ]),

        ("h1", "3. Distribution — Dealer-Led, Not Ad-Led"),
        ("p", "Online ads acquire farmers poorly and expensively. The high-trust channel is the "
              "**local agri-input dealer** — the shopkeeper farmers already rely on. Onboard farmers "
              "through dealers using referral codes, and incentivise dealers with small commissions."),
        ("img", "11_gtm_funnel.png", "Dealer-led acquisition funnel."),
        ("bul", [
            "**Trust brokers** — dealers and FPO staff introduce the bot in person.",
            "**Referral codes** — each dealer gets a code; onboarding is attributed and incentivised.",
            "**Local-language onboarding** — the first message must be in the farmer's language.",
            "**Word of mouth** — a genuinely useful diagnosis spreads within a village group.",
        ]),

        ("h1", "4. Monetisation Models"),
        ("img", "12_revenue_model.png", "Revenue streams and margin levers (illustrative)."),
        ("table", ["Model", "How it works", "Maturity"], [
            ["B2B Sponsored Advisory", "Agri-input firms pay (CPL/CPC) for contextual, relevant product "
             "suggestions when the bot diagnoses a problem — with clear disclosure", "Primary"],
            ["B2B2C (FPO / Gov / Agri-co)", "Per-farmer SaaS to organisations serving farmers; annual "
             "contracts", "Primary"],
            ["Premium (thin)", "Voice, priority, expert escalation for a small slice of high-intent "
             "users", "Secondary"],
        ]),
        ("callout", "warn", "Sponsored advice needs guardrails",
         "Contextual product suggestions must be **clearly disclosed**, must never override safe or "
         "correct agronomy, and must respect local regulation. Trust is the entire asset; do not "
         "trade it for short-term ad revenue."),

        ("h1", "5. Illustrative Unit Economics"),
        ("p", "Unit economics hinge on four numbers, none yet validated: Gemini text+vision cost per "
              "active user, WhatsApp session fees (on the official platform), acquisition cost via "
              "dealers, and churn. The levers below protect margin."),
        ("table", ["Driver", "What it is", "Lever to control it"], [
            ["Gemini cost", "Per text + image inference", "Keyword fast-path; cache common answers; context caching for media"],
            ["WhatsApp fees", "Per-conversation on official platform", "Batch/session windows; template discipline"],
            ["Acquisition (CAC)", "Dealer commission per onboarded farmer", "Tune commission; organic group growth"],
            ["Human escalation", "Expert time for edge cases", "Reserve for high-stakes only; triage"],
            ["Churn", "Users who stop engaging", "Proactive tips; seasonal relevance; voice UX"],
        ]),
        ("callout", "honesty", "Do the math with real numbers",
         "Before any revenue plan, run a real pilot to measure Gemini cost per active user and WhatsApp "
         "fees, then compare against sponsor CPL and FPO per-farmer pricing. If cost-per-user exceeds "
         "monetisable value, the fix is usage efficiency (caching, fast-paths), not more traffic."),

        ("h1", "6. Localization & Voice (Product-Market Fit)"),
        ("p", "A generic English text bot will not fit this market. The features below are not "
              "nice-to-haves — they are the difference between adoption and abandonment:"),
        ("bul", [
            "**Regional languages** and code-mixed input (e.g. Hinglish, Telugu-English).",
            "**Voice-first** — intercept WhatsApp voice notes, transcribe, answer, optionally reply in audio.",
            "**Low-literacy UX** — short answers, images, voice over dense text.",
            "**Local crop calendars, pests, and state-specific schemes** in the advice.",
        ]),

        ("h1", "7. Competitive Landscape"),
        ("p", "AgriFriend competes with government advisories (Kisan services), agri-tech apps, and "
              "input-company helplines. Its edges are **zero-install (lives in WhatsApp)**, "
              "**conversational + image diagnosis**, and **dealer-led trust**. Its disadvantages are "
              "the platform risk and the need for localisation and human backup — all addressable."),

        ("h1", "8. Roadmap to Revenue"),
        ("num", [
            "**Prove value** — supervised pilot with one FPO/dealer cluster; measure engagement + cost.",
            "**Localize** — add the dominant regional language and voice for the pilot region.",
            "**Land a B2B anchor** — one agri-input sponsor or FPO contract to validate willingness-to-pay.",
            "**Migrate platform** — move to the official WhatsApp Business Platform for reliability + compliance.",
            "**Scale distribution** — expand the dealer referral network region by region.",
        ]),

        ("h1", "9. Business-Model Risks"),
        ("bul", [
            "**Platform ban** before migration wipes out distribution overnight.",
            "**Trust erosion** if sponsored advice is perceived as biased.",
            "**Cost > value** per user if usage efficiency isn't managed.",
            "**Advisory liability** if wrong advice causes crop loss — needs disclaimers + escalation.",
            "**Localization debt** — under-serving non-English, low-literacy users caps the market.",
        ]),
    ]
    s = [
        ("h1", "Go-to-Market & Monetization — In Brief"),
        ("callout", "honesty", "A model, not a forecast",
         "All numbers are illustrative assumptions to validate with real pilots and real Gemini/"
         "WhatsApp costs before committing."),
        ("p", "The product is credible; the game is **distribution and monetisation**. The key "
              "insight: **farmers won't pay a subscription — revenue is B2B-led**, with farmers using "
              "the bot free."),
        ("kpi", [("B2B-led", "who pays"), ("Dealers", "distribution"),
                 ("Voice", "must-have"), ("Official API", "for scale")]),
        ("img", "12_revenue_model.png", "Revenue streams (illustrative)."),
        ("h2", "The playbook"),
        ("bul", [
            "**Distribute** through local agri-dealers as trust brokers (referral codes), not ads.",
            "**Monetise** via agri-input sponsored advisory + FPO/government contracts; premium is thin.",
            "**Localize** — regional languages + voice notes are adoption-critical, not optional.",
            "**Protect margin** — caching, keyword fast-paths, and context caching cut Gemini cost.",
        ]),
        ("img", "11_gtm_funnel.png", "Dealer-led acquisition funnel."),
        ("callout", "warn", "Two make-or-break risks",
         "The unofficial-WhatsApp ban risk and the cost-per-user vs willingness-to-pay math will "
         "decide the business. Validate both in a real pilot first."),
    ]
    return d, s


BUILDERS = {
    "01_Original_Repo": doc01,
    "02_What_We_Built": doc02,
    "03_Deployment_VPS_Scaling": doc03,
    "04_Risks_and_Readiness": doc04,
    "05_GoToMarket_Monetization": doc05,
}
