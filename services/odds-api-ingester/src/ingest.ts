import 'dotenv/config';
import { OddsApiClient } from './api-client.js';
import { transformEvent } from './transformer.js';
import { Upserter } from './upsert.js';
import {
  ENABLED_SPORTS,
  ENABLED_BOOKMAKERS,
  MAX_EVENTS_PER_SPORT_PER_TICK,
  type SportConfig,
} from './sports-config.js';
import type { ApiEvent, TransformResult } from './types.js';

/**
 * Multi-sport ingester. Tier-aware: a "tier" is a slice of events filtered
 * by status (pending/live) and time window (e.g. live, imminent, mid, slow,
 * discovery). Each tier is invoked at its own cadence by the scheduler.
 *
 * Single tier tick:
 *   1) For each enabled sport: list events from odds-api with given status
 *   2) Filter by time window
 *   3) Cap by per-sport quota
 *   4) Bulk fetch odds for all events
 *   5) Upsert to events_v2 / markets_v2 / outcomes_v2
 */

export type TierStatus = 'pending' | 'live';

export type TierOptions = {
  /** Tier label for logging (e.g. 'live', 'imminent') */
  label: string;
  /** odds-api status filter */
  status: TierStatus;
  /** Min hours from now (inclusive). null = no lower bound */
  minHours: number | null;
  /** Max hours from now (inclusive). null = no upper bound */
  maxHours: number | null;
  /** Per-sport cap. Defaults to MAX_EVENTS_PER_SPORT_PER_TICK */
  maxEventsPerSport?: number;
};

export type IngestSummary = {
  tier: string;
  sport_slug: string;
  events_listed: number;
  odds_fetched: number;
  fetch_errors: number;
  events_upserted: number;
  markets_upserted: number;
  outcomes_upserted: number;
  duration_ms: number;
  rate_limit_remaining: number | null;
};

export type IngesterDeps = {
  client: OddsApiClient;
  upserter: Upserter;
  bookmakers: string[];
};

export type TierResult = {
  tier: string;
  perSport: IngestSummary[];
  totals: {
    events_listed: number;
    odds_fetched: number;
    fetch_errors: number;
    events_upserted: number;
    markets_upserted: number;
    outcomes_upserted: number;
    duration_ms: number;
  };
};

/**
 * Run one tier across all enabled sports.
 */
export async function runTier(
  deps: IngesterDeps,
  opts: TierOptions,
): Promise<TierResult> {
  const t0 = Date.now();
  const perSport: IngestSummary[] = [];
  for (const sport of ENABLED_SPORTS) {
    const summary = await ingestOneSport(sport, deps, opts);
    perSport.push(summary);
  }
  const totals = perSport.reduce(
    (a, s) => ({
      events_listed: a.events_listed + s.events_listed,
      odds_fetched: a.odds_fetched + s.odds_fetched,
      fetch_errors: a.fetch_errors + s.fetch_errors,
      events_upserted: a.events_upserted + s.events_upserted,
      markets_upserted: a.markets_upserted + s.markets_upserted,
      outcomes_upserted: a.outcomes_upserted + s.outcomes_upserted,
      duration_ms: 0,
    }),
    {
      events_listed: 0, odds_fetched: 0, fetch_errors: 0,
      events_upserted: 0, markets_upserted: 0, outcomes_upserted: 0,
      duration_ms: 0,
    },
  );
  totals.duration_ms = Date.now() - t0;
  return { tier: opts.label, perSport, totals };
}

/**
 * Backwards compat: full pending pass (legacy callers).
 */
export async function runIngestion(deps: IngesterDeps): Promise<IngestSummary[]> {
  const r = await runTier(deps, {
    label: 'full',
    status: 'pending',
    minHours: null,
    maxHours: 14 * 24,
  });
  return r.perSport;
}

