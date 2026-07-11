/**
 * Outcome tracking for self-improvement (Phase E). Records whether advice
 * actually helped — NOT just whether a message was opened. Outcomes are noisy,
 * delayed, and confounded (weather, soil, market), so labels are honest and
 * "unclear" is excluded from the quality metric rather than counted as success.
 */
export type OutcomeLabel = "helpful" | "not_helpful" | "unclear";

export interface Outcome {
  farmerId: string;
  messageType: string;
  label: OutcomeLabel;
  confounderNote?: string; // e.g. "unusual rainfall this week"
  at: string;
}

export class OutcomeStore {
  private readonly outcomes: Outcome[] = [];

  record(
    farmerId: string,
    messageType: string,
    label: OutcomeLabel,
    confounderNote?: string,
    now: number = Date.now()
  ): void {
    this.outcomes.push({
      farmerId,
      messageType,
      label,
      confounderNote,
      at: new Date(now).toISOString(),
    });
  }

  /**
   * Quality = helpful / (helpful + not_helpful). "unclear" is excluded so
   * ambiguous outcomes never inflate the score. Returns null when there isn't
   * enough clear signal yet (don't optimize on noise).
   */
  qualityRate(messageType?: string, minSample = 10): number | null {
    const relevant = this.outcomes.filter(
      (o) => (!messageType || o.messageType === messageType) && o.label !== "unclear"
    );
    if (relevant.length < minSample) return null;
    const helpful = relevant.filter((o) => o.label === "helpful").length;
    return helpful / relevant.length;
  }

  count(): number {
    return this.outcomes.length;
  }
}
