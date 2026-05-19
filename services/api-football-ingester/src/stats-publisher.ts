/**
 * Cycle health metrics buffer + best-effort POST publisher for the
 * api-football ingester scheduler (M1.13).
 *
 * Design:
 *  - `StatsBuffer` accumulates per-endpoint call/error counts and the
 *    most recent rate-limit remaining value during a single cycle.
 *  - `publishStats` POSTs a snapshot to the admin route. It is
 *    intentionally exception-safe: the scheduler tick must not break
 *    if observability publishing fails. Errors are returned, never thrown.
 *
 * No `process.env` reads here — config is injected per call so the
 * service is unit-testable in isolation.
 */

export interface CycleStats {
  /** ISO timestamp of when the cycle began. */
  cycleStartedAt: string;
  /** Wall-clock duration of the cycle in milliseconds. */
  cycleDurationMs: number;
  /** Call count keyed by endpoint path (e.g. `/fixtures?live=all`). */
  endpointCalls: Record<string, number>;
  /** Error count keyed by endpoint path. */
  errors: Record<string, number>;
  /** Most recent observed api-sports rate-limit remaining, or null. */
  rateLimitRemaining: number | null;
}

export interface StatsPublisherConfig {
  /** Admin endpoint URL receiving the POST. */
  endpoint: string;
  /** Shared secret matching `SCRAPER_API_KEY` env on admin. */
  scraperKey: string;
}

export class StatsBuffer {
  private endpointCalls = new Map<string, number>();
  private errors = new Map<string, number>();
  private cycleStartedAtMs: number | null = null;
  private rateLimitRemaining: number | null = null;

  startCycle(nowMs: number = Date.now()): void {
    this.cycleStartedAtMs = nowMs;
    this.endpointCalls.clear();
    this.errors.clear();
    this.rateLimitRemaining = null;
  }

  recordCall(endpoint: string): void {
    this.endpointCalls.set(endpoint, (this.endpointCalls.get(endpoint) ?? 0) + 1);
  }

  recordError(endpoint: string): void {
    this.errors.set(endpoint, (this.errors.get(endpoint) ?? 0) + 1);
  }

  setRateLimitRemaining(n: number): void {
    this.rateLimitRemaining = n;
  }

  finishCycle(nowMs: number = Date.now()): CycleStats {
    const startMs = this.cycleStartedAtMs ?? nowMs;
    const stats: CycleStats = {
      cycleStartedAt: new Date(startMs).toISOString(),
      cycleDurationMs: nowMs - startMs,
      endpointCalls: Object.fromEntries(this.endpointCalls),
      errors: Object.fromEntries(this.errors),
      rateLimitRemaining: this.rateLimitRemaining,
    };
    // Clear so the next startCycle has a clean slate even if caller forgets.
    this.endpointCalls.clear();
    this.errors.clear();
    this.cycleStartedAtMs = null;
    this.rateLimitRemaining = null;
    return stats;
  }
}

/**
 * Best-effort POST of cycle stats to the admin route.
 * Never throws — returns `{ok:false, error}` on any failure.
 */
export async function publishStats(
  cfg: StatsPublisherConfig,
  stats: CycleStats,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-scraper-key': cfg.scraperKey,
      },
      body: JSON.stringify(stats),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
