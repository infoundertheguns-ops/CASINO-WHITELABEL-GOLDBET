import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scheduler } from '../scheduler.js';
import type { AFFixture } from '../types.js';
import type { FlagCache } from '../config.js';
import type { ApiFootballClient } from '../api-client.js';
import type { PersistenceDb } from '../persistence.js';
import { StatsBuffer, type CycleStats } from '../stats-publisher.js';

// --- Test fixtures ------------------------------------------------------

function makeFixture(overrides: Partial<{
  id: number;
  homeGoals: number | null;
  awayGoals: number | null;
  statusShort: string;
  elapsed: number | null;
}> = {}): AFFixture {
  const id = overrides.id ?? 1001;
  return {
    fixture: {
      id,
      date: '2026-05-19T18:00:00+00:00',
      status: {
        elapsed: overrides.elapsed ?? 30,
        long: 'First Half',
        short: overrides.statusShort ?? '1H',
        extra: null,
      },
      venue: { id: 1, name: 'V', city: 'C' },
    },
    league: { id: 100, name: 'Premier League', country: 'England' },
    teams: {
      home: { id: 10, name: 'Home FC' },
      away: { id: 20, name: 'Away FC' },
    },
    goals: { home: overrides.homeGoals ?? 0, away: overrides.awayGoals ?? 0 },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

// --- Dep mocks ---------------------------------------------------------

function makeDeps(opts: {
  callEnabled?: boolean;
  writeEnabled?: boolean;
  liveFixtures?: AFFixture[];
  resolverMap?: Record<number, string | null>;
  clientFetchThrows?: Error;
} = {}) {
  const callEnabled = opts.callEnabled ?? true;
  const writeEnabled = opts.writeEnabled ?? true;
  const liveFixtures = opts.liveFixtures ?? [];

  const flagCache = {
    getFlag: vi.fn(async (key: string) => {
      if (key === 'API_FOOTBALL_CALL_ENABLED') return callEnabled;
      if (key === 'API_FOOTBALL_WRITE_ENABLED') return writeEnabled;
      return false;
    }),
    invalidate: vi.fn(),
  } as unknown as FlagCache;

  const fetchSpy = vi.fn(async (path: string) => {
    if (opts.clientFetchThrows && path.startsWith('/fixtures/events')) {
      throw opts.clientFetchThrows;
    }
    if (path === '/fixtures?live=all') return liveFixtures;
    return [];
  });

  const client = {
    fetch: fetchSpy,
    lastRateLimit: () => ({ limit: 7500, remaining: 7499 }),
  } as unknown as ApiFootballClient;

  const dbQuerySpy = vi.fn(async () => ({ rows: [] }));
  const db = { query: dbQuerySpy } as unknown as PersistenceDb;

  const statsBuffer = new StatsBuffer();

  const resolverMap = opts.resolverMap ?? Object.fromEntries(
    liveFixtures.map((f) => [f.fixture.id, 'uuid-' + f.fixture.id]),
  );
  const eventIdResolver = vi.fn(async (fixture: AFFixture) => resolverMap[fixture.fixture.id] ?? null);

  const publishSpy = vi.fn(async (_stats: CycleStats) => undefined);

  return {
    client,
    db,
    flagCache,
    statsBuffer,
    eventIdResolver,
    publishStats: publishSpy,
    tickIntervalMs: 30_000,
    fetchSpy,
    dbQuerySpy,
    publishSpy,
  };
}

// --- Tests --------------------------------------------------------------

describe('Scheduler.tick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('early-returns when callEnabled=false (no API calls, no pollers, no publish)', async () => {
    const deps = makeDeps({ callEnabled: false, liveFixtures: [makeFixture()] });
    const s = new Scheduler(deps);
    const r = await s.tick(1_000);
    expect(r.callEnabled).toBe(false);
    expect(r.eventsPolledCount).toBe(0);
    expect(r.discoveredCount).toBe(0);
    expect(deps.fetchSpy).not.toHaveBeenCalled();
    expect(deps.publishSpy).not.toHaveBeenCalled();
  });

  it('happy path with 1 live fixture, score-delta triggers pollEvents + persist + state update', async () => {
    const fx = makeFixture({ id: 42, homeGoals: 1, awayGoals: 0 });
    const deps = makeDeps({ liveFixtures: [fx] });
    const s = new Scheduler(deps);

    const r = await s.tick(10_000);

    expect(r.callEnabled).toBe(true);
    expect(r.writeEnabled).toBe(true);
    expect(r.discoveredCount).toBe(1);
    expect(r.eventsPolledCount).toBe(1);

    const paths = deps.fetchSpy.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/fixtures?live=all');
    expect(paths).toContain('/fixtures/events?fixture=42');

    expect(deps.dbQuerySpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    expect(s.getStateSnapshot().lastScore.get(42)).toEqual({ home: 1, away: 0 });
    expect(s.getStateSnapshot().lastEventsFetchAt.get(42)).toBe(10_000);
  });

  it('no score advance, lastEventsFetchAt fresh -> only persistTimerAndScore, no pollEvents', async () => {
    const fx = makeFixture({ id: 7, homeGoals: 0, awayGoals: 0 });
    const deps = makeDeps({ liveFixtures: [fx] });
    const s = new Scheduler(deps);

    s.primeState(7, { home: 0, away: 0 }, 9_000);

    const r = await s.tick(10_000);
    expect(r.eventsPolledCount).toBe(0);

    const paths = deps.fetchSpy.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(['/fixtures?live=all']);
  });

  it('pruneStale removes fixtures not in current discovery response', async () => {
    // Fixture 5 has a non-zero score so the score-delta branch fires and the
    // scheduler advances state — that lets us assert id=5 was kept while id=99
    // (primed but not in the discovery response) was pruned.
    const fx = makeFixture({ id: 5, homeGoals: 1, awayGoals: 0 });
    const deps = makeDeps({ liveFixtures: [fx] });
    const s = new Scheduler(deps);

    s.primeState(99, { home: 2, away: 1 }, 5_000);

    await s.tick(10_000);

    const snap = s.getStateSnapshot();
    expect(snap.lastScore.has(99)).toBe(false);
    expect(snap.lastScore.has(5)).toBe(true);
  });

  it('publishStats called at end of tick with non-empty endpoint_calls', async () => {
    // Score-delta forces /fixtures/events to be called so we assert both
    // endpoints are present in the stats payload.
    const fx = makeFixture({ id: 1, homeGoals: 1, awayGoals: 0 });
    const deps = makeDeps({ liveFixtures: [fx] });
    const s = new Scheduler(deps);

    await s.tick(10_000);

    expect(deps.publishSpy).toHaveBeenCalledTimes(1);
    const stats = deps.publishSpy.mock.calls[0][0];
    expect(stats.endpointCalls['/fixtures?live=all']).toBe(1);
    expect(stats.endpointCalls['/fixtures/events']).toBe(1);
    expect(stats.cycleDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('pollEvents error -> recordError + state NOT updated', async () => {
    const fx = makeFixture({ id: 33, homeGoals: 1, awayGoals: 0 });
    const deps = makeDeps({
      liveFixtures: [fx],
      clientFetchThrows: new Error('boom'),
    });
    const s = new Scheduler(deps);

    await s.tick(10_000);

    const snap = s.getStateSnapshot();
    expect(snap.lastEventsFetchAt.has(33)).toBe(false);
    expect(snap.lastScore.has(33)).toBe(false);

    const stats = deps.publishSpy.mock.calls[0][0];
    expect(stats.errors['/fixtures/events']).toBe(1);
  });

  it('writeEnabled=false (call=true): API called but persistence returns written:false', async () => {
    const fx = makeFixture({ id: 8, homeGoals: 2, awayGoals: 1 });
    const deps = makeDeps({ writeEnabled: false, liveFixtures: [fx] });
    const s = new Scheduler(deps);

    const r = await s.tick(10_000);
    expect(r.writeEnabled).toBe(false);

    const paths = deps.fetchSpy.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/fixtures?live=all');
    expect(paths).toContain('/fixtures/events?fixture=8');

    expect(deps.dbQuerySpy).not.toHaveBeenCalled();
  });

  it('empty live fixtures -> 0 pollers, stats published with just discovery call', async () => {
    const deps = makeDeps({ liveFixtures: [] });
    const s = new Scheduler(deps);

    const r = await s.tick(10_000);
    expect(r.discoveredCount).toBe(0);
    expect(r.eventsPolledCount).toBe(0);

    expect(deps.fetchSpy).toHaveBeenCalledTimes(1);
    expect(deps.publishSpy).toHaveBeenCalledTimes(1);
    const stats = deps.publishSpy.mock.calls[0][0];
    expect(stats.endpointCalls).toEqual({ '/fixtures?live=all': 1 });
    expect(stats.errors).toEqual({});
  });

  it('fixture without resolved eventId is skipped (no persist, no poll)', async () => {
    const fx = makeFixture({ id: 55 });
    const deps = makeDeps({
      liveFixtures: [fx],
      resolverMap: { 55: null },
    });
    const s = new Scheduler(deps);

    const r = await s.tick(10_000);
    expect(r.discoveredCount).toBe(1);
    expect(r.eventsPolledCount).toBe(0);

    const paths = deps.fetchSpy.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(['/fixtures?live=all']);
  });

  it('rate_limit_remaining captured from client into stats', async () => {
    const deps = makeDeps({ liveFixtures: [] });
    const s = new Scheduler(deps);
    await s.tick(10_000);
    const stats = deps.publishSpy.mock.calls[0][0];
    expect(stats.rateLimitRemaining).toBe(7499);
  });
});

// ---------------------------------------------------------------------------
// Production resolver (spec §3.5 resolve-at-ingest)
// ---------------------------------------------------------------------------

import { makeProductionEventIdResolver } from '../scheduler.js';
import type { Pool } from 'pg';

function makePoolMock(responses: Array<{ rows: any[] }>) {
  let i = 0;
  const calls: Array<{ sql: string; params: any[] }> = [];
  const query = vi.fn(async (sql: string, params: any[]) => {
    calls.push({ sql, params });
    if (i >= responses.length) return { rows: [] };
    return responses[i++];
  });
  return { pool: ({ query } as unknown) as Pool, query, calls };
}

describe('makeProductionEventIdResolver (resolve-at-ingest, spec §3.5)', () => {
  it('cache hit short-circuits: returns event_id without fuzzy match or insert', async () => {
    const { pool, query } = makePoolMock([{ rows: [{ event_id: 'uuid-cached' }] }]);
    const resolve = makeProductionEventIdResolver(pool);
    const fx = makeFixture({ id: 1001 });

    const result = await resolve(fx);

    expect(result).toBe('uuid-cached');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SELECT event_id FROM external_id_mapping/);
    expect(params).toEqual(['1001']);
  });

  it('cache miss + no candidates: returns null, no insert', async () => {
    const { pool, query } = makePoolMock([
      { rows: [] }, // cache lookup -> empty
      { rows: [] }, // candidate scan -> empty
    ]);
    const resolve = makeProductionEventIdResolver(pool);
    const fx = makeFixture({ id: 2002 });

    const result = await resolve(fx);

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    // No INSERT was issued.
    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((q) => /INSERT INTO external_id_mapping/.test(q))).toBe(false);
  });

  it('cache miss + fuzzy match succeeds: persists mapping and returns event_id', async () => {
    const candidate = {
      id: 'uuid-fresh',
      home: 'Home FC',
      away: 'Away FC',
      league_name: 'Premier League',
      starts_at: '2026-05-19T18:00:00+00:00',
    };
    const { pool, query, calls } = makePoolMock([
      { rows: [] },           // cache miss
      { rows: [candidate] },  // candidates within ±2h
      { rows: [] },           // insert ack
    ]);
    const resolve = makeProductionEventIdResolver(pool);
    const fx = makeFixture({ id: 3003 });

    const result = await resolve(fx);

    expect(result).toBe('uuid-fresh');
    expect(query).toHaveBeenCalledTimes(3);

    // Candidate scan used a ±2h window around the fixture kickoff.
    const candSql = calls[1].sql;
    expect(candSql).toMatch(/SELECT id, home, away, league_name, starts_at/);
    expect(candSql).toMatch(/sport_slug = 'football'/);
    const [winLow, winHigh] = calls[1].params as [string, string];
    const kickoffMs = new Date(fx.fixture.date).getTime();
    expect(new Date(winLow).getTime()).toBe(kickoffMs - 2 * 60 * 60 * 1000);
    expect(new Date(winHigh).getTime()).toBe(kickoffMs + 2 * 60 * 60 * 1000);

    // Insert carries the resolved tuple. Confidence is whatever resolveMapping
    // computed — assert the shape, not the exact float.
    const insertSql = calls[2].sql;
    expect(insertSql).toMatch(/INSERT INTO external_id_mapping/);
    expect(insertSql).toMatch(/ON CONFLICT \(provider, external_id\)/);
    const insertParams = calls[2].params;
    expect(insertParams[0]).toBe('uuid-fresh');
    expect(insertParams[1]).toBe('3003');
    expect(typeof insertParams[2]).toBe('number');
    expect(insertParams[2]).toBeGreaterThanOrEqual(0.5);
    expect(typeof insertParams[3]).toBe('boolean');
  });

  it('cache miss + candidates present but all below 0.5 threshold: returns null, no insert', async () => {
    const candidate = {
      id: 'uuid-mismatch',
      home: 'Totally Different Team',
      away: 'Another Random Side',
      league_name: 'Different Cup',
      starts_at: '2026-05-19T18:00:00+00:00',
    };
    const { pool, query } = makePoolMock([
      { rows: [] },
      { rows: [candidate] },
    ]);
    const resolve = makeProductionEventIdResolver(pool);
    const fx = makeFixture({ id: 4004 });

    const result = await resolve(fx);

    expect(result).toBeNull();
    // 2 queries only — no INSERT because resolveMapping returned null.
    expect(query).toHaveBeenCalledTimes(2);
  });
});
