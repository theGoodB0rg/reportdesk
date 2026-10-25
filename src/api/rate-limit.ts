/** Sliding-window limiter, per key. In-memory, so best-effort per process or isolate. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, nowMs: number): boolean {
    if (this.hits.size > 10_000) this.hits.clear(); // bound memory under key churn
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(nowMs);
    this.hits.set(key, recent);
    return allowed;
  }
}
