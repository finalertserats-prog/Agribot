/**
 * Tiny in-memory counter store for operational health signals.
 *
 * Deliberately counts ONLY — never message content or farmer data — so the
 * heartbeat the Ops Copilot reads carries no personal information.
 */
const counters: Record<string, number> = Object.create(null);
const startedAt = Date.now();

export function bump(name: string, by = 1): void {
  counters[name] = (counters[name] ?? 0) + by;
}

export function snapshot(): { uptimeSec: number; counters: Record<string, number> } {
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    counters: { ...counters },
  };
}

/** Reset counters (test isolation). */
export function resetMetrics(): void {
  for (const k of Object.keys(counters)) delete counters[k];
}
