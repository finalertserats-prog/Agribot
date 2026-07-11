# AgriFriend Documentation Pack — Manifest

- Generated: 11 July 2026
- Original repo: https://github.com/Shivaganesh-dev/agrifriend-bot
- Hardened repo: https://github.com/finalertserats-prog/Agribot @ bc87e5e
- Basis: 78 tests passing; ~83% line coverage (80% gate); handler 75%, whatsapp 81%
- Readiness verdict: GO WITH CAVEATS (monitored pilot; trending to 'good to go')
- Live smoke test: boots cleanly to the WhatsApp QR pairing stage; full live pairing not yet done.

## Documents (Detailed + Summary, each as .docx and .pdf)
- The Original AgriFriend Bot
- What We Built — The Hardening
- Going Live: Deployment, VPS & Scaling
- Production Readiness, Risks & Mitigations
- Go-to-Market, Monetization & Growth
- Test Results & Next Steps
- The Autonomy Plan
- Enhancements & Value

## Files produced: 16 docx, 16 pdf

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