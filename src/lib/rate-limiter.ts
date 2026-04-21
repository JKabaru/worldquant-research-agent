// ============================================================
// LLM Rate Limiter - Prevents hitting API rate limits on free tiers
// ============================================================

export class RateLimiter {
  private calls: number[] = [];
  private maxCallsPerMinute: number;
  private maxCallsPerHour: number;
  private minIntervalMs: number;

  constructor(config: { maxPerMinute?: number; maxPerHour?: number; minIntervalMs?: number } = {}) {
    this.maxCallsPerMinute = config.maxPerMinute || 20;
    this.maxCallsPerHour = config.maxPerHour || 200;
    this.minIntervalMs = config.minIntervalMs || 3000;
  }

  async acquire(): Promise<void> {
    const now = Date.now();

    // Clean old entries (older than 1 hour)
    this.calls = this.calls.filter(t => now - t < 3600000);

    // Check per-minute limit
    const recentMinute = this.calls.filter(t => now - t < 60000).length;
    if (recentMinute >= this.maxCallsPerMinute) {
      const oldestInMinute = this.calls.find(t => now - t < 60000);
      if (oldestInMinute) {
        const waitMs = 60000 - (now - oldestInMinute) + 1000;
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    // Check per-hour limit
    if (this.calls.length >= this.maxCallsPerHour) {
      const waitMs = 3600000 - (now - this.calls[0]) + 1000;
      await new Promise(r => setTimeout(r, waitMs));
    }

    // Check minimum interval between calls
    if (this.calls.length > 0) {
      const lastCall = Math.max(...this.calls);
      const elapsed = now - lastCall;
      if (elapsed < this.minIntervalMs) {
        await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
      }
    }

    this.calls.push(Date.now());
  }

  getStats(): { callsInLastMinute: number; callsInLastHour: number } {
    const now = Date.now();
    return {
      callsInLastMinute: this.calls.filter(t => now - t < 60000).length,
      callsInLastHour: this.calls.filter(t => now - t < 3600000).length,
    };
  }

  updateConfig(config: { maxPerMinute?: number; maxPerHour?: number; minIntervalMs?: number }): void {
    if (config.maxPerMinute !== undefined) this.maxCallsPerMinute = config.maxPerMinute;
    if (config.maxPerHour !== undefined) this.maxCallsPerHour = config.maxPerHour;
    if (config.minIntervalMs !== undefined) this.minIntervalMs = config.minIntervalMs;
  }
}
