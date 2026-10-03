/** Cache LRU limitata per numero di voci e per byte, con conteggio incrementale (O(1) per inserimento). */
export class ByteLruCache<V extends { size: number }> {
  private readonly entries = new Map<string, V>();
  private bytes = 0;

  constructor(private readonly maxEntries: number, private readonly maxBytes: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  set(key: string, value: V): void {
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.size;
    this.entries.delete(key);
    this.entries.set(key, value);
    this.bytes += value.size;
    while (this.entries.size > 1 && (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)) {
      const oldest = this.entries.keys().next().value as string;
      this.bytes -= this.entries.get(oldest)!.size;
      this.entries.delete(oldest);
    }
  }

  get totalBytes(): number {
    return this.bytes;
  }

  get count(): number {
    return this.entries.size;
  }
}
