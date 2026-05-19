/**
 * Entry point + orchestrator for the api-football live ingester (M1.14).
 *
 * One-tick algorithm (see spec §3.4 + plan amendments):
 *
 *   1. Read system_config flags via FlagCache:
 *        - API_FOOTBALL_CALL_ENABLED (mig 188) gates ALL outbound calls.
 *          When false the scheduler is dormant — no discovery, no pollers,
 *          no stats publish. This is the "kill switch" for incident response.
 *        - API_FOOTBALL_WRITE_ENABLED (mig 186) gates persistence writes.
 *          When false the API still fires (dry-run mode); pollers + writers
 *          return `{written:false}` and the scheduler reflects that in
 *          TickResult.writeEnabled. This is the M1 rollout default.
 *      Cascade: callEnabled=false short-circuits before reading writeEnabled
 *      so a fully-off ingester makes ZERO database calls per tick.
 *
 *   2. Begin a stats cycle (StatsBuffer.startCycle).
 *
 *   3. Discovery: GET /fixtures?live=all. Record the call. On error,
 *      record the error and bail out of this tick (publish stats anyway
 *      so observability still sees the cycle).
 *
 *   4. For each fixture: resolve `eventId` (injected resolver, see
 *      MAPPING RESOLUTION below). Fixtures with no resolved id are
 *      logged-and-skipped — they typically mean the mapping table
 *      doesn't have a confidence>=0.5 row for this fixture yet. The
 *      M1.10 discovery loop (run on its own cadence) populates the table.
 *
 *   5. For each resolved fixture, ALWAYS call persistTimerAndScore
 *      (idempotent score+minute+period update). Then ask
 *      shouldFetchEvents(state, fixture, nowMs) whether to pull events:
 *        - score-delta -> yes, current cycle
 *        - card-poll TTL -> yes
 *        - otherwise -> no
 *      If we poll events: invoke pollEvents, record the call. On success,
 *      advance state (setLastScore + setEventsFetchAt). On failure, record
 *      the error and leave state untouched so the next tick re-attempts.
 *
 *   6. Prune stale fixtures (those no longer in /fixtures?live=all).
 *
 *   7. Capture the most recent rate-limit remaining via client.lastRateLimit()
 *      and finishCycle. publishStats best-effort (failures are swallowed
 *      so observability glitches never break the tick).
 *
 * MAPPING RESOLUTION:
 *   The scheduler is given a `eventIdResolver(fixtureId): Promise<string|null>`
 *   dependency. The production wiring (out of scope for this file)
 *   queries `external_id_mapping` for an existing `confidence>=0.5` row.
 *   The fuzzy-match flow that POPULATES that table — `resolveMapping`
 *   from mapping.ts — runs in the M1.10 discovery cycle on its own
 *   cadence (every N minutes against `/fixtures?date=YYYY-MM-DD`), NOT
 *   inside this tick. Doing the fuzzy match per tick would explode
 *   the request budget for the live `/fixtures?live=all` cohort.
 *
 * SIGTERM/SIGINT: handled in `run()` via a single `shouldStop` flag.
 * The current tick completes (best effort), the sleep is short-circuited,
 * and the loop exits cleanly. No drain queue — pollers run sequentially
 * within a tick, so finishing the in-flight tick is the drain.
 *
 * M2 TODOs (NOT in M1.14 baseline):
 *   - Statistics 5min cadence per fixture
 *   - Lineups on-substitution (needs event watcher state)
 *   - Players HT/FT snapshots (needs status transition detection in FixtureState)
 *   - Prematch h2h (T-24h) + predictions (T-2h) — separate cron-like loop
 *   - Cold-start surge stagger when discoveredCount > 30 (jitter pollers)
 *   - Reason tagging in stats (`endpoint_reasons` extension)
 *   - LiveDataAfKey runtime allowlist hardening (M1.12 quality NTH)
 */
import { Pool } from 'pg';
import { ApiFootballClient } from './api-client.js';
import { FixtureState } from './state.js';
import { shouldFetchEvents } from './discovery.js';
import { persistTimerAndScore, type PersistenceDb } from './persistence.js';
import { pollEvents } from './enrichment.js';
import { StatsBuffer, publishStats as defaultPublishStats, type CycleStats } from './stats-publisher.js';
import { FlagCache, loadConfig, type ServiceConfig } from './config.js';
import type { AFFixture } from './types.js';

const DISCOVERY_PATH = '/fixtures?live=all';
const EVENTS_PATH = '/fixtures/events';

export interface TickResult {
  callEnabled: boolean;
  writeEnabled: boolean;
  discoveredCount: number;
  eventsPolledCount: number;
  prunedCount: number;
}

export interface SchedulerDeps {
  client: ApiFootballClient;
  db: PersistenceDb;
  flagCache: FlagCache;
  statsBuffer: StatsBuffer;
  /** Resolves a fixture.id to an events_v2 UUID, or null if no mapping exists. */
  eventIdResolver: (fixtureId: number) => Promise<string | null>;
  /** Best-effort cycle stats publisher; failures swallowed by scheduler. */
  publishStats: (stats: CycleStats) => Promise<void>;
  /** Loop interval — ignored by tick(), used by run(). */
  tickIntervalMs: number;
}

