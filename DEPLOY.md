# Deploy / Update — CTG Admn bot (Hostinger VPS)

The bot runs as a **single `pm2` process** (`agrifriend`) that hosts BOTH transports:

- **WhatsApp Cloud API → 1:1 DMs** (official; number's secrets live in the VPS `.env`).
- **Baileys → WhatsApp groups** (unofficial; pair a real number by scanning a QR).

Both share one in-memory SQLite (`sql.js`) DB in one process, so there is **one writer** —
running Cloud + Baileys together is safe. The persona each message gets is routed by
group name / number (see `src/config/personas.ts`); CTG Admn is the default.

---

## First-time setup (VPS)

```bash
# The live deploy is /root/Agribot with the GitHub repo as remote `origin`.
git clone https://github.com/finalertserats-prog/Agribot.git Agribot && cd Agribot
git checkout hardening/p0-p1
npm install -g pm2
npm ci && npm run build   # pulls Puppeteer/Chromium for the group transport
```

Create `.env` **by hand on the VPS** (it is gitignored — never in the repo, never paste
secrets into chat):

```bash
cat > .env <<'EOF'
LLM_PROVIDER=openai
OPENAI_API_KEY=<your key — type it directly on the VPS>
BOT_TRIGGER=ctg

# WhatsApp Cloud API (1:1). Leave ALL unset to run Baileys-only.
WHATSAPP_CLOUD_TOKEN=<permanent System User token>
WHATSAPP_PHONE_NUMBER_ID=<phone number id>
WHATSAPP_VERIFY_TOKEN=<your verify token>
WHATSAPP_APP_SECRET=<meta app secret>
# WHATSAPP_GRAPH_VERSION=v22.0

# Leave BAILEYS_GROUPS_ONLY unset unless the SAME number is on both transports.
# Our 1:1 (Cloud number) and group (Baileys number) differ, so unset is correct
# and lets the Baileys number also answer private DMs.
EOF
chmod 600 .env
```

Start it and make it boot-persistent:

```bash
pm2 start ecosystem.config.js
pm2 logs agrifriend     # scan the Baileys QR with the GROUP number (9951387202)
pm2 save
pm2 startup             # run the command it prints (enables autostart on reboot)
```

Then **add the group number to the CTG WhatsApp group** and test: `ctg how do I grow tomatoes?`

---

## Update an existing deploy (routine)

**The remote is named `origin` ON THE VPS.** Locally the same GitHub repo is `deploy`
(and `target`); `origin` locally is the *old* upstream. `git pull deploy …` on the VPS
fails with "'deploy' does not appear to be a git repository".

```bash
cd /root/Agribot
git remote -v                          # confirm the URL, not just the name
git pull --ff-only origin hardening/p0-p1
git rev-parse --short HEAD             # MUST equal the commit you pushed
npm ci && npm run build
pm2 restart agrifriend
pm2 logs agrifriend                    # only if the group transport must re-link — scan the QR
```

### Never pipe a command whose exit code you depend on

A shell pipeline returns the exit status of the LAST command, so `tail` reports success
even when `git` failed:

```bash
git pull … | tail -6 && npm run build   # BROKEN: builds the OLD source on a failed pull
```

This happened on 2026-08-06 and produced a deploy that shipped nothing while looking
completely clean — `npm run build` re-compiled the previous commit and exited 0. **Verify a
deploy by asserting the commit SHA on the host**, never by the absence of errors:

```bash
test "$(git rev-parse --short HEAD)" = "<expected-sha>" && echo OK || echo "DID NOT LAND"
```

`.env`, `auth_info*/` (WhatsApp session) and `data/` (DB) are gitignored, so `git pull`
never touches them — the linked session and member data survive updates.

### Dependencies

`whatsapp-web.js` (and its Puppeteer/Chromium payload) is a **declared dependency**, so
`npm ci` installs it and the group transport survives a clean reinstall. It used to be
installed by hand on the VPS only, which meant `npm ci` would silently delete it and break
groups. The `src/types/whatsapp-web.d.ts` shim still lets the project typecheck and build on
a machine where the package isn't present; the real module is loaded via dynamic import only
when `GROUP_TRANSPORT=whatsapp-web`.

---

## Operating notes

- **Group vs 1:1:** groups run on Baileys (unofficial — WhatsApp may log it out; keep the
  SIM active in a real phone, online at least every ~2 weeks). 1:1 runs on the official
  Cloud API. If Baileys is logged out, `pm2 logs agrifriend` shows a fresh QR to re-link.
- **Personas / routing:** add a community by appending a `Persona` to `PERSONAS` in
  `src/config/personas.ts` with its own `idPrefix` and `match.groupPatterns` (or a
  `groupIds` JID for an exact, rename-proof lock). No other change needed.
- **Member IDs:** every member gets `PREFIX-last4-seq` (e.g. `CTG-7202-014`), keyed to
  their phone, assigned on first message.
- **Compliance:** `STOP` unsubscribes, `START` resumes, `DELETE` erases all data — do not
  disable these.
- **Rollback:** `git checkout <previous-commit> && npm ci && npm run build && pm2 restart agrifriend`.
```