export async function ingestOneSport(
  sport: SportConfig,
  deps: IngesterDeps,
  opts: TierOptions,
): Promise<IngestSummary> {
  const t0 = Date.now();
  const summary: IngestSummary = {
    tier: opts.label,
    sport_slug: sport.slug,
    events_listed: 0,
    odds_fetched: 0,
    fetch_errors: 0,
    events_upserted: 0,
    markets_upserted: 0,
    outcomes_upserted: 0,
    duration_ms: 0,
    rate_limit_remaining: null,
  };

  // 1) List events for sport with given status.
  let events: ApiEvent[];
  try {
    events = await deps.client.fetchEvents({ sport: sport.slug, status: opts.status });
    summary.events_listed = events.length;
  } catch (err) {
    console.warn(`[${opts.label}/${sport.slug}] /events failed:`, (err as Error).message);
    summary.duration_ms = Date.now() - t0;
    return summary;
  }

  // Optional league whitelist (from sport config)
  if (sport.leagues && sport.leagues.length > 0) {
    const allow = new Set(sport.leagues);
    events = events.filter(e => allow.has(e.league.slug));
  }

  // Time window filter (only for status='pending').
  // Live events: no time filter — every live event is interesting regardless of start time.
  if (opts.status === 'pending') {
    const now = Date.now();
    if (opts.minHours !== null) {
      const minTs = now + opts.minHours * 3600_000;
      events = events.filter(e => new Date(e.date).getTime() >= minTs);
    }
    if (opts.maxHours !== null) {
      const maxTs = now + opts.maxHours * 3600_000;
      events = events.filter(e => new Date(e.date).getTime() <= maxTs);
    }
  }

  // Sort by date ascending (imminent first), cap.
  events.sort((a, b) => a.date.localeCompare(b.date));
  const cap = opts.maxEventsPerSport ?? MAX_EVENTS_PER_SPORT_PER_TICK;
  if (events.length > cap) {
    events = events.slice(0, cap);
  }

  if (events.length === 0) {
    summary.duration_ms = Date.now() - t0;
    return summary;
  }

  // 2) Bulk fetch odds in chunks of 10 (per /odds/multi contract).
  const results: TransformResult[] = [];
  const CHUNK = 10;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    try {
      const enrichedList = await deps.client.fetchOddsMulti({
        eventIds: chunk.map(e => e.id),
        bookmakers: deps.bookmakers,
      });
      for (const enriched of enrichedList) {
        results.push(transformEvent(enriched));
        summary.odds_fetched++;
      }
    } catch {
      summary.fetch_errors += chunk.length;
    }
  }
  summary.rate_limit_remaining = deps.client.lastRateLimit()?.remaining ?? null;

  // 3) Upsert in single batch per sport.
  if (results.length > 0) {
    try {
      const upsertSummary = await deps.upserter.upsertBatch(results);
      summary.events_upserted = upsertSummary.events_upserted;
      summary.markets_upserted = upsertSummary.markets_upserted;
      summary.outcomes_upserted = upsertSummary.outcomes_upserted;
    } catch (err) {
      console.error(`[${opts.label}/${sport.slug}] upsert failed:`, (err as Error).message);
    }
  }

  summary.duration_ms = Date.now() - t0;
  return summary;
}

export function formatSummary(s: IngestSummary): string {
  const dt = (s.duration_ms / 1000).toFixed(1);
  return (
    `[${s.tier}/${s.sport_slug}] ${dt}s  ` +
    `events=${s.events_listed}  ` +
    `odds=${s.odds_fetched}/${s.events_listed} (${s.fetch_errors} err)  ` +
    `upserted ev=${s.events_upserted} mkt=${s.markets_upserted} out=${s.outcomes_upserted}  ` +
    `rl_rem=${s.rate_limit_remaining ?? '-'}`
  );
}

// One-shot CLI entry: `tsx src/ingest.ts`
async function main() {
  const apiKey = requireEnv('ODDS_API_KEY');
  const baseUrl = process.env.ODDS_API_BASE ?? 'https://api.odds-api.io/v3';
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRole = requireEnv('SUPABASE_SERVICE_ROLE');

  const deps: IngesterDeps = {
    client: new OddsApiClient({ apiKey, baseUrl }),
    upserter: new Upserter({ supabaseUrl, serviceRoleKey: serviceRole }),
    bookmakers: ENABLED_BOOKMAKERS,
  };

  const t0 = Date.now();
  console.log(`[ingest] one-shot pending pass`);
  console.log(`[ingest] bookmakers (${ENABLED_BOOKMAKERS.length}):`, ENABLED_BOOKMAKERS.join(', '));
  const summaries = await runIngestion(deps);
  for (const s of summaries) console.log(formatSummary(s));
  const totalEv = summaries.reduce((a, s) => a + s.events_upserted, 0);
  const totalMkt = summaries.reduce((a, s) => a + s.markets_upserted, 0);
  const totalOut = summaries.reduce((a, s) => a + s.outcomes_upserted, 0);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[ingest] DONE ${dt}s  events=${totalEv}  markets=${totalMkt}  outcomes=${totalOut}`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch(err => { console.error('[ingest] FATAL', err); process.exit(1); });
}
