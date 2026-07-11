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


if __name__ == "__main__":
    d01_original_arch(); d02_message_flow(); d03_hardened_arch(); d04_before_after()
    d05_memory(); d06_deployment(); d07_auth_lifecycle(); d08_scaling()
    d09_risk_matrix(); d10_scorecard(); d11_gtm_funnel(); d12_revenue()
    print("\nAll diagrams written to", os.path.abspath(OUT))
