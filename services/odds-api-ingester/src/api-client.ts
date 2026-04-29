import type { ApiEvent } from './types.js';

export type ClientConfig = {
  apiKey: string;
  baseUrl: string;
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

export class OddsApiClient {
  private apiKey: string;
  private baseUrl: string;
  private lastRl: RateLimitInfo | null = null;

  constructor(cfg: ClientConfig) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
  }

  lastRateLimit(): RateLimitInfo | null {
    return this.lastRl;
  }

  async fetchEvents(params: FetchEventsParams): Promise<ApiEvent[]> {
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