export class Scheduler {
  private state = new FixtureState();
  private deps: SchedulerDeps;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  /**
   * Test-only state hook: seeds lastScore + lastEventsFetchAt for a fixture
   * so `shouldFetchEvents` decision branches can be exercised without
   * running a prior real tick.
   */
  primeState(fixtureId: number, score: { home: number; away: number }, ts: number): void {
    this.state.setLastScore(fixtureId, score);
    this.state.setEventsFetchAt(fixtureId, ts);
  }

  /**
   * Test-only state inspector. Returns shallow copies of the internal
   * Maps so a test can assert on entries without poking class internals.
   */
  getStateSnapshot(): {
    lastScore: Map<number, { home: number; away: number }>;
    lastEventsFetchAt: Map<number, number>;
  } {
    const lastScore = new Map<number, { home: number; away: number }>();
    const lastEventsFetchAt = new Map<number, number>();
    // We rebuild from the state's accessors so changes to FixtureState
    // internals don't bleed into tests.
    // Use a Symbol-keyed escape hatch? No — just iterate fixture ids we know.
    // Simpler: cast through unknown to the private maps. Acceptable for a
    // test helper colocated with the orchestrator.
    const internal = this.state as unknown as {
      lastSeenScores: Map<number, { home: number; away: number }>;
      lastEventsFetchAt: Map<number, number>;
    };
    for (const [k, v] of internal.lastSeenScores) lastScore.set(k, v);
    for (const [k, v] of internal.lastEventsFetchAt) lastEventsFetchAt.set(k, v);
    return { lastScore, lastEventsFetchAt };
  }

  async tick(nowMs: number = Date.now()): Promise<TickResult> {
    const { client, db, flagCache, statsBuffer, eventIdResolver, publishStats } = this.deps;

    // 1. Flag gate — read BOTH flags up front. callEnabled short-circuits.
    const callEnabled = await flagCache.getFlag('API_FOOTBALL_CALL_ENABLED', nowMs);
    if (!callEnabled) {
      return { callEnabled: false, writeEnabled: false, discoveredCount: 0, eventsPolledCount: 0, prunedCount: 0 };
    }
    const writeEnabled = await flagCache.getFlag('API_FOOTBALL_WRITE_ENABLED', nowMs);

    // 2. Begin stats cycle.
    statsBuffer.startCycle(nowMs);

    // 3. Discovery.
    let liveFixtures: AFFixture[] = [];
    try {
      liveFixtures = await client.fetch<AFFixture[]>(DISCOVERY_PATH);
      statsBuffer.recordCall(DISCOVERY_PATH);
    } catch (err) {
      statsBuffer.recordCall(DISCOVERY_PATH);
      statsBuffer.recordError(DISCOVERY_PATH);
      // Discovery failure -> still publish stats (so the cycle is observable)
      // and return an empty TickResult. Pollers can't run without a fixture list.
      void err; // logged upstream via client.fetch throw path
      return await this.finishAndPublish(statsBuffer, publishStats, client, {
        callEnabled,
        writeEnabled,
        discoveredCount: 0,
        eventsPolledCount: 0,
        prunedCount: 0,
      });
    }

    const activeIds = new Set<number>(liveFixtures.map((f) => f.fixture.id));
    let eventsPolledCount = 0;

    // 4-5. Per-fixture orchestration.
    for (const fixture of liveFixtures) {
      const fixtureId = fixture.fixture.id;
      const eventId = await eventIdResolver(fixtureId);
      if (!eventId) {
        // No mapping resolved — skip (M1.10 discovery loop is responsible
        // for populating external_id_mapping). Not counted as an error.
        continue;
      }

      // Always-do: timer+score idempotent write. Flag-gated internally.
      await persistTimerAndScore(db, eventId, fixture, { writeEnabled });

      // Decide whether to pull events.
      const decision = shouldFetchEvents(this.state, fixture, nowMs);
      if (decision.fetch) {
        const result = await pollEvents(client, db, eventId, fixtureId, { writeEnabled });
        statsBuffer.recordCall(EVENTS_PATH);
        if (!result.ok) {
          statsBuffer.recordError(EVENTS_PATH);
        } else {
          // Advance state only on success so a transient failure re-attempts next tick.
          this.state.setLastScore(fixtureId, {
            home: fixture.goals.home ?? 0,
            away: fixture.goals.away ?? 0,
          });
          this.state.setEventsFetchAt(fixtureId, nowMs);
          eventsPolledCount++;
        }
      }

      // TODO(M2): statistics every 5min per fixture, lineups on-substitution,
      // players HT/FT snapshots. Needs additional FixtureState fields.
    }

    // 6. Prune. Compute pruned-count by snapshotting key set sizes before/after
    // (FixtureState doesn't expose a count accessor; reach into the test-helper
    // snapshot which is cheap — O(n) live fixtures).
    const beforePrune = this.getStateSnapshot().lastScore.size;
    this.state.pruneStale(activeIds);
    const afterPrune = this.getStateSnapshot().lastScore.size;
    const prunedCount = Math.max(0, beforePrune - afterPrune);

    return await this.finishAndPublish(statsBuffer, publishStats, client, {
      callEnabled,
      writeEnabled,
      discoveredCount: liveFixtures.length,
      eventsPolledCount,
      prunedCount,
    });

    // TODO(M2): cold-start surge stagger. When discoveredCount > 30, batch
    // pollers across the tick interval rather than firing all sequentially
    // in the first second of the tick. Threshold tuned to 30 fixtures
    // (api-football rate limit: 450/min hard cap).
    //
    // TODO(M2): prematch loop. h2h_af (T-24h..T-0) + predictions_af (T-2h..T-0)
    // run on a separate cadence (every ~30min) against /fixtures?date=YYYY-MM-DD
    // not /fixtures?live=all. Implement as a sibling Scheduler.prematchTick().
  }

