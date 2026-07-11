# AgriFriend Documentation Pack — Manifest

- Generated: 11 July 2026
- Original repo: https://github.com/Shivaganesh-dev/agrifriend-bot
- Hardened repo: https://github.com/finalertserats-prog/Agribot @ 73e7cf9
- Basis: 48 unit tests passing; ~38% line coverage; core handler + whatsapp lifecycle 0%
- Readiness verdict: GO WITH CAVEATS (monitored pilot, not unattended production)
- The bot has NOT been run against live WhatsApp + Gemini as of this pack.

## Documents (Detailed + Summary, each as .docx and .pdf)
- The Original AgriFriend Bot
- What We Built — The Hardening
- Going Live: Deployment, VPS & Scaling
- Production Readiness, Risks & Mitigations
- Go-to-Market, Monetization & Growth

## Files produced: 10 docx, 10 pdf

## Reproduce
```
python _generator/diagrams.py     # regenerate diagrams
python _generator/build_all.py    # rebuild all docx + pdf
```

## Notes on honesty (per adversarial review)
- Prompt-injection framing is mitigation, not prevention.
- Atomic persistence is crash-consistent, not crash-durable (no fsync).
- Rate limiting is in-memory (per process); not multi-replica coordinated.
- GTM/monetization figures are illustrative assumptions, not forecasts.
- WhatsApp (Baileys) is unofficial — existential ban risk; plan official-platform migration.