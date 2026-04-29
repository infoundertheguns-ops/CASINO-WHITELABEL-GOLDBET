import type { ApiEvent } from './types.js';

export type ClientConfig = {
  apiKey: string;
  baseUrl: string;
  /** TTL for /events list cache in ms. Default 60_000 (60s). 0 = disabled. */
  eventsCacheTtlMs?: number;
};

export type RateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  reset: string | null;
};

export type FetchEventsParams = {
  sport: string;
  league?: string;
  status?: 'pending' | 'live' | 'settled';
};

export type FetchOddsParams = {
  eventId: number;
  bookmakers: string[];
};

export type FetchOddsMultiParams = {
  eventIds: number[];        // max 10 per API contract
  bookmakers: string[];
};

type CacheEntry = { data: ApiEvent[]; expiresAt: number };

export class OddsApiClient {
  private apiKey: string;
  private baseUrl: string;
  private lastRl: RateLimitInfo | null = null;
  private eventsCacheTtlMs: number;
  private eventsCache = new Map<string, CacheEntry>();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(cfg: ClientConfig) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.eventsCacheTtlMs = cfg.eventsCacheTtlMs ?? 60_000;
  }

  lastRateLimit(): RateLimitInfo | null {
    return this.lastRl;
  }

  /** Returns { hits, misses } for the /events cache since process start. */
  cacheStats(): { hits: number; misses: number } {
    return { hits: this.cacheHits, misses: this.cacheMisses };
  }

  async fetchEvents(params: FetchEventsParams): Promise<ApiEvent[]> {
    // Cache key includes sport, status, league; cached because the same
    // /events list is requested by every tier (live, imminent, mid, slow,
    // discovery) at different cadences. Without the cache, the live tier
    // (30s interval) and imminent tier (120s) call the same /events endpoint
    // 30+30=60 times per hour per sport. With a 60s TTL most live calls hit
    // the cache, halving /events list cost.
    if (this.eventsCacheTtlMs > 0) {
      const key = `${params.sport}:${params.status ?? '*'}:${params.league ?? '*'}`;
      const now = Date.now();
      const cached = this.eventsCache.get(key);
      if (cached && cached.expiresAt > now) {
        this.cacheHits++;
        return cached.data;
      }
      this.cacheMisses++;
      const url = this.buildUrl('/events', { ...params, apiKey: this.apiKey });
      const data = await this.get<ApiEvent[]>(url);
      this.eventsCache.set(key, { data, expiresAt: now + this.eventsCacheTtlMs });
      return data;
    }
    const url = this.buildUrl('/events', { ...params, apiKey: this.apiKey });
    return this.get<ApiEvent[]>(url);
  }

  async fetchOdds(params: FetchOddsParams): Promise<ApiEvent> {
    const url = this.buildUrl('/odds', {
      eventId: String(params.eventId),
      bookmakers: params.bookmakers.join(','),
      apiKey: this.apiKey,
    });
    return this.get<ApiEvent>(url);
  }

  /**
   * Bulk fetch odds for up to 10 events in a single API call.
   * Caller is responsible for chunking eventIds into groups of <=10.
   */
  async fetchOddsMulti(params: FetchOddsMultiParams): Promise<ApiEvent[]> {
    if (params.eventIds.length === 0) return [];
    if (params.eventIds.length > 10) {
      throw new Error(`fetchOddsMulti: max 10 eventIds per call, got ${params.eventIds.length}`);
    }
    const url = this.buildUrl('/odds/multi', {
      eventIds: params.eventIds.join(','),
      bookmakers: params.bookmakers.join(','),
      apiKey: this.apiKey,
    });
    return this.get<ApiEvent[]>(url);
  }

  private buildUrl(path: string, params: Record<string, string | undefined>): string {
    const qs = Object.entries(params)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${this.baseUrl}${path}${qs ? '?' + qs : ''}`;
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url);
    this.lastRl = readRateLimit(res.headers);
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status} on ${url} — body=${JSON.stringify(body)}`);
    }
    return res.json() as Promise<T>;
  }
}

function readRateLimit(headers: Headers): RateLimitInfo {
  const num = (s: string | null) => (s == null ? null : Number(s));
  return {
    limit: num(headers.get('x-ratelimit-limit')),
    remaining: num(headers.get('x-ratelimit-remaining')),
    reset: headers.get('x-ratelimit-reset'),
  };
}
