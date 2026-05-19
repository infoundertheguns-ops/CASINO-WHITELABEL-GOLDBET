/**
 * Service configuration + flag cache for the api-football scheduler (M1.14).
 *
 * Two surfaces:
 *   1. `loadConfig()` — synchronous env-var reader. Throws on missing
 *      required vars so the process exits early on misconfig (fail-fast).
 *      Defaults for tick interval and flag TTL are baked here so the
 *      scheduler stays focused on orchestration.
 *
 *   2. `FlagCache` — TTL-cached reader for `system_config` boolean
 *      flags. Reads stay cheap (avoid hammering Postgres every tick) and
 *      flag flips propagate within the TTL window without a restart.
 *
 * Env var contract:
 *   API_FOOTBALL_KEY            (required) — api-sports.io key
 *   SCRAPER_API_KEY             (required) — shared secret for admin stats route
 *                                            (codebase-consistent; NOT 'SCRAPER_INGEST_KEY')
 *   API_FOOTBALL_STATS_ENDPOINT (required) — full URL of stats POST route
 *   DATABASE_URL                (required) — postgres connection string
 *   API_FOOTBALL_TICK_INTERVAL_MS (optional, default 30_000)
 *   API_FOOTBALL_FLAG_CACHE_TTL_MS (optional, default 10_000)
 *
 * No dotenv loading here — the entry point (`scheduler.ts`) calls
 * `dotenv/config` once on startup; this module is a pure reader.
 */
import type { Pool } from 'pg';

export interface ServiceConfig {
  apiKey: string;
  scraperKey: string;
  statsEndpoint: string;
  dbUrl: string;
  tickIntervalMs: number;
  flagCacheTtlMs: number;
}

const DEFAULT_TICK_INTERVAL_MS = 30_000;
const DEFAULT_FLAG_CACHE_TTL_MS = 10_000;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(): ServiceConfig {
  return {
    apiKey: requireEnv('API_FOOTBALL_KEY'),
    scraperKey: requireEnv('SCRAPER_API_KEY'),
    statsEndpoint: requireEnv('API_FOOTBALL_STATS_ENDPOINT'),
    dbUrl: requireEnv('DATABASE_URL'),
    tickIntervalMs: intEnv('API_FOOTBALL_TICK_INTERVAL_MS', DEFAULT_TICK_INTERVAL_MS),
    flagCacheTtlMs: intEnv('API_FOOTBALL_FLAG_CACHE_TTL_MS', DEFAULT_FLAG_CACHE_TTL_MS),
  };
}

interface CacheEntry {
  value: boolean;
  fetchedAtMs: number;
}

/**
 * TTL-cached reader for boolean flags in `system_config`.
 *
 * The api-football scheduler reads flags every tick (callEnabled +
 * writeEnabled). Without caching that would be ~2 queries per tick;
 * with TTL=10s and tick=30s the cache hit rate is ~0% in steady state
 * — but the cache earns its keep when multiple call sites (pollers,
 * mapping resolver) read flags within the same tick.
 *
 * Coercion: `system_config.value` is JSONB. Both the JSON boolean
 * `true` and the JSON string `"true"` are accepted; anything else
 * (or a missing row) returns false. This matches the existing tooling
 * conventions used by admin routes.
 */
export class FlagCache {
  private pool: Pool;
  private ttlMs: number;
  private cache = new Map<string, CacheEntry>();

  constructor(pool: Pool, ttlMs: number = DEFAULT_FLAG_CACHE_TTL_MS) {
    this.pool = pool;
    this.ttlMs = ttlMs;
  }

  async getFlag(key: string, nowMs: number = Date.now()): Promise<boolean> {
    const cached = this.cache.get(key);
    if (cached && nowMs - cached.fetchedAtMs < this.ttlMs) {
      return cached.value;
    }
    const { rows } = await this.pool.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM system_config WHERE key = $1',
      [key],
    );
    const raw = rows.length > 0 ? rows[0].value : undefined;
    const value = raw === true || raw === 'true';
    this.cache.set(key, { value, fetchedAtMs: nowMs });
    return value;
  }

  /** Force refresh on the next `getFlag` call. Test-only utility. */
  invalidate(): void {
    this.cache.clear();
  }
}
