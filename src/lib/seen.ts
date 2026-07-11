/**
 * Bounded FIFO set for cheap "have I already handled this?" checks.
 * Used to drop duplicate WhatsApp message deliveries (Baileys can redeliver
 * the same message on reconnect/resync).
 */
export class SeenCache {
  private readonly set = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity: number) {}

  /** Returns true if `key` was already seen; otherwise records it and returns false. */
  check(key: string): boolean {
    if (this.set.has(key)) return true;
    this.set.add(key);
    this.order.push(key);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
    return false;
  }

  get size(): number {
    return this.set.size;
  }

  /** Seed the cache from persisted keys (e.g. on startup). Order preserved. */
  seed(keys: string[]): void {
    for (const key of keys) {
      if (this.set.has(key)) continue;
      this.set.add(key);
      this.order.push(key);
    }
    while (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
  }

  /** Current keys, oldest first — for persistence. */
  snapshot(): string[] {
    return [...this.order];
  }
}
