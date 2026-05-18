import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiFootballClient } from '../api-client.js';

describe('ApiFootballClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses rate-limit headers from response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'x-ratelimit-requests-limit': '7500',
        'x-ratelimit-requests-remaining': '7400',
      }),
      json: async () => ({ response: [] }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ApiFootballClient({ apiKey: 'test' });
    await client.fetch('/fixtures?live=all');

    expect(client.lastRateLimit()).toEqual({
      limit: 7500,
      remaining: 7400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://v3.football.api-sports.io/fixtures?live=all');
    expect((calledInit as RequestInit).headers).toMatchObject({
      'x-apisports-key': 'test',
    });
  });

  it('throws on 429 after backoff exhausted', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => 'rate limited',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new ApiFootballClient({ apiKey: 'test' });
    const promise = client.fetch('/fixtures?live=all');

    // Attach catch handler synchronously to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow(/rate-limit retries exhausted/);

    // Advance through backoffs: 2s, 4s, 8s, 16s, 30s (capped) between 5 attempts.
    // After 5 failed attempts loop exits and throws. We need to flush microtasks
    // and advance timers progressively.
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
