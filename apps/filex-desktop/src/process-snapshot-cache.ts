export class ProcessSnapshotCache {
  private pending: Promise<Set<string>> | null = null;

  constructor(private readonly ttlMs: number) {}

  async get(fetchSnapshot: () => Promise<Set<string>>): Promise<Set<string>> {
    if (this.pending) return this.pending;

    const request = fetchSnapshot();
    this.pending = request;
    try {
      return await request;
    } finally {
      setTimeout(() => {
        if (this.pending === request) this.pending = null;
      }, this.ttlMs);
    }
  }
}
