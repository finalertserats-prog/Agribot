import { createHash } from "crypto";

/**
 * Governed skill/prompt refinement (Phase E). Self-improvement must NEVER
 * silently change farmer-facing behaviour. A proposed change is "pending" until
 * a human approves it; every version is recorded and reversible. This is the
 * governance that makes a "self-improving loop" safe for an advice product.
 */
export type SkillStatus = "active" | "pending" | "archived";

export interface SkillVersion {
  id: string;
  name: string; // the skill/prompt identity, e.g. "seasonal_tip_prompt"
  content: string;
  status: SkillStatus;
  author: string;
  at: string;
}

export class SkillGovernance {
  private readonly versions = new Map<string, SkillVersion>();
  private readonly activeByName = new Map<string, string>(); // name -> version id
  private readonly history = new Map<string, string[]>(); // name -> version ids, newest last

  // Return a frozen copy so callers can never mutate stored state (which would
  // defeat the "pending until approved" guarantee).
  private freeze(v: SkillVersion): SkillVersion {
    return Object.freeze({ ...v });
  }

  private mk(name: string, content: string, status: SkillStatus, author: string, now: number): SkillVersion {
    const id = createHash("sha256")
      .update(`${name}|${content}|${now}|${author}`)
      .digest("hex")
      .slice(0, 16);
    const v: SkillVersion = { id, name, content, status, author, at: new Date(now).toISOString() };
    this.versions.set(id, v);
    return v;
  }

  /** Register the initial active version. No-op-returns if already registered. */
  register(name: string, content: string, author = "system", now = Date.now()): SkillVersion {
    const existing = this.active(name);
    if (existing) return existing; // don't silently reset history
    const v = this.mk(name, content, "active", author, now);
    this.activeByName.set(name, v.id);
    this.history.set(name, [v.id]);
    return this.freeze(v);
  }

  active(name: string): SkillVersion | undefined {
    const id = this.activeByName.get(name);
    const v = id ? this.versions.get(id) : undefined;
    return v ? this.freeze(v) : undefined;
  }

  /** Propose a change. Creates a PENDING version — it does NOT go live. */
  propose(name: string, content: string, author: string, now = Date.now()): SkillVersion {
    return this.freeze(this.mk(name, content, "pending", author, now));
  }

  /** Approve a pending version — it becomes active; the previous is archived. */
  approve(versionId: string): boolean {
    const v = this.versions.get(versionId);
    if (!v || v.status !== "pending") return false;
    const prevId = this.activeByName.get(v.name);
    if (prevId) {
      const prev = this.versions.get(prevId);
      if (prev) prev.status = "archived";
    }
    v.status = "active";
    this.activeByName.set(v.name, v.id);
    (this.history.get(v.name) ?? this.history.set(v.name, []).get(v.name)!).push(v.id);
    return true;
  }

  /** Roll back to the previous active version — reversibility is mandatory. */
  rollback(name: string): boolean {
    const ids = this.history.get(name);
    if (!ids || ids.length < 2) return false;
    // Validate the target exists BEFORE mutating any state.
    const currentId = ids[ids.length - 1];
    const prevId = ids[ids.length - 2];
    const current = this.versions.get(currentId);
    const prev = this.versions.get(prevId);
    if (!current || !prev) return false;
    ids.pop();
    current.status = "archived";
    prev.status = "active";
    this.activeByName.set(name, prevId);
    return true;
  }
}
