# -*- coding: utf-8 -*-
"""Build the full AgriFriend documentation pack: 10 docx + 10 pdf + manifest."""
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import content
from docbuilder import DocBuilder

DETAILED_DIR = os.path.join(ROOT, "Detailed version")
SUMMARY_DIR = os.path.join(ROOT, "Summary version")
os.makedirs(DETAILED_DIR, exist_ok=True)
os.makedirs(SUMMARY_DIR, exist_ok=True)

PRETTY = {
    "01_Original_Repo": "01 - The Original AgriFriend Bot",
    "02_What_We_Built": "02 - What We Built (Hardening)",
    "03_Deployment_VPS_Scaling": "03 - Deployment, VPS & Scaling",
    "04_Risks_and_Readiness": "04 - Production Readiness & Risks",
    "05_GoToMarket_Monetization": "05 - Go-to-Market & Monetization",
    "06_Test_Results_Next_Steps": "06 - Test Results & Next Steps",
}


def build_docx():
    produced = []
    for idx, key in enumerate(content.DOCS, start=1):
        detailed_blocks, summary_blocks = content.BUILDERS[key]()
        for variant, blocks, folder in (
            ("Detailed", detailed_blocks, DETAILED_DIR),
            ("Summary", summary_blocks, SUMMARY_DIR),
        ):
            meta = {
                "pack_name": "AgriFriend — Project Documentation Pack",
                "doc_title": content.TITLES[key],
                "subtitle": content.SUBTITLES[key],
                "variant": variant,
                "doc_index": idx,
                "doc_total": len(content.DOCS),
                "date": content.DATE,
                "commit": content.COMMIT,
                "verdict": content.VERDICT,
                "basis": content.BASIS,
            }
            b = DocBuilder(meta)
            b.render(blocks)
            fname = f"{PRETTY[key]} ({variant}).docx"
            path = os.path.join(folder, fname)
            b.save(path)
            produced.append(path)
            print("docx:", os.path.relpath(path, ROOT))
    return produced


def to_pdf(docx_paths):
    try:
        from docx2pdf import convert
    except Exception as e:
        print("docx2pdf unavailable:", e)
        return []
    pdfs = []
    for p in docx_paths:
        pdf = p[:-5] + ".pdf"
        try:
            convert(p, pdf)
            if os.path.exists(pdf):
                pdfs.append(pdf)
                print("pdf :", os.path.relpath(pdf, ROOT))
            else:
                print("pdf FAILED (no output):", os.path.basename(pdf))
        except Exception as e:
            print("pdf FAILED:", os.path.basename(pdf), "-", e)
            traceback.print_exc()
    return pdfs


def write_manifest(docx_paths, pdf_paths):
    lines = [
        "# AgriFriend Documentation Pack — Manifest",
        "",
        f"- Generated: {content.DATE}",
        "- Original repo: https://github.com/Shivaganesh-dev/agrifriend-bot",
        f"- Hardened repo: https://github.com/finalertserats-prog/Agribot @ {content.COMMIT}",
        "- Basis: 78 tests passing; ~83% line coverage (80% gate); handler 75%, whatsapp 81%",
        f"- Readiness verdict: {content.VERDICT} (monitored pilot; trending to 'good to go')",
        "- Live smoke test: boots cleanly to the WhatsApp QR pairing stage; full live pairing not yet done.",
        "",
        "## Documents (Detailed + Summary, each as .docx and .pdf)",
    ]
    for key in content.DOCS:
        lines.append(f"- {content.TITLES[key]}")
    lines += [
        "",
        f"## Files produced: {len(docx_paths)} docx, {len(pdf_paths)} pdf",
        "",
        "## Reproduce",
        "```",
        "python _generator/diagrams.py     # regenerate diagrams",
        "python _generator/build_all.py    # rebuild all docx + pdf",
        "```",
        "",
        "## Notes on honesty (per adversarial review)",
        "- Prompt-injection framing is mitigation, not prevention.",
        "- Atomic persistence is crash-consistent, not crash-durable (no fsync).",
        "- Rate limiting is in-memory (per process); not multi-replica coordinated.",
        "- GTM/monetization figures are illustrative assumptions, not forecasts.",
        "- WhatsApp (Baileys) is unofficial — existential ban risk; plan official-platform migration.",
    ]
    path = os.path.join(ROOT, "MANIFEST.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("manifest:", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    docx = build_docx()
    print(f"\n{len(docx)} docx built. Converting to PDF (via MS Word)...\n")
    pdf = to_pdf(docx)
    write_manifest(docx, pdf)
    print(f"\nDONE. {len(docx)} docx, {len(pdf)} pdf.")
