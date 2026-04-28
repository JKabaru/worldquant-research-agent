// ============================================================
// LLM Rate Limiter - Prevents hitting API rate limits on free tiers
// ============================================================

export class RateLimiter {
  private calls: number[] = [];
  private maxCallsPerMinute: number;
  private maxCallsPerHour: number;
  private minIntervalMs: number;
  private penaltyUntilMs = 0;
  private adaptiveMinIntervalMs = 0;
  private throttledCount = 0;
  private penaltyCount = 0;

  constructor(config: { maxPerMinute?: number; maxPerHour?: number; minIntervalMs?: number } = {}) {
    this.maxCallsPerMinute = config.maxPerMinute || 20;
    this.maxCallsPerHour = config.maxPerHour || 200;
    this.minIntervalMs = config.minIntervalMs || 3000;
  }

  async acquire(): Promise<{ waitedMs: number }> {
    const now = Date.now();
    let waitedMs = 0;

    // Clean old entries (older than 1 hour)
    this.calls = this.calls.filter(t => now - t < 3600000);

    // Apply provider penalty window (e.g., Retry-After from 429)
    if (this.penaltyUntilMs > now) {
      const waitMs = this.penaltyUntilMs - now;
      await new Promise(r => setTimeout(r, waitMs));
      waitedMs += waitMs;
      this.throttledCount++;
    }

    // Check per-minute limit
    const afterPenalty = Date.now();
    const recentMinute = this.calls.filter(t => afterPenalty - t < 60000).length;
    if (recentMinute >= this.maxCallsPerMinute) {
      const oldestInMinute = this.calls.find(t => afterPenalty - t < 60000);
      if (oldestInMinute) {
        const waitMs = 60000 - (afterPenalty - oldestInMinute) + 1000;
        await new Promise(r => setTimeout(r, waitMs));
        waitedMs += waitMs;
        this.throttledCount++;
      }
    }

    // Check per-hour limit
    if (this.calls.length >= this.maxCallsPerHour) {
      const afterMinute = Date.now();
      const waitMs = 3600000 - (afterMinute - this.calls[0]) + 1000;
      await new Promise(r => setTimeout(r, waitMs));
      waitedMs += waitMs;
      this.throttledCount++;
    }

    // Check minimum interval between calls
    if (this.calls.length > 0) {
      const lastCall = Math.max(...this.calls);
      const afterHour = Date.now();
      const elapsed = afterHour - lastCall;
      const effectiveInterval = Math.max(this.minIntervalMs, this.adaptiveMinIntervalMs);
      if (elapsed < effectiveInterval) {
        const waitMs = effectiveInterval - elapsed;
        await new Promise(r => setTimeout(r, waitMs));
        waitedMs += waitMs;
        this.throttledCount++;
      }
    }

    this.calls.push(Date.now());
    return { waitedMs };
  }

  applyPenalty(waitMs: number): void {
    const now = Date.now();
    this.penaltyUntilMs = Math.max(this.penaltyUntilMs, now + Math.max(0, waitMs));
    this.penaltyCount++;
  }

  applyBackoffHint(retryAttempt: number): void {
    // Increase call spacing when providers start rejecting frequently.
    const bump = Math.min(5000, 500 * (retryAttempt + 1));
    this.adaptiveMinIntervalMs = Math.max(this.adaptiveMinIntervalMs, this.minIntervalMs + bump);
  }

  decayAdaptiveBackoff(): void {
    // Slowly recover back to baseline when calls succeed.
    if (this.adaptiveMinIntervalMs > this.minIntervalMs) {
      this.adaptiveMinIntervalMs = Math.max(
        this.minIntervalMs,
        Math.floor(this.adaptiveMinIntervalMs * 0.9)
      );
    }
  }

  getStats(): {
    callsInLastMinute: number;
    callsInLastHour: number;
    minIntervalMs: number;
    adaptiveMinIntervalMs: number;
    throttledCount: number;
    penaltyCount: number;
    penaltyActive: boolean;
  } {
    const now = Date.now();
    return {
      callsInLastMinute: this.calls.filter(t => now - t < 60000).length,
      callsInLastHour: this.calls.filter(t => now - t < 3600000).length,
      minIntervalMs: this.minIntervalMs,
      adaptiveMinIntervalMs: this.adaptiveMinIntervalMs,
      throttledCount: this.throttledCount,
      penaltyCount: this.penaltyCount,
      penaltyActive: this.penaltyUntilMs > now,
    };
  }

  updateConfig(config: { maxPerMinute?: number; maxPerHour?: number; minIntervalMs?: number }): void {
    if (config.maxPerMinute !== undefined) this.maxCallsPerMinute = config.maxPerMinute;
    if (config.maxPerHour !== undefined) this.maxCallsPerHour = config.maxPerHour;
    if (config.minIntervalMs !== undefined) this.minIntervalMs = config.minIntervalMs;
  }
}
