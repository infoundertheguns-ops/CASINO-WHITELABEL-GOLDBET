import type { RateLimitInfo } from './types.js';

/**
 * Thin HTTP client for api-sports.io v3 football endpoints.
 *
 * Responsibilities (M1.7 scope):
 *  - injects `x-apisports-key` auth header
 *  - parses `x-ratelimit-requests-{limit,remaining}` from each response
 *  - retries on HTTP 429 with exponential backoff 2s → 4s → 8s → 16s → 30s cap,
 *    up to 5 attempts total, then throws.
 *
 * Daily quota tracking and adaptive throttling live elsewhere (M1.9 state).
 */
export class ApiFootballClient {
  private apiKey: string;
  private baseUrl = 'https://v3.football.api-sports.io';
  private lastRl: RateLimitInfo | null = null;

  constructor(cfg: { apiKey: string }) {
    this.apiKey = cfg.apiKey;
  }

  /** Most recent rate-limit snapshot observed from a response, or null. */
  lastRateLimit(): RateLimitInfo | null {
    return this.lastRl;
  }

  /**
   * GET `{baseUrl}{path}` and return the unwrapped `response` field as T.
   * Throws on non-2xx (other than 429, which is retried).
   */
  async fetch<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;
    while (attempt < 5) {
      const res = await fetch(url, {
        headers: { 'x-apisports-key': this.apiKey },
      });
      this.lastRl = parseRateLimit(res.headers);
      if (res.ok) {
        const data = (await res.json()) as { response: T };
        return data.response;
      }
      if (res.status === 429) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 30_000);
        await new Promise((r) => setTimeout(r, wait));
        attempt++;
        continue;
      }
      throw new Error(`api-football ${res.status}: ${await res.text()}`);
    }
    throw new Error('rate-limit retries exhausted');
  }
}

function parseRateLimit(h: Headers): RateLimitInfo {
  return {
    limit: parseIntOrNull(h.get('x-ratelimit-requests-limit')),
    remaining: parseIntOrNull(h.get('x-ratelimit-requests-remaining')),
  };
}

function parseIntOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
