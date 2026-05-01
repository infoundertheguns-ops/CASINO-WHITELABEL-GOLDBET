import 'dotenv/config';
import { OddsApiClient } from './api-client.js';
import { Upserter } from './upsert.js';
import { runTier, type IngesterDeps, type TierOptions, type TierResult } from './ingest.js';
import { ENABLED_BOOKMAKERS } from './sports-config.js';
import { createRealtimePublisher } from './realtime-publisher.js';
import { getRedisClient } from './redis-client.js';

/**
 * Tier-based scheduler for odds-api.io ingestion.
 *
 * Each tier polls a different slice of events at its own cadence, balancing
 * freshness needs vs rate-limit budget (Pro tier: 5000 req/h):
 *
 *   live       — status='live'                 — 30s   — must be fresh, low volume
 *   imminent   — pending,    next 2h           — 2min  — about-to-start prematch
 *   mid        — pending,    2h-24h            — 10min — current-day prematch
 *   slow       — pending,    1d-7d             — 30min — week-ahead prematch
 *   discovery  — pending,    7d-14d            — 60min — far-future, find new events
 *
 * Each tier has its own setInterval and busy-flag — overlapping ticks of
 * the SAME tier are skipped, but tiers run in parallel.
 *
 * After each tier with status='live' or 'imminent', we trigger
 * derive_legacy_from_v2() so the player frontend sees fresh prices fast.
 * Mid/slow/discovery share a common derive call every 5 min via a
 * dedicated derive heartbeat (avoids redundant derives during heavy ticks).
 *
 * Budget calc (rough, with current ~7k pending + ~50 live):
 *   live:      50 events  / 10 = 5 calls @ 120/h = 600 req/h
 *   imminent:  500 events / 10 = 50 calls @ 30/h = 1500 req/h
 *   mid:       2000 events / 10 = 200 @ 6/h     = 1200 req/h
 *   slow:      4000 events / 10 = 400 @ 2/h     = 800 req/h
 *   discovery: 500 events / 10 = 50 @ 1/h       = 50 req/h
 *   /events list calls: 10 sports × 5 tiers × var = ~200 req/h
 *   TOTAL ~4350 req/h — fits 5000 budget.
 */

type TierName = 'live' | 'imminent' | 'mid' | 'slow' | 'discovery';

type TierConfig = {
  name: TierName;
  intervalMs: number;
  options: TierOptions;
  /** Trigger derive_legacy after this tier completes? */
  triggerDerive: boolean;
};

const tierConfigs: TierConfig[] = [
  {
    name: 'live',
    intervalMs: 30_000,
    options: { label: 'live', status: 'live', minHours: null, maxHours: null },
    triggerDerive: false,
  },
  {
    name: 'imminent',
    intervalMs: 120_000,
    options: { label: 'imm',  status: 'pending', minHours: 0,   maxHours: 2 },
    triggerDerive: false,
  },
  {
    name: 'mid',
    intervalMs: 600_000,
    options: { label: 'mid',  status: 'pending', minHours: 2,   maxHours: 24 },
    triggerDerive: false,
  },
  {
    name: 'slow',
    intervalMs: 1_800_000,
    options: { label: 'slow', status: 'pending', minHours: 24,  maxHours: 168 },
    triggerDerive: false,
  },
  {
    name: 'discovery',
    intervalMs: 3_600_000,
    options: { label: 'disc', status: 'pending', minHours: 168, maxHours: 21 * 24 },
    triggerDerive: false,
  },
];

/** Derive heartbeat: derive runs in its own dedicated loop independent of
 *  tiers. Runs every DERIVE_HEARTBEAT_MS regardless of which tier fired.
 *  Independent loop avoids two failure modes seen under tier-triggered
 *  derive: (a) blocking the tier's busy flag for 60s+ and missing tick
 *  windows, (b) lock contention with concurrent tier upsertBatch ops. */
const DERIVE_HEARTBEAT_MS = 300_000;

/** Stale-lives heartbeat: every 5 min, settle events_v2 rows that are still
 *  status='live' but past the safety threshold (default 6h after kickoff).
 *  Handles the case where odds-api stops returning an event we believed live. */
const STALE_LIVES_HEARTBEAT_MS = 300_000;

type TierState = {
  busy: boolean;
  lastRunMs: number;
  lastDurationMs: number;
  consecErrors: number;
};
const tierState = new Map<TierName, TierState>();

let shouldStop = false;
process.on('SIGTERM', () => { console.log('[scheduler] SIGTERM'); shouldStop = true; });
process.on('SIGINT',  () => { console.log('[scheduler] SIGINT');  shouldStop = true; });