  private async finishAndPublish(
    statsBuffer: StatsBuffer,
    publishStats: (stats: CycleStats) => Promise<void>,
    client: ApiFootballClient,
    result: TickResult,
  ): Promise<TickResult> {
    const rl = client.lastRateLimit();
    if (rl && rl.remaining !== null) {
      statsBuffer.setRateLimitRemaining(rl.remaining);
    }
    const stats = statsBuffer.finishCycle();
    try {
      await publishStats(stats);
    } catch {
      // Observability MUST NOT break the tick. Swallow.
    }
    return result;
  }

  /**
   * Long-running loop. Calls `tick()` every `tickIntervalMs`. Handles
   * SIGTERM/SIGINT for graceful shutdown — the current tick completes
   * before exit.
   */
  async run(): Promise<void> {
    let shouldStop = false;
    const onSignal = () => { shouldStop = true; };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);

    while (!shouldStop) {
      try {
        await this.tick();
      } catch (err) {
        // Last-line-of-defence: a single tick failure must not crash the loop.
        // The tick itself catches discovery+poll errors; this catches anything
        // exotic (OOM in resolver, etc.).
        // eslint-disable-next-line no-console
        console.error('[scheduler] tick crashed:', err);
      }
      if (shouldStop) break;
      await sleep(this.deps.tickIntervalMs);
    }

    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Production entry point
// ---------------------------------------------------------------------------

/**
 * Builds and runs a scheduler from `process.env` config. Intended for
 * `npm start`. Importing this module does NOT auto-start — `main()` is
 * called from the `if (import.meta.url ...)` guard below.
 */
export async function main(): Promise<void> {
  // dotenv side-effect import: loads .env into process.env if present.
  await import('dotenv/config');

  const cfg: ServiceConfig = loadConfig();
  const pool = new Pool({ connectionString: cfg.dbUrl });
  const client = new ApiFootballClient({ apiKey: cfg.apiKey });
  const flagCache = new FlagCache(pool, cfg.flagCacheTtlMs);
  const statsBuffer = new StatsBuffer();

  const eventIdResolver = makeProductionEventIdResolver(pool);

  const scheduler = new Scheduler({
    client,
    db: pool as unknown as PersistenceDb,
    flagCache,
    statsBuffer,
    eventIdResolver,
    publishStats: (stats) => defaultPublishStats(
      { endpoint: cfg.statsEndpoint, scraperKey: cfg.scraperKey },
      stats,
    ).then(() => undefined),
    tickIntervalMs: cfg.tickIntervalMs,
  });

  // eslint-disable-next-line no-console
  console.log('[scheduler] starting; tickIntervalMs=' + cfg.tickIntervalMs);
  await scheduler.run();
  // eslint-disable-next-line no-console
  console.log('[scheduler] stopped');
  await pool.end();
}

/**
 * Production event-id resolver: looks up `external_id_mapping` by
 * `(provider='api-football', external_id=fixtureId)`. Returns the mapped
 * `event_id` UUID or null if no row exists.
 *
 * The fuzzy-match flow that POPULATES the table runs in the M1.10
 * discovery cycle (separate cadence), NOT here.
 */
function makeProductionEventIdResolver(pool: Pool): (fixtureId: number) => Promise<string | null> {
  return async (fixtureId: number) => {
    const { rows } = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM external_id_mapping
        WHERE provider = 'api-football'
          AND external_id = $1
          AND confidence >= 0.5
        LIMIT 1`,
      [String(fixtureId)],
    );
    return rows.length > 0 ? rows[0].event_id : null;
  };
}

// Auto-start when this file is the entry module (npm start / tsx).
// Use import.meta.url comparison instead of require.main === module since
// the package is ESM.
const isEntry = (() => {
  try {
    const url = new URL(import.meta.url);
    return process.argv[1] && url.pathname.endsWith(process.argv[1].split('/').pop() || '');
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[scheduler] fatal:', err);
    process.exit(1);
  });
}
