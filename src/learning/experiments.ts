import { createHash } from "crypto";

/**
 * Outreach experiment (Phase E). Deterministically assigns subjects to variants
 * so results are reproducible. Critically, it carries a GUARDRAIL: if the
 * agronomic-quality metric drops below the floor, the experiment halts and
 * everyone falls back to the control variant — an experiment may never trade
 * advice quality for engagement.
 */
export class Experiment {
  private halted = false;

  constructor(
    readonly name: string,
    private readonly variants: string[],
    private readonly guardrailFloor: number | null = null
  ) {
    if (variants.length === 0) throw new Error("experiment needs at least one variant");
  }

  /** control is the first variant — the safe default. */
  get control(): string {
    return this.variants[0];
  }

  get isHalted(): boolean {
    return this.halted;
  }

  /** Deterministic variant for a subject; control once halted. */
  variantFor(subjectId: string): string {
    if (this.halted) return this.control;
    const h = createHash("sha256").update(`${this.name}|${subjectId}`).digest();
    return this.variants[h[0] % this.variants.length];
  }

  /**
   * Feed the current guardrail metric (e.g. advice quality rate). If it falls
   * below the floor, halt the experiment. Once halted it stays halted (no
   * flip-flopping); a human restarts it deliberately.
   */
  reportGuardrail(value: number): void {
    if (this.guardrailFloor !== null && value < this.guardrailFloor) {
      this.halted = true;
    }
  }
}
