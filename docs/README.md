# AgriFriend — Documentation Generator

Reproducible source for the AgriFriend project documentation pack (6 documents,
each in a Detailed and Summary variant, rendered to `.docx` and `.pdf`).

Documents: (1) original repo, (2) what we built, (3) deployment/VPS/scaling,
(4) risks/readiness, (5) go-to-market/monetization, (6) test results & next steps.

The generated binaries (Word/PDF files and diagram PNGs) are intentionally **not**
committed — only the source that produces them, for traceability.

## Contents
- `_generator/diagrams.py` — matplotlib architecture/business diagrams (→ PNG).
- `_generator/docbuilder.py` — python-docx styling engine (cover, static TOC, callouts, tables).
- `_generator/content.py` — single source of truth for all document content (Detailed + Summary).
- `_generator/build_all.py` — renders 10 `.docx`, converts to `.pdf`, writes the manifest.
- `MANIFEST.md` — provenance: source repos, commit SHA, test/coverage basis, readiness verdict.

## Reproduce
```bash
pip install matplotlib python-docx docx2pdf   # docx2pdf needs MS Word (Windows) for PDF
python _generator/diagrams.py      # regenerate diagrams into ./assets/diagrams
python _generator/build_all.py     # rebuild ./Detailed version and ./Summary version
```

Paths are relative to this `docs/` folder, so outputs land in
`docs/Detailed version/`, `docs/Summary version/`, and `docs/assets/diagrams/`.

## Editing
Change wording in `content.py` and rerun `build_all.py`. Because both variants
derive from the same source, the Detailed and Summary versions cannot drift.