async function tickTier(cfg: TierConfig, deps: IngesterDeps): Promise<void> {
  const state = tierState.get(cfg.name)!;
  if (state.busy) {
    console.warn(`[${cfg.name}] busy, skipping (last duration ${(state.lastDurationMs/1000).toFixed(1)}s)`);
    return;
  }
  state.busy = true;
  const t0 = Date.now();
  try {
    const result: TierResult = await runTier(deps, cfg.options);
    const dt = Date.now() - t0;
    state.lastDurationMs = dt;
    state.consecErrors = 0;
    state.lastRunMs = Date.now();

    const t = result.totals;
    console.log(
      `[${cfg.name}] ${(dt / 1000).toFixed(1)}s  ` +
      `listed=${t.events_listed} odds=${t.odds_fetched} err=${t.fetch_errors}  ` +
      `upserted ev=${t.events_upserted} mkt=${t.markets_upserted} out=${t.outcomes_upserted}`,
    );

  } catch (err) {
    state.consecErrors++;
    state.lastDurationMs = Date.now() - t0;
    console.error(`[${cfg.name}] FAILED (#${state.consecErrors}):`, (err as Error).message);
  } finally {
    state.busy = false;
  }
}

let deriveBusy = false;
async function runDerive(deps: IngesterDeps): Promise<void> {
  if (deriveBusy) {
    console.warn('[derive] busy, skipping');
    return;
  }
  deriveBusy = true;
  const t0 = Date.now();
  try {
    const { data, error } = await deps.upserter.callDeriveLegacy();
    const dt = Date.now() - t0;
    if (error) {
      console.warn(`[derive] failed: ${error.message}`);
    } else {
      console.log(`[derive] ${(dt / 1000).toFixed(1)}s ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.warn(`[derive] threw: ${(err as Error).message}`);
  } finally {
    deriveBusy = false;
  }
}

let staleBusy = false;
async function runMarkStaleLives(deps: IngesterDeps): Promise<void> {
  if (staleBusy) {
    console.warn('[stale-lives] busy, skipping');
    return;
  }
  staleBusy = true;
  const t0 = Date.now();
  try {
    const { data, error } = await deps.upserter.callMarkStaleLives();
    const dt = Date.now() - t0;
    if (error) {
      console.warn(`[stale-lives] failed: ${error.message}`);
    } else {
      console.log(`[stale-lives] ${(dt / 1000).toFixed(1)}s ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.warn(`[stale-lives] threw: ${(err as Error).message}`);
  } finally {
    staleBusy = false;
  }
}

async function main() {
  const apiKey = requireEnv('ODDS_API_KEY');
  const baseUrl = process.env.ODDS_API_BASE ?? 'https://api.odds-api.io/v3';
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRole = requireEnv('SUPABASE_SERVICE_ROLE');

  const redisClient = await getRedisClient();
  const publisher = createRealtimePublisher(redisClient);

  const deps: IngesterDeps = {
    client: new OddsApiClient({ apiKey, baseUrl }),
    upserter: new Upserter({ supabaseUrl, serviceRoleKey: serviceRole }),
    bookmakers: ENABLED_BOOKMAKERS,
    publisher,
  };

  console.log(`[scheduler] start tier-mode  bookmakers=${ENABLED_BOOKMAKERS.length}`);
  for (const cfg of tierConfigs) {
    tierState.set(cfg.name, { busy: false, lastRunMs: 0, lastDurationMs: 0, consecErrors: 0 });
    console.log(`[scheduler]   tier ${cfg.name.padEnd(10)} every ${(cfg.intervalMs/1000).toFixed(0)}s  ${cfg.options.status} ${cfg.options.minHours ?? '*'}h..${cfg.options.maxHours ?? '*'}h`);
  }

  // Stagger first run: live first (immediate), others offset by 5s each.
  for (let i = 0; i < tierConfigs.length; i++) {
    const cfg = tierConfigs[i];
    setTimeout(() => { void tickTier(cfg, deps); }, i * 5000);
    setInterval(() => { if (!shouldStop) void tickTier(cfg, deps); }, cfg.intervalMs);
  }

  // Independent derive loop — runs every DERIVE_HEARTBEAT_MS, never blocked
  // by tier ticks. First fire after 10s so tiers have data to derive from.
  setTimeout(() => { void runDerive(deps); }, 10_000);
  setInterval(() => { if (!shouldStop) void runDerive(deps); }, DERIVE_HEARTBEAT_MS);

  // Stale-lives loop — runs every STALE_LIVES_HEARTBEAT_MS. First fire after
  // 60s to avoid colliding with the initial derive burst.
  setTimeout(() => { void runMarkStaleLives(deps); }, 60_000);
  setInterval(() => { if (!shouldStop) void runMarkStaleLives(deps); }, STALE_LIVES_HEARTBEAT_MS);

  // Keep process alive
  while (!shouldStop) {
    await sleep(1000);
  }

  console.log('[scheduler] stopping...');
  // Wait for any busy tier to finish (max 30s)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && Array.from(tierState.values()).some(s => s.busy)) {
    await sleep(500);
  }
  console.log('[scheduler] stopped');
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

void main().catch(err => { console.error('[scheduler] FATAL', err); process.exit(1); });
