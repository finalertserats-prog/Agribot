/**
 * Delivery-quality feedback. A message accepted by the transport is NOT the
 * same as delivered/read/acted-on. This tracks lightweight per-farmer signals
 * so the engine can suppress outreach to persistently non-engaging farmers.
 *
 * Scaffold: in-memory counts. Production ingests WhatsApp delivery/read
 * webhooks and inbound-reply classification.
 */
export type DeliveryStatus = "sent" | "delivered" | "read" | "replied" | "failed";

export class DeliveryStore {
  private readonly sent = new Map<string, number>();
  private readonly engaged = new Map<string, number>(); // read or replied

  record(farmerId: string, status: DeliveryStatus): void {
    if (status === "sent") this.bump(this.sent, farmerId);
    if (status === "read" || status === "replied") this.bump(this.engaged, farmerId);
  }

  private bump(m: Map<string, number>, k: string): void {
    m.set(k, (m.get(k) ?? 0) + 1);
  }

  /** Fraction of sent messages the farmer engaged with (0..1); 1 if none sent yet. */
  engagementRate(farmerId: string): number {
    const s = this.sent.get(farmerId) ?? 0;
    if (s === 0) return 1;
    // Clamp — duplicate/retried webhook events could push engaged past sent.
    return Math.min(1, (this.engaged.get(farmerId) ?? 0) / s);
  }

  /** Should we keep messaging this farmer? False after enough ignored sends. */
  shouldKeepMessaging(farmerId: string, minSent = 5, minRate = 0.1): boolean {
    const s = this.sent.get(farmerId) ?? 0;
    if (s < minSent) return true; // not enough signal yet
    return this.engagementRate(farmerId) >= minRate;
  }
}
