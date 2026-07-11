/**
 * Anti-fatigue frequency caps + quiet hours, plus per-tenant daily quota.
 * Quiet hours are evaluated in the FARMER's local time zone, not the server's.
 */

const DAY_MS = 24 * 60 * 60_000;

export class FrequencyGuard {
  private readonly farmerHits = new Map<string, number[]>();
  private readonly tenantHits = new Map<string, number[]>();

  constructor(
    private readonly maxPerFarmerPerDay: number,
    private readonly maxPerTenantPerDay: number,
    private readonly windowMs: number = DAY_MS
  ) {}

  private recent(map: Map<string, number[]>, key: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    return (map.get(key) ?? []).filter((t) => t > cutoff);
  }

  withinFarmerCap(farmerId: string, now: number = Date.now()): boolean {
    return this.recent(this.farmerHits, farmerId, now).length < this.maxPerFarmerPerDay;
  }

  withinTenantQuota(tenantId: string, now: number = Date.now()): boolean {
    return this.recent(this.tenantHits, tenantId, now).length < this.maxPerTenantPerDay;
  }

  /**
   * Atomically record a send against BOTH the farmer cap and the tenant quota.
   * Single synchronous op = no check-then-write race in this process. A
   * persistent/multi-instance build must do this as one atomic DB write.
   */
  record(farmerId: string, tenantId: string, now: number = Date.now()): void {
    const f = this.recent(this.farmerHits, farmerId, now);
    f.push(now);
    this.farmerHits.set(farmerId, f);
    const t = this.recent(this.tenantHits, tenantId, now);
    t.push(now);
    this.tenantHits.set(tenantId, t);
  }

  reset(): void {
    this.farmerHits.clear();
    this.tenantHits.clear();
  }
}

/**
 * Is `now` within quiet hours for a farmer at `tzOffsetMinutes`?
 * Handles windows that wrap midnight (e.g. 21:00–07:00).
 */
export function isQuietHours(
  now: number,
  tzOffsetMinutes: number,
  startHour: number,
  endHour: number
): boolean {
  const local = new Date(now + tzOffsetMinutes * 60_000);
  const hour = local.getUTCHours();
  return startHour <= endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}
