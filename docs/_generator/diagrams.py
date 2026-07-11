"""AgriFriend documentation — diagram generator (matplotlib, high-DPI PNG).

Produces all architecture / flow / business diagrams into ../assets/diagrams.
Deliberately vector-clean, high-DPI (200) and sized for A4 Word embedding.
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle
from matplotlib.lines import Line2D

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "diagrams")
os.makedirs(OUT, exist_ok=True)

# ---- palette ---------------------------------------------------------------
INK = "#263238"
GREEN = "#2E7D32"; GREEN_L = "#C8E6C9"
AMBER = "#EF6C00"; AMBER_L = "#FFE0B2"
RED = "#C62828";   RED_L = "#FFCDD2"
BLUE = "#1565C0";  BLUE_L = "#BBDEFB"
PURPLE = "#6A1B9A"; PURPLE_L = "#E1BEE7"
GRAY = "#546E7A";  GRAY_L = "#ECEFF1"
WHITE = "#FFFFFF"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "figure.dpi": 200,
    "savefig.dpi": 200,
})


def _fig(w=11, h=7):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, 100); ax.set_ylim(0, 100)
    ax.axis("off")
    return fig, ax


def box(ax, x, y, w, h, text, fc=WHITE, ec=GREEN, tc=INK, fs=10, bold=False, lw=1.6):
    p = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=2",
                       fc=fc, ec=ec, lw=lw, mutation_scale=1)
    ax.add_patch(p)
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
            fontsize=fs, color=tc, weight="bold" if bold else "normal", wrap=True)
    return (x + w / 2, y + h / 2)


def arrow(ax, p1, p2, color=GRAY, style="-|>", lw=1.8, ls="-"):
    a = FancyArrowPatch(p1, p2, arrowstyle=style, mutation_scale=16,
                        color=color, lw=lw, linestyle=ls,
                        shrinkA=6, shrinkB=6)
    ax.add_patch(a)


def title(ax, t, sub=None):
    ax.text(50, 96, t, ha="center", va="top", fontsize=15, weight="bold", color=INK)
    if sub:
        ax.text(50, 90.5, sub, ha="center", va="top", fontsize=10, color=GRAY)


def save(fig, name):
    path = os.path.join(OUT, name)
    fig.savefig(path, bbox_inches="tight", facecolor=WHITE, pad_inches=0.25)
    plt.close(fig)
    print("wrote", name)


# ---------------------------------------------------------------------------
# 1. Original architecture
# ---------------------------------------------------------------------------
def d01_original_arch():
    fig, ax = _fig()
    title(ax, "Original AgriFriend — System Architecture",
          "Shivaganesh-dev/agrifriend-bot  ·  ~662 lines TypeScript")
    box(ax, 6, 60, 20, 12, "WhatsApp\nUser / Group", fc=GREEN_L, ec=GREEN, bold=True)
    box(ax, 6, 30, 20, 12, "Baileys\n(unofficial WhatsApp Web)", fc=AMBER_L, ec=AMBER, bold=True)
    box(ax, 40, 44, 24, 16, "index.ts\nMessage Handler\n(guardrail · context · route)", fc=WHITE, ec=INK, bold=True)
    box(ax, 76, 72, 20, 11, "Gemini 2.0 Flash\n(text + vision)", fc=BLUE_L, ec=BLUE, bold=True)
    box(ax, 76, 48, 20, 11, "sql.js (SQLite/WASM)\nusers · interactions", fc=GRAY_L, ec=GRAY, bold=True)
    box(ax, 76, 24, 20, 11, "JSON vector store\n(brute-force RAG)", fc=GRAY_L, ec=GRAY, bold=True)
    arrow(ax, (16, 60), (16, 42), color=GREEN)
    arrow(ax, (26, 36), (40, 50), color=AMBER)
    arrow(ax, (64, 54), (76, 77), color=BLUE)
    arrow(ax, (64, 50), (76, 53), color=GRAY)
    arrow(ax, (64, 46), (76, 29), color=GRAY)
    ax.text(50, 12, "Single Node.js process · PM2 · one VPS · full-file writes on every message",
            ha="center", fontsize=9.5, color=GRAY, style="italic")
    save(fig, "01_original_architecture.png")


# ---------------------------------------------------------------------------
# 2. Original message flow
# ---------------------------------------------------------------------------
def d02_message_flow():
    fig, ax = _fig(11, 8)
    title(ax, "Message Handling Flow", "How one inbound message becomes a reply")
    steps = [
        (75, "Inbound WhatsApp message", GREEN_L, GREEN),
        (66, "Group? require trigger word 'agrifriend'", GRAY_L, GRAY),
        (57, "Domain guardrail — keyword / classifier", AMBER_L, AMBER),
        (48, "Assemble context: history + RAG memory + profile", BLUE_L, BLUE),
        (39, "Gemini: text answer OR image diagnosis", BLUE_L, BLUE),
        (30, "Persist interaction + store memory", GRAY_L, GRAY),
        (21, "Send reply to WhatsApp", GREEN_L, GREEN),
    ]
    prev = None
    for y, t, fc, ec in steps:
        c = box(ax, 26, y, 48, 6.5, t, fc=fc, ec=ec, fs=10)
        if prev:
            arrow(ax, (50, prev - 3.25), (50, y + 6.5), color=INK)
        prev = y
    box(ax, 80, 56.5, 16, 7.5, "Off-topic →\ncanned reply", fc=RED_L, ec=RED, fs=8.5)
    arrow(ax, (74, 60), (80, 60), color=RED)
    save(fig, "02_message_flow.png")


# ---------------------------------------------------------------------------
# 3. Hardened architecture
# ---------------------------------------------------------------------------
def d03_hardened_arch():
    fig, ax = _fig(12, 8)
    title(ax, "Hardened Architecture — What We Built",
          "finalertserats-prog/Agribot  ·  green = added/rewritten in hardening")
    box(ax, 4, 66, 17, 10, "WhatsApp\nUser / Group", fc=GREEN_L, ec=GREEN, bold=True)
    box(ax, 4, 40, 17, 11, "Baileys +\nreconnect backoff\n+ persisted dedup", fc=GREEN_L, ec=GREEN, bold=True)
    box(ax, 30, 55, 22, 16, "index.ts handler\nrate limit · guardrail\ncost ceiling · shutdown", fc=WHITE, ec=GREEN, bold=True, lw=2.2)
    box(ax, 30, 34, 22, 12, "config (Zod)\nlogger (pino)", fc=GREEN_L, ec=GREEN)
    box(ax, 60, 72, 20, 10, "Gemini 2.0 Flash\n+ withRetry (429)", fc=BLUE_L, ec=BLUE, bold=True)
    box(ax, 60, 55, 20, 11, "persist.ts\natomic · debounced\ncrash-consistent", fc=GREEN_L, ec=GREEN, bold=True)
    box(ax, 84, 55, 13, 11, "sql.js DB\n(flushed)", fc=GRAY_L, ec=GRAY)
    box(ax, 60, 36, 20, 12, "memory.ts RAG\nper-user filter\n+ cap + skip", fc=GREEN_L, ec=GREEN, bold=True)
    box(ax, 84, 36, 13, 12, "vector +\nseen.json\n(persisted)", fc=GRAY_L, ec=GRAY)
    arrow(ax, (12, 66), (12, 51), color=GREEN)
    arrow(ax, (21, 45), (30, 60), color=GREEN)
    arrow(ax, (52, 64), (60, 76), color=BLUE)
    arrow(ax, (52, 60), (60, 60), color=GREEN)
    arrow(ax, (52, 56), (60, 42), color=GREEN)
    arrow(ax, (80, 60), (84, 60), color=GRAY)
    arrow(ax, (80, 42), (84, 42), color=GRAY)
    ax.text(50, 20, "Added: rate limiter · global cost ceiling · atomic/debounced persistence · reconnect backoff",
            ha="center", fontsize=9, color=GREEN)
    ax.text(50, 16, "persisted restart-safe dedup · prompt-injection framing · Zod config · pino logs · graceful shutdown",
            ha="center", fontsize=9, color=GREEN)
    save(fig, "03_hardened_architecture.png")


# ---------------------------------------------------------------------------
# 4. Before / after
# ---------------------------------------------------------------------------
def d04_before_after():
    fig, ax = _fig(12, 8)
    title(ax, "Before vs After — The Hardening Delta")
    rows = [
        ("Persistence", "Sync full-file write every msg\n(event-loop blocking)", "Atomic + debounced async\n(crash-consistent)"),
        ("Crash safety", "Unhandled rejection kills process", "try/catch + process safety nets"),
        ("Reconnect", "Listener leak; could stay offline", "Backoff + retry + single-flight"),
        ("Dedup", "In-memory only (lost on restart)", "Persisted, id saved after success"),
        ("Cost control", "None", "Per-user + global + daily ceiling"),
        ("Image analysis", "Broken (wrong media arg)", "Fixed — passes imageMessage"),
        ("Config / logs", "Bare env, console.log", "Zod validation + pino"),
        ("Tests", "0", "48 unit tests (primitives)"),
    ]
    y = 80
    box(ax, 4, y, 20, 6, "Aspect", fc=INK, ec=INK, tc=WHITE, bold=True, fs=10)
    box(ax, 25, y, 35, 6, "Original", fc=AMBER, ec=AMBER, tc=WHITE, bold=True, fs=10)
    box(ax, 61, y, 35, 6, "Hardened", fc=GREEN, ec=GREEN, tc=WHITE, bold=True, fs=10)
    y -= 8.2
    for aspect, before, after in rows:
        box(ax, 4, y, 20, 7.2, aspect, fc=GRAY_L, ec=GRAY, fs=8.5, bold=True)
        box(ax, 25, y, 35, 7.2, before, fc=AMBER_L, ec=AMBER, fs=8)
        box(ax, 61, y, 35, 7.2, after, fc=GREEN_L, ec=GREEN, fs=8)
        y -= 8.2
    save(fig, "04_before_after.png")


# ---------------------------------------------------------------------------
# 5. Memory / context assembly
# ---------------------------------------------------------------------------
def d05_memory():
    fig, ax = _fig(11, 7)
    title(ax, "Three-Layer Context Assembly", "What the model sees for each user")
    box(ax, 8, 55, 24, 14, "Recent history\n(last 3 msgs from SQLite)", fc=BLUE_L, ec=BLUE, fs=9.5)
    box(ax, 38, 55, 24, 14, "Vector memory (RAG)\nper-user cosine top-k", fc=PURPLE_L, ec=PURPLE, fs=9.5)
    box(ax, 68, 55, 24, 14, "User profile\nplants · issues · location", fc=GREEN_L, ec=GREEN, fs=9.5)
    box(ax, 33, 30, 34, 12, "framedContext()\nwrapped as UNTRUSTED data", fc=AMBER_L, ec=AMBER, bold=True, fs=10)
    box(ax, 33, 10, 34, 11, "Gemini prompt\n(system + context + user turn)", fc=WHITE, ec=INK, bold=True, fs=10)
    for x in (20, 50, 80):
        arrow(ax, (x, 55), (50, 42), color=GRAY)
    arrow(ax, (50, 30), (50, 21), color=AMBER)
    ax.text(50, 4, "Prompt-injection MITIGATION (not prevention): angle-bracket strip + 'treat as data only'",
            ha="center", fontsize=8.5, color=RED, style="italic")
    save(fig, "05_memory_layers.png")


# ---------------------------------------------------------------------------
# 6. Deployment topology
# ---------------------------------------------------------------------------
def d06_deployment():
    fig, ax = _fig(11, 7.5)
    title(ax, "Deployment Topology (Single VPS)", "Hostinger / any Ubuntu VPS")
    ax.add_patch(Rectangle((6, 20), 52, 62, fill=False, ec=GREEN, lw=2, ls="--"))
    ax.text(32, 84, "Ubuntu VPS", ha="center", color=GREEN, weight="bold", fontsize=11)
    box(ax, 12, 62, 40, 10, "PM2 (auto-restart, boot persistence)", fc=GREEN_L, ec=GREEN, bold=True, fs=9.5)
    box(ax, 12, 48, 18, 9, "Node.js 22\nAgriFriend", fc=WHITE, ec=INK, fs=9)
    box(ax, 34, 48, 18, 9, ".env\nGEMINI key", fc=RED_L, ec=RED, fs=8.5)
    box(ax, 12, 34, 18, 9, "auth_info/\n(WA session)", fc=AMBER_L, ec=AMBER, fs=8.5)
    box(ax, 34, 34, 18, 9, "data/\ndb · vectors", fc=GRAY_L, ec=GRAY, fs=8.5)
    box(ax, 70, 62, 24, 11, "Google Gemini API\n(external)", fc=BLUE_L, ec=BLUE, bold=True)
    box(ax, 70, 40, 24, 11, "Spare WhatsApp\nphone (QR link)", fc=GREEN_L, ec=GREEN, bold=True)
    arrow(ax, (52, 53), (70, 66), color=BLUE)
    arrow(ax, (52, 40), (70, 45), color=GREEN, style="<|-|>")
    ax.text(32, 26, "Back up auth_info/ + data/ — session creds & user data",
            ha="center", fontsize=8.5, color=RED)
    save(fig, "06_deployment.png")


# ---------------------------------------------------------------------------
# 7. QR / auth lifecycle
# ---------------------------------------------------------------------------
def d07_auth_lifecycle():
    fig, ax = _fig(11, 7.5)
    title(ax, "WhatsApp QR / Auth Lifecycle", "The operational path operators must manage")
    nodes = [
        (78, "Start bot (pm2)", GREEN_L, GREEN),
        (66, "No auth_info? → print QR", AMBER_L, AMBER),
        (54, "Scan QR w/ spare phone (Linked Devices)", BLUE_L, BLUE),
        (42, "Session saved to auth_info/ (creds.update)", GREEN_L, GREEN),
        (30, "Connected — serving messages", GREEN_L, GREEN),
    ]
    prev = None
    for y, t, fc, ec in nodes:
        box(ax, 20, y, 46, 7, t, fc=fc, ec=ec, fs=9.5)
        if prev:
            arrow(ax, (43, prev), (43, y + 7), color=INK)
        prev = y
    box(ax, 72, 40, 24, 9, "Logged out / banned →\ndelete auth_info, re-scan", fc=RED_L, ec=RED, fs=8.5)
    arrow(ax, (66, 33), (72, 44), color=RED)
    ax.text(50, 18, "Risks: QR expiry · multi-device logout · session corruption · account ban (unofficial client)",
            ha="center", fontsize=8.5, color=RED, style="italic")
    save(fig, "07_auth_lifecycle.png")


# ---------------------------------------------------------------------------
# 8. Scaling stages
# ---------------------------------------------------------------------------
def d08_scaling():
    fig, ax = _fig(12, 7.5)
    title(ax, "Scaling Roadmap", "WhatsApp sessions bind to one identity — scale by sharding, not naive replicas")
    stages = [
        (6, "Stage 0\nSingle VPS\n1 number\n(now)", GREEN_L, GREEN),
        (30, "Stage 1\nVertical: bigger VPS\n+ backups + monitoring", BLUE_L, BLUE),
        (54, "Stage 2\nWhatsApp Business\nPlatform (Cloud API)\n+ inbound queue", AMBER_L, AMBER),
        (78, "Stage 3\nSharded workers by\nnumber + shared store\n+ vector DB", PURPLE_L, PURPLE),
    ]
    for x, t, fc, ec in stages:
        box(ax, x, 45, 20, 22, t, fc=fc, ec=ec, fs=9, bold=True)
    for x in (26, 50, 74):
        arrow(ax, (x, 56), (x + 4, 56), color=INK)
    ax.text(50, 32, "Trigger to move up a stage = sustained load, ban risk, or paying B2B customers — not vanity growth",
            ha="center", fontsize=8.5, color=GRAY, style="italic")
    ax.text(50, 24, "Key constraint: one WhatsApp number = one session. Horizontal scale needs a single ingress\n"
                    "worker + queue, or multiple numbers sharded across workers.",
            ha="center", fontsize=8.5, color=RED)
    save(fig, "08_scaling.png")


# ---------------------------------------------------------------------------
# 9. Risk matrix
# ---------------------------------------------------------------------------
def d09_risk_matrix():
    fig, ax = plt.subplots(figsize=(11, 7.5))
    ax.set_xlim(0, 10); ax.set_ylim(0, 10);
    ax.set_xlabel("Likelihood →", fontsize=11, weight="bold")
    ax.set_ylabel("Impact →", fontsize=11, weight="bold")
    ax.set_title("Risk Matrix — AgriFriend to Production", fontsize=15, weight="bold", color=INK, pad=14)
    # zones
    ax.add_patch(Rectangle((0, 0), 10, 10, fc="#E8F5E9", ec="none"))
    ax.add_patch(Rectangle((5, 5), 5, 5, fc="#FFCDD2", ec="none"))
    ax.add_patch(Rectangle((6.6, 6.6), 3.4, 3.4, fc="#EF9A9A", ec="none"))
    risks = [
        (8.5, 8.8, "WhatsApp ban\n(unofficial Baileys)", RED),
        (6.5, 7.5, "Gemini cost\nrunaway", AMBER),
        (4.0, 8.0, "Untested core\n(0% handler)", AMBER),
        (5.5, 6.0, "Data loss\n(no fsync)", AMBER),
        (3.0, 6.5, "Agri-advice\nliability", RED),
        (4.5, 4.0, "Privacy / DPDP", AMBER),
        (2.5, 3.0, "Localization\ngap", GRAY),
        (7.0, 4.5, "Model / API\ndeprecation", GRAY),
    ]
    for x, y, t, c in risks:
        ax.scatter([x], [y], s=260, color=c, edgecolor=INK, zorder=3)
        ax.text(x, y - 0.75, t, ha="center", va="top", fontsize=8, color=INK)
    for s in ax.spines.values():
        s.set_edgecolor(GRAY)
    ax.set_xticks([]); ax.set_yticks([])
    fig.savefig(os.path.join(OUT, "09_risk_matrix.png"), bbox_inches="tight", facecolor=WHITE, pad_inches=0.25)
    plt.close(fig); print("wrote 09_risk_matrix.png")


# ---------------------------------------------------------------------------
# 10. Readiness scorecard
# ---------------------------------------------------------------------------
def d10_scorecard():
    fig, ax = plt.subplots(figsize=(11, 7))
    dims = ["Code quality", "Unit tests", "Integration\ntests", "Security\nhardening",
            "Runtime\nproven", "Deployment\ndocs", "Observability", "Compliance"]
    scores = [8, 6, 1, 6, 1, 5, 3, 2]
    colors = [GREEN if s >= 7 else (AMBER if s >= 4 else RED) for s in scores]
    ax.barh(dims[::-1], scores[::-1], color=colors[::-1], edgecolor=INK)
    ax.set_xlim(0, 10)
    ax.set_xlabel("Readiness  (0 = absent, 10 = production-grade)", fontsize=10, weight="bold")
    ax.set_title("Production-Readiness Scorecard  ·  Verdict: GO WITH CAVEATS (monitored beta)",
                 fontsize=13, weight="bold", color=INK, pad=12)
    for i, s in enumerate(scores[::-1]):
        ax.text(s + 0.15, i, str(s), va="center", fontsize=9, weight="bold", color=INK)
    ax.axvline(7, color=GREEN, ls="--", lw=1)
    for sp in ["top", "right"]:
        ax.spines[sp].set_visible(False)
    fig.savefig(os.path.join(OUT, "10_scorecard.png"), bbox_inches="tight", facecolor=WHITE, pad_inches=0.25)
    plt.close(fig); print("wrote 10_scorecard.png")


# ---------------------------------------------------------------------------
# 11. GTM funnel
# ---------------------------------------------------------------------------
def d11_gtm_funnel():
    fig, ax = _fig(11, 7.5)
    title(ax, "Go-to-Market Funnel", "Dealer-led acquisition — farmers won't self-serve SaaS")
    widths = [(10, 80, "Agri-input dealers & FPOs (trust brokers)", GREEN),
              (18, 64, "Farmers onboarded via dealer referral code", BLUE),
              (26, 48, "Active users (ask crop/pest questions)", PURPLE),
              (34, 32, "Retained + high-intent (repeat, photos)", AMBER),
              (42, 16, "Monetized: B2B sponsors + premium", RED)]
    for i, (x, y, t, c) in enumerate(widths):
        w = 100 - 2 * x
        box(ax, x, y, w, 12, t, fc=WHITE, ec=c, tc=INK, fs=9.5, bold=True, lw=2)
    ax.text(50, 6, "Monetization is B2B-led (agri-input sponsorship, FPO/gov contracts), not farmer subscriptions",
            ha="center", fontsize=8.5, color=GRAY, style="italic")
    save(fig, "11_gtm_funnel.png")


# ---------------------------------------------------------------------------
# 12. Revenue model
# ---------------------------------------------------------------------------
def d12_revenue():
    fig, ax = _fig(12, 7.5)
    title(ax, "Revenue Model & Illustrative Unit Economics",
          "Figures are ILLUSTRATIVE assumptions — validate before use")
    box(ax, 4, 60, 28, 22, "B2B Sponsored Advisory\nAgri-input cos pay for\ncontextual brand mentions\n& lead gen (CPL/CPC)", fc=GREEN_L, ec=GREEN, fs=9, bold=True)
    box(ax, 36, 60, 28, 22, "B2B2C / FPO & Gov\nPer-farmer SaaS to\nco-ops, agri-cos, schemes\n(annual contracts)", fc=BLUE_L, ec=BLUE, fs=9, bold=True)
    box(ax, 68, 60, 28, 22, "Premium (thin)\nVoice, priority, expert\nescalation — small % of\nhigh-intent users", fc=PURPLE_L, ec=PURPLE, fs=9, bold=True)
    # cost line
    box(ax, 8, 30, 40, 18,
        "Variable cost / active user / month (illustrative)\n"
        "• Gemini text+vision: model-dependent\n"
        "• WhatsApp Business Platform session fees\n"
        "• Human escalation for edge cases",
        fc=AMBER_L, ec=AMBER, fs=8.5)
    box(ax, 54, 30, 42, 18,
        "Margin levers\n"
        "• Gemini context caching (media)\n"
        "• Keyword fast-path to skip model calls\n"
        "• Cache common crop/pest answers\n"
        "• Batch / off-peak embedding",
        fc=GREEN_L, ec=GREEN, fs=8.5)
    ax.text(50, 20, "Unit economics hinge on: Gemini token+image cost, WhatsApp session fees, CAC via dealers, and churn.",
            ha="center", fontsize=8.5, color=INK)
    ax.text(50, 15, "None are validated yet — treat this doc's numbers as a MODEL to fill in, not a forecast.",
            ha="center", fontsize=8.5, color=RED, style="italic")
    save(fig, "12_revenue_model.png")


# ---------------------------------------------------------------------------
# 13. Test coverage before / after
# ---------------------------------------------------------------------------
def d13_coverage():
    import numpy as np
    fig, ax = plt.subplots(figsize=(11, 6.5))
    mods = ["handler.ts\n(message router)", "whatsapp.ts\n(reconnect)", "gemini.ts",
            "memory.ts", "persist.ts", "OVERALL"]
    before = [0, 0, 12, 21, 87, 38]
    after = [75, 81, 65, 82, 100, 83]
    y = np.arange(len(mods))
    h = 0.38
    ax.barh(y + h / 2, before, height=h, color=AMBER, label="Before (P0–P1)", edgecolor=INK)
    ax.barh(y - h / 2, after, height=h, color=GREEN, label="After (Phase 2)", edgecolor=INK)
    ax.set_yticks(y); ax.set_yticklabels(mods[::-1] and mods)
    ax.invert_yaxis()
    ax.set_xlim(0, 105); ax.set_xlabel("Line coverage (%)", fontsize=10, weight="bold")
    ax.set_title("Test Coverage — Before vs After Phase 2", fontsize=14, weight="bold", color=INK, pad=12)
    ax.axvline(80, color=GREEN, ls="--", lw=1)
    ax.text(80, -0.7, "80% gate", color=GREEN, fontsize=8, ha="center")
    for i, (b, a) in enumerate(zip(before, after)):
        ax.text(b + 1, i + h / 2, f"{b}%", va="center", fontsize=8, color=INK)
        ax.text(a + 1, i - h / 2, f"{a}%", va="center", fontsize=8, weight="bold", color=GREEN)
    ax.legend(loc="lower right", fontsize=9)
    for sp in ["top", "right"]:
        ax.spines[sp].set_visible(False)
    fig.savefig(os.path.join(OUT, "13_coverage.png"), bbox_inches="tight", facecolor=WHITE, pad_inches=0.25)
    plt.close(fig); print("wrote 13_coverage.png")


# ---------------------------------------------------------------------------
# 14. Path to production
# ---------------------------------------------------------------------------
def d14_roadmap():
    fig, ax = _fig(12, 7.5)
    title(ax, "Path to Production", "Engineering gaps are closed; what remains is operational & product")
    steps = [
        (82, "P0–P1–P2 hardening", "DONE", GREEN, GREEN_L),
        (72, "Phase 1 bug fixes (crash, image, dedup)", "DONE", GREEN, GREEN_L),
        (62, "Live boot smoke test (reaches QR)", "DONE", GREEN, GREEN_L),
        (52, "Phase 2 integration tests (83% coverage)", "DONE", GREEN, GREEN_L),
        (42, "Live pilot: pair a spare number, 1 group, 1 week", "NEXT", AMBER, AMBER_L),
        (32, "Observability: metrics, alerting, cost monitor", "TODO", GRAY, GRAY_L),
        (22, "Compliance & disclaimers (DPDP, liability)", "TODO", GRAY, GRAY_L),
        (12, "WhatsApp Business Platform migration → GA", "TODO", BLUE, BLUE_L),
    ]
    for y, label, status, ec, fc in steps:
        box(ax, 14, y, 66, 8, label, fc=fc, ec=ec, fs=9.5)
        box(ax, 82, y, 14, 8, status, fc=ec, ec=ec, tc=WHITE, fs=9, bold=True)
    ax.text(50, 4, "Verdict: moved from 'go with caveats' toward 'good to go' — the two biggest council gaps "
                   "(untested core, never run) are now closed.",
            ha="center", fontsize=8.5, color=INK, style="italic")
    save(fig, "14_roadmap.png")


# ---------------------------------------------------------------------------
# 15. Two-system autonomy architecture (+ policy engine gate)
# ---------------------------------------------------------------------------
def d15_autonomy_arch():
    fig, ax = _fig(12, 8)
    title(ax, "Autonomy Architecture — Two Systems + a Policy Gate",
          "Product autonomy is separate from ops autonomy; every outbound send passes the policy engine")
    # farmer + channel
    box(ax, 4, 66, 16, 10, "Farmers\n(many tenants)", fc=GREEN_L, ec=GREEN, bold=True)
    box(ax, 4, 40, 16, 12, "WhatsApp Business\nPlatform (Cloud API)\n— required for outbound", fc=AMBER_L, ec=AMBER, bold=True, fs=8.5)
    # product core
    box(ax, 26, 60, 20, 16, "AgriFriend core\n(hardened, multi-tenant)\nreactive replies", fc=WHITE, ec=GREEN, bold=True)
    box(ax, 26, 38, 20, 14, "Autonomy Engine\nscheduler · triggers\npersonalization", fc=GREEN_L, ec=GREEN, bold=True, fs=9)
    # policy engine
    box(ax, 52, 46, 20, 20, "POLICY ENGINE\n(deterministic gate)\nconsent · risk class\nfrequency · quiet hrs\ncost · approval", fc=RED_L, ec=RED, bold=True, fs=8.5)
    # approval + send
    box(ax, 78, 62, 18, 10, "Human approval\n(high-risk advice)", fc=AMBER_L, ec=AMBER, fs=8.5)
    box(ax, 78, 44, 18, 10, "Send (templated,\nconsented)", fc=GREEN_L, ec=GREEN, bold=True, fs=8.5)
    # ops copilot
    box(ax, 30, 12, 30, 14, "Ops Copilot (OpenClaw / Hermes)\nmonitor · self-heal · deploy · alert operator\n[least privilege · no farmer data]", fc=BLUE_L, ec=BLUE, bold=True, fs=8.5)
    box(ax, 68, 14, 20, 10, "Operator\n(alerts, approvals)", fc=GRAY_L, ec=GRAY, fs=8.5)
    arrow(ax, (20, 60), (20, 52), color=AMBER, style="<|-|>")
    arrow(ax, (20, 46), (26, 45), color=AMBER)
    arrow(ax, (46, 45), (52, 52), color=GREEN)
    arrow(ax, (72, 60), (78, 65), color=RED)
    arrow(ax, (72, 54), (78, 50), color=RED)
    arrow(ax, (78, 49), (46, 46), color=GREEN, ls="--")
    arrow(ax, (45, 19), (30, 46), color=BLUE, ls=":")
    arrow(ax, (60, 19), (68, 19), color=GRAY)
    ax.text(50, 4, "Split-brain guard: the Autonomy Engine proposes; the Policy Engine decides; Ops Copilot has NO send authority.",
            ha="center", fontsize=8.5, color=INK, style="italic")
    save(fig, "15_autonomy_arch.png")


# ---------------------------------------------------------------------------
# 16. Autonomy ladder
# ---------------------------------------------------------------------------
def d16_ladder():
    fig, ax = _fig(11, 8)
    title(ax, "The Autonomy Ladder", "Increase autonomy only as safety is proven — advice stays bounded")
    rungs = [
        (14, "L0  Reactive — answers when asked  (TODAY)", GREEN, GREEN_L),
        (25, "L1  Proactive broadcast — templated tips & weather", BLUE, BLUE_L),
        (36, "L2  Personalized follow-ups (crop-stage, past issues)", BLUE, BLUE_L),
        (47, "L3  Agentic actions — APIs, expert escalation, calls", AMBER, AMBER_L),
        (58, "L4  Self-managing ops — heal, deploy, cost governance", PURPLE, PURPLE_L),
        (69, "L5  Self-improving — refine skills (governed, last)", RED, RED_L),
    ]
    for i, (y, label, ec, fc) in enumerate(rungs):
        w = 40 + i * 8
        box(ax, 8, y, w, 8, label, fc=fc, ec=ec, fs=9, bold=(i == 0))
    ax.plot([6, 92], [43, 43], color=RED, ls="--", lw=1.4)
    ax.text(92, 44.5, "human-in-the-loop above this line\n(high-stakes agronomic advice)", ha="right",
            fontsize=8, color=RED, style="italic")
    save(fig, "16_ladder.png")


# ---------------------------------------------------------------------------
# 17. Autonomy phased roadmap
# ---------------------------------------------------------------------------
def d17_autonomy_roadmap():
    fig, ax = _fig(12, 7)
    title(ax, "Autonomy Roadmap", "Phase A is the unlock; Phase B is the safe quick win")
    phases = [
        (4, "A. Foundation\nWA Business Platform\nconsent · templates\n· policy engine", AMBER_L, AMBER, "UNLOCK"),
        (24, "B. Ops Copilot\nmonitor · heal\ndeploy · alert\n(least privilege)", BLUE_L, BLUE, "QUICK WIN"),
        (44, "C. Proactive engine\nscheduler · triggers\npersonalization\n+ approval queue", GREEN_L, GREEN, "L1→L2"),
        (64, "D. Agentic actions\nweather/market APIs\nescalation · calls", PURPLE_L, PURPLE, "L3"),
        (84, "E. Self-improve\noutcome tracking\ngoverned refinement", RED_L, RED, "L5 · last"),
    ]
    for x, t, fc, ec, tag in phases:
        box(ax, x, 42, 15, 24, t, fc=fc, ec=ec, fs=8, bold=True)
        box(ax, x, 34, 15, 6, tag, fc=ec, ec=ec, tc=WHITE, fs=7.5, bold=True)
    for x in (19, 39, 59, 79):
        arrow(ax, (x, 54), (x + 5, 54), color=INK)
    ax.text(50, 22, "Contingency at every phase: if WhatsApp quality-rating drops or the number is restricted,\n"
                    "gracefully degrade to reactive-only mode.",
            ha="center", fontsize=8.5, color=RED, style="italic")
    save(fig, "17_autonomy_roadmap.png")


# ---------------------------------------------------------------------------
# 18. Policy engine decision flow
# ---------------------------------------------------------------------------
def d18_policy_flow():
    fig, ax = _fig(11, 8.5)
    title(ax, "Policy Engine — Every Outbound Message Passes This Gate",
          "Deterministic checks between the AI/scheduler and the actual send")
    checks = [
        (80, "Candidate message (from Autonomy Engine)", GREEN_L, GREEN),
        (71, "Opt-in consent on file?", GRAY_L, GRAY),
        (62, "Risk class: high-stakes advice? → human approval", RED_L, RED),
        (53, "Approved template for this language?", BLUE_L, BLUE),
        (44, "Frequency cap & quiet hours OK?", AMBER_L, AMBER),
        (35, "Tenant quota & cost budget OK?", AMBER_L, AMBER),
        (26, "SEND — logged for full audit trail", GREEN_L, GREEN),
    ]
    prev = None
    for y, t, fc, ec in checks:
        box(ax, 22, y, 56, 6.5, t, fc=fc, ec=ec, fs=9)
        if prev:
            arrow(ax, (50, prev), (50, y + 6.5), color=INK)
        prev = y
    box(ax, 82, 44, 14, 20, "any check fails →\nSUPPRESS\n+ log reason\n+ no send", fc=RED_L, ec=RED, fs=8, bold=True)
    for y in (71, 62, 53, 44, 35):
        arrow(ax, (78, y + 3), (82, 54), color=RED, ls=":")
    ax.text(50, 15, "Audit record per message: facts · prompt+model version · template ID · consent basis ·\n"
                    "tenant · cost · approval · delivery status.",
            ha="center", fontsize=8, color=INK, style="italic")
    save(fig, "18_policy_flow.png")


# ---------------------------------------------------------------------------
# 19. Value map
# ---------------------------------------------------------------------------
def d19_value_map():
    fig, ax = _fig(12, 8)
    title(ax, "How Autonomy Enhances AgriFriend", "From a reactive tool into a proactive, trusted companion")
    box(ax, 38, 82, 24, 9, "Autonomy\n(proactive + self-managing)", fc=GREEN, ec=GREEN, tc=WHITE, bold=True, fs=9.5)
    # farmer value
    ax.text(22, 72, "Farmer value", ha="center", fontsize=11, weight="bold", color=GREEN)
    fv = [(62, "Timely weather & pest early-warning"), (54, "Crop-stage nudges (right advice, right time)"),
          (46, "Never-forgotten follow-ups"), (38, "Market prices when they matter"),
          (30, "Voice + local language reach")]
    for y, t in fv:
        box(ax, 4, y, 36, 6.5, t, fc=GREEN_L, ec=GREEN, fs=8.5)
    # business value
    ax.text(78, 72, "Business value", ha="center", fontsize=11, weight="bold", color=BLUE)
    bv = [(62, "Higher retention & daily engagement"), (54, "Proactive reach sponsors will pay for"),
          (46, "FPO/gov: measurable extension at scale"), (38, "Lower ops cost (self-healing)"),
          (30, "Data flywheel: outcomes improve advice")]
    for y, t in bv:
        box(ax, 60, y, 36, 6.5, t, fc=BLUE_L, ec=BLUE, fs=8.5)
    arrow(ax, (44, 82), (22, 69), color=GREEN)
    arrow(ax, (56, 82), (78, 69), color=BLUE)
    ax.text(50, 20, "Guardrail: value depends on TRUST — anti-fatigue caps, consent, and human-checked advice protect it.",
            ha="center", fontsize=8.5, color=RED, style="italic")
    save(fig, "19_value_map.png")


if __name__ == "__main__":
    d01_original_arch(); d02_message_flow(); d03_hardened_arch(); d04_before_after()
    d05_memory(); d06_deployment(); d07_auth_lifecycle(); d08_scaling()
    d09_risk_matrix(); d10_scorecard(); d11_gtm_funnel(); d12_revenue()
    d13_coverage(); d14_roadmap()
    d15_autonomy_arch(); d16_ladder(); d17_autonomy_roadmap(); d18_policy_flow(); d19_value_map()
    print("\nAll diagrams written to", os.path.abspath(OUT))
