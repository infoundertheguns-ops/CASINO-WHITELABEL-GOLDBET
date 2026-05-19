import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, FlagCache } from '../config.js';
import type { Pool } from 'pg';

describe('loadConfig', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    // Wipe the 4 vars + 2 overrides so each test starts clean.
    delete process.env.API_FOOTBALL_KEY;
    delete process.env.SCRAPER_API_KEY;
    delete process.env.API_FOOTBALL_STATS_ENDPOINT;
    delete process.env.DATABASE_URL;
    delete process.env.API_FOOTBALL_TICK_INTERVAL_MS;
    delete process.env.API_FOOTBALL_FLAG_CACHE_TTL_MS;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('reads all 4 required env vars and applies defaults', () => {
    process.env.API_FOOTBALL_KEY = 'af-key';
    process.env.SCRAPER_API_KEY = 'scraper-key';
    process.env.API_FOOTBALL_STATS_ENDPOINT = 'http://admin:3000/api/admin/api-football/stats';
    process.env.DATABASE_URL = 'postgres://localhost/test';

    const cfg = loadConfig();
    expect(cfg.apiKey).toBe('af-key');
    expect(cfg.scraperKey).toBe('scraper-key');
    expect(cfg.statsEndpoint).toBe('http://admin:3000/api/admin/api-football/stats');
    expect(cfg.dbUrl).toBe('postgres://localhost/test');
    // Defaults
    expect(cfg.tickIntervalMs).toBe(30_000);
    expect(cfg.flagCacheTtlMs).toBe(10_000);
  });

  it('throws when API_FOOTBALL_KEY is missing', () => {
    process.env.SCRAPER_API_KEY = 'x';
    process.env.API_FOOTBALL_STATS_ENDPOINT = 'x';
    process.env.DATABASE_URL = 'x';
    expect(() => loadConfig()).toThrow(/API_FOOTBALL_KEY/);
  });

  it('throws when SCRAPER_API_KEY is missing', () => {
    process.env.API_FOOTBALL_KEY = 'x';
    process.env.API_FOOTBALL_STATS_ENDPOINT = 'x';
    process.env.DATABASE_URL = 'x';
    expect(() => loadConfig()).toThrow(/SCRAPER_API_KEY/);
  });

  it('respects env override for tickIntervalMs and flagCacheTtlMs', () => {
    process.env.API_FOOTBALL_KEY = 'x';
    process.env.SCRAPER_API_KEY = 'x';
    process.env.API_FOOTBALL_STATS_ENDPOINT = 'x';
    process.env.DATABASE_URL = 'x';
    process.env.API_FOOTBALL_TICK_INTERVAL_MS = '15000';
    process.env.API_FOOTBALL_FLAG_CACHE_TTL_MS = '5000';

    const cfg = loadConfig();
    expect(cfg.tickIntervalMs).toBe(15_000);
    expect(cfg.flagCacheTtlMs).toBe(5_000);
  });
});

describe('FlagCache', () => {
  function mockPool(rowsByKey: Record<string, unknown>): Pool {
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      const key = params[0] as string;
      if (key in rowsByKey) return { rows: [{ key, value: rowsByKey[key] }] };
      return { rows: [] };
    });
    return { query } as unknown as Pool;
  }

  it('getFlag first call queries DB; second call within TTL uses cache (1 query total)', async () => {
    const pool = mockPool({ FOO: true });
    const cache = new FlagCache(pool, 10_000);

    const v1 = await cache.getFlag('FOO', 1_000);
    const v2 = await cache.getFlag('FOO', 1_500);
    expect(v1).toBe(true);
    expect(v2).toBe(true);
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('getFlag after TTL elapsed re-queries DB', async () => {
    const pool = mockPool({ FOO: true });
    const cache = new FlagCache(pool, 10_000);

    await cache.getFlag('FOO', 1_000);
    await cache.getFlag('FOO', 12_000); // 11s later, TTL elapsed
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('getFlag returns false for unknown key (no DB row)', async () => {
    const pool = mockPool({});
    const cache = new FlagCache(pool, 10_000);
    const v = await cache.getFlag('MISSING', 0);
    expect(v).toBe(false);
  });

  it('getFlag coerces string "true" jsonb value to boolean true', async () => {
    const pool = mockPool({ FOO: 'true' });
    const cache = new FlagCache(pool, 10_000);
    const v = await cache.getFlag('FOO', 0);
    expect(v).toBe(true);
  });

  it('invalidate() clears the cache so the next call re-queries', async () => {
    const pool = mockPool({ FOO: true });
    const cache = new FlagCache(pool, 10_000);

    await cache.getFlag('FOO', 1_000);
    cache.invalidate();
    await cache.getFlag('FOO', 1_500);
    expect((pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
