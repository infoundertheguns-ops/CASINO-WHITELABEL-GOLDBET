import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatsBuffer, publishStats } from '../stats-publisher.js';

describe('StatsBuffer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startCycle then finishCycle returns empty counts and positive duration', () => {
    const buf = new StatsBuffer();
    buf.startCycle(1_000);
    const stats = buf.finishCycle(1_500);
    expect(stats.cycleDurationMs).toBe(500);
    expect(stats.endpointCalls).toEqual({});
    expect(stats.errors).toEqual({});
    expect(stats.rateLimitRemaining).toBeNull();
    expect(stats.cycleStartedAt).toBe(new Date(1_000).toISOString());
  });

  it('recordCall increments endpointCalls map', () => {
    const buf = new StatsBuffer();
    buf.startCycle(0);
    buf.recordCall('/fixtures?live=all');
    const stats = buf.finishCycle(100);
    expect(stats.endpointCalls).toEqual({ '/fixtures?live=all': 1 });
  });

  it('recordCall twice on same endpoint yields count 2', () => {
    const buf = new StatsBuffer();
    buf.startCycle(0);
    buf.recordCall('/fixtures?live=all');
    buf.recordCall('/fixtures?live=all');
    const stats = buf.finishCycle(100);
    expect(stats.endpointCalls['/fixtures?live=all']).toBe(2);
  });

  it('recordError increments errors map independently of calls', () => {
    const buf = new StatsBuffer();
    buf.startCycle(0);
    buf.recordCall('/fixtures?live=all');
    buf.recordError('/fixtures?live=all');
    buf.recordError('/fixtures?live=all');
    const stats = buf.finishCycle(100);
    expect(stats.endpointCalls['/fixtures?live=all']).toBe(1);
    expect(stats.errors['/fixtures?live=all']).toBe(2);
  });

  it('setRateLimitRemaining reflected in CycleStats', () => {
    const buf = new StatsBuffer();
    buf.startCycle(0);
    buf.setRateLimitRemaining(15);
    const stats = buf.finishCycle(100);
    expect(stats.rateLimitRemaining).toBe(15);
  });

  it('finishCycle clears buffer; subsequent finishCycle returns zero counts', () => {
    const buf = new StatsBuffer();
    buf.startCycle(0);
    buf.recordCall('/fixtures?live=all');
    buf.recordError('/fixtures?live=all');
    buf.setRateLimitRemaining(42);
    const first = buf.finishCycle(100);
    expect(first.endpointCalls['/fixtures?live=all']).toBe(1);
    expect(first.errors['/fixtures?live=all']).toBe(1);
    expect(first.rateLimitRemaining).toBe(42);

    buf.startCycle(200);
    const second = buf.finishCycle(250);
    expect(second.endpointCalls).toEqual({});
    expect(second.errors).toEqual({});
    expect(second.rateLimitRemaining).toBeNull();
    expect(second.cycleDurationMs).toBe(50);
  });
});

describe('publishStats', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: 200 OK returns {ok:true}, sends x-scraper-key header and JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ok":true,"stored":1}',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const stats = {
      cycleStartedAt: new Date(1_000).toISOString(),
      cycleDurationMs: 500,
      endpointCalls: { '/fixtures?live=all': 3 },
      errors: {},
      rateLimitRemaining: 7400,
    };
    const result = await publishStats(
      { endpoint: 'https://admin.example.com/api/admin/api-football/stats', scraperKey: 'secret' },
      stats,
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admin.example.com/api/admin/api-football/stats');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-scraper-key']).toBe('secret');
    expect(headers['content-type']).toMatch(/application\/json/i);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(stats);
  });

  it('non-2xx response returns {ok:false, error}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await publishStats(
      { endpoint: 'https://admin.example.com/api/admin/api-football/stats', scraperKey: 'bad' },
      {
        cycleStartedAt: new Date(0).toISOString(),
        cycleDurationMs: 100,
        endpointCalls: {},
        errors: {},
        rateLimitRemaining: null,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });

  it('network error: fetch throws → returns {ok:false} and does not propagate', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let didThrow = false;
    let result: { ok: boolean; error?: string } | undefined;
    try {
      result = await publishStats(
        { endpoint: 'https://admin.example.com/api/admin/api-football/stats', scraperKey: 'k' },
        {
          cycleStartedAt: new Date(0).toISOString(),
          cycleDurationMs: 100,
          endpointCalls: {},
          errors: {},
          rateLimitRemaining: null,
        },
      );
    } catch {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(result?.ok).toBe(false);
    expect(result?.error).toMatch(/ECONNREFUSED/);
  });
});
