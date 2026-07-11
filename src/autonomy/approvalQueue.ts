import { createHash } from "crypto";
import type { OutboundCandidate } from "../policy/types";

export interface ApprovalItem {
  id: string;
  candidate: OutboundCandidate;
  reason: string;
  queuedAt: string;
}

/**
 * Holds high-risk candidates awaiting human approval. On approval the candidate
 * is returned with `approvedBy` set so it can be re-evaluated and sent.
 *
 * In-memory for the scaffold; production persists this (so approvals survive
 * restarts) and adds per-tenant reviewer routing + SLAs.
 */
export class ApprovalQueue {
  private readonly items = new Map<string, ApprovalItem>();

  enqueue(
    candidate: OutboundCandidate,
    reason: string,
    now: number = Date.now()
  ): { id: string; created: boolean } {
    // Dedupe: don't stack identical pending items for the same candidate.
    for (const it of this.items.values()) {
      if (
        it.candidate.farmerId === candidate.farmerId &&
        it.candidate.templateId === candidate.templateId
      ) {
        return { id: it.id, created: false };
      }
    }
    const id = createHash("sha256")
      .update(`${candidate.tenantId}|${candidate.farmerId}|${candidate.templateId}|${now}`)
      .digest("hex")
      .slice(0, 16);
    this.items.set(id, { id, candidate, reason, queuedAt: new Date(now).toISOString() });
    return { id, created: true };
  }

  list(): ApprovalItem[] {
    return [...this.items.values()];
  }

  get size(): number {
    return this.items.size;
  }

  /** Approve an item; returns the candidate with `approvedBy` set (or null). */
  approve(id: string, approver: string): OutboundCandidate | null {
    const item = this.items.get(id);
    if (!item) return null;
    this.items.delete(id);
    return { ...item.candidate, approvedBy: approver };
  }

  reject(id: string): boolean {
    return this.items.delete(id);
  }
}
