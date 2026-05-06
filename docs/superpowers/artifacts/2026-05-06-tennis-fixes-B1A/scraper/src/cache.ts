type Entry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) {
      this.missCount++;
      return undefined;
    }
    if (Date.now() >= e.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return undefined;
    }
    this.hitCount++;
    return e.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Clear all entries. Used in tests to prevent cross-test cache pollution. */
  clear(): void { this.store.clear(); }

  size(): number { return this.store.size; }
  hits(): number { return this.hitCount; }
  misses(): number { return this.missCount; }
}
