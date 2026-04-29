import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OddsApiClient } from '../api-client.js';

describe('OddsApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds correct URL for fetchEvents with sport+league+status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: makeHeaders({}),
      json: async () => [],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OddsApiClient({ apiKey: 'TESTKEY', baseUrl: 'https://api.example.io/v3' });
    await client.fetchEvents({ sport: 'football', league: 'italy-serie-a', status: 'pending' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/events');
    expect(url).toContain('sport=football');
    expect(url).toContain('league=italy-serie-a');
    expect(url).toContain('status=pending');
    expect(url).toContain('apiKey=TESTKEY');
  });

  it('returns parsed JSON array on success', async () => {
    const sample = [{ id: 1, home: 'A', away: 'B' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: makeHeaders({}),
      json: async () => sample,
    }));

    const client = new OddsApiClient({ apiKey: 'K', baseUrl: 'https://x.io/v3' });
    const events = await client.fetchEvents({ sport: 'football' });
    expect(events).toEqual(sample);
  });

  it('throws on non-2xx with error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: makeHeaders({}),
      json: async () => ({ error: 'You need to provide a valid apiKey' }),
    }));

    const client = new OddsApiClient({ apiKey: 'BAD', baseUrl: 'https://x.io/v3' });
    await expect(client.fetchEvents({ sport: 'football' })).rejects.toThrow(/401/);
  });

  it('fetchOdds builds URL with eventId and bookmakers comma-separated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: makeHeaders({}),
      json: async () => ({ id: 99, bookmakers: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OddsApiClient({ apiKey: 'K', baseUrl: 'https://x.io/v3' });
    await client.fetchOdds({ eventId: 99, bookmakers: ['Bet365', 'Snai IT'] });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/odds');
    expect(url).toContain('eventId=99');
    expect(decodeURIComponent(url)).toContain('bookmakers=Bet365,Snai IT');
  });

  it('records rate-limit headers when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: makeHeaders({
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4982',
        'x-ratelimit-reset': '2026-04-28T13:22:31Z',
      }),
      json: async () => [],
    }));

    const client = new OddsApiClient({ apiKey: 'K', baseUrl: 'https://x.io/v3' });
    await client.fetchEvents({ sport: 'football' });
    const last = client.lastRateLimit();
    expect(last?.remaining).toBe(4982);
    expect(last?.limit).toBe(5000);
    expect(last?.reset).toBe('2026-04-28T13:22:31Z');
  });
});

function makeHeaders(map: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(map)) h.set(k, v);
  return h;
}
