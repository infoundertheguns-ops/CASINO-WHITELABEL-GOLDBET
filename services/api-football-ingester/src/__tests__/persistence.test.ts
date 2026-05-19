import { describe, it, expect, vi } from 'vitest';
import {
  persistTimerAndScore,
  persistStatistics,
  derivePeriod,
  type PersistenceDb,
} from '../persistence.js';
import type { AFFixture } from '../types.js';

// --- Mock DB helper ---

function createMockDb() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    queries,
    query: vi.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [] as unknown[] };
    }),
  };
  return db;
}

// --- Fixture builder ---

function buildFixture(overrides: {
  id?: number;
  statusShort?: string;
  statusLong?: string;
  elapsed?: number | null;
  goalsHome?: number | null;
  goalsAway?: number | null;
  htHome?: number | null;
  htAway?: number | null;
  ftHome?: number | null;
  ftAway?: number | null;
} = {}): AFFixture {
  return {
    fixture: {
      id: overrides.id ?? 1001,
      date: '2026-05-19T15:00:00+00:00',
      status: {
        elapsed: overrides.elapsed ?? 30,
        long: overrides.statusLong ?? 'First Half',
        short: overrides.statusShort ?? '1H',
      },
      venue: { id: 1, name: 'Stadio', city: 'Roma' },
    },
    league: { id: 135, name: 'Serie A', country: 'Italy' },
    teams: {
      home: { id: 1, name: 'Home FC' },
      away: { id: 2, name: 'Away FC' },
    },
    goals: {
      home: 'goalsHome' in overrides ? overrides.goalsHome! : 1,
      away: 'goalsAway' in overrides ? overrides.goalsAway! : 0,
    },
    score: {
      halftime: {
        home: 'htHome' in overrides ? overrides.htHome! : null,
        away: 'htAway' in overrides ? overrides.htAway! : null,
      },
      fulltime: {
        home: 'ftHome' in overrides ? overrides.ftHome! : null,
        away: 'ftAway' in overrides ? overrides.ftAway! : null,
      },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

// --- Tests ---

describe('derivePeriod', () => {
  const cases: Array<[string, string | null]> = [
    ['1H', '1T'],
    ['HT', 'HT'],
    ['2H', '2T'],
    ['ET', 'ET'],
    ['P', 'PEN'],
    ['BT', 'BT'],
    ['NS', null],
    ['TBD', null],
    ['', null],
  ];
  it.each(cases)('maps status.short %s -> %s', (input, expected) => {
    expect(derivePeriod(input)).toBe(expected);
  });
});

describe('persistTimerAndScore', () => {
  it('is a no-op when writeEnabled=false (flag-gate)', async () => {
    const db = createMockDb();
    const fixture = buildFixture({ statusShort: '1H' });
    const result = await persistTimerAndScore(db as unknown as PersistenceDb, 'evt-1', fixture, {
      writeEnabled: false,
    });
    expect(result.written).toBe(false);
    expect(db.queries.length).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('issues a single UPDATE on events_v2 with the 6 columns when writeEnabled=true', async () => {
    const db = createMockDb();
    const fixture = buildFixture({
      statusShort: '1H',
      elapsed: 25,
      goalsHome: 1,
      goalsAway: 0,
      htHome: 1,
      htAway: 0,
      ftHome: 1,
      ftAway: 0,
    });
    const result = await persistTimerAndScore(db as unknown as PersistenceDb, 'evt-1', fixture, {
      writeEnabled: true,
    });
    expect(result.written).toBe(true);
    expect(db.queries.length).toBe(1);
    const q = db.queries[0]!;
    expect(q.sql).toMatch(/UPDATE\s+events_v2/i);
    expect(q.sql).toMatch(/score_home\s*=\s*\$1/);
    expect(q.sql).toMatch(/score_away\s*=\s*\$2/);
    expect(q.sql).toMatch(/minute\s*=\s*\$3/);
    expect(q.sql).toMatch(/period\s*=\s*\$4/);
    expect(q.sql).toMatch(/period_scores\s*=\s*\$5/);
    expect(q.sql).toMatch(/WHERE\s+id\s*=\s*\$6/i);
    // persistTimerAndScore must NOT touch live_data
    expect(q.sql).not.toMatch(/live_data/i);
    // params positional order: home, away, minute, period, period_scores, eventId
    expect(q.params[0]).toBe(1);
    expect(q.params[1]).toBe(0);
    expect(q.params[2]).toBe(25);
    expect(q.params[3]).toBe('1T');
    expect(q.params[5]).toBe('evt-1');
  });

  it('coerces null goals to 0', async () => {
    const db = createMockDb();
    const fixture = buildFixture({
      statusShort: '1H',
      elapsed: 10,
      goalsHome: null,
      goalsAway: 1,
    });
    await persistTimerAndScore(db as unknown as PersistenceDb, 'evt-2', fixture, {
      writeEnabled: true,
    });
    const q = db.queries[0]!;
    expect(q.params[0]).toBe(0);
    expect(q.params[1]).toBe(1);
  });

  it('derives period_scores as {firstHalf, secondHalf} with secondHalf = fulltime - halftime', async () => {
    const db = createMockDb();
    const fixture = buildFixture({
      statusShort: '2H',
      elapsed: 75,
      goalsHome: 2,
      goalsAway: 1,
      htHome: 1,
      htAway: 0,
      ftHome: 2,
      ftAway: 1,
    });
    await persistTimerAndScore(db as unknown as PersistenceDb, 'evt-3', fixture, {
      writeEnabled: true,
    });
    const q = db.queries[0]!;
    const periodScoresParam = q.params[4];
    // Param may be serialized JSON string or a plain object; accept both.
    const parsed =
      typeof periodScoresParam === 'string' ? JSON.parse(periodScoresParam) : periodScoresParam;
    expect(parsed).toEqual({
      firstHalf: { home: 1, away: 0 },
      secondHalf: { home: 1, away: 1 },
    });
  });

  it('places eventId as the LAST positional parameter', async () => {
    const db = createMockDb();
    const fixture = buildFixture({ statusShort: '1H' });
    await persistTimerAndScore(db as unknown as PersistenceDb, 'evt-LAST', fixture, {
      writeEnabled: true,
    });
    const q = db.queries[0]!;
    expect(q.params[q.params.length - 1]).toBe('evt-LAST');
  });
});

describe('persistStatistics', () => {
  it('is a no-op when writeEnabled=false (flag-gate)', async () => {
    const db = createMockDb();
    const result = await persistStatistics(
      db as unknown as PersistenceDb,
      'evt-stat-1',
      { possession: { home: 55, away: 45 } },
      { writeEnabled: false }
    );
    expect(result.written).toBe(false);
    expect(db.queries.length).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("writes statistics under the 'statistics_af' namespace (not 'stats')", async () => {
    const db = createMockDb();
    const result = await persistStatistics(
      db as unknown as PersistenceDb,
      'evt-stat-2',
      { possession: { home: 55, away: 45 } },
      { writeEnabled: true }
    );
    expect(result.written).toBe(true);
    expect(db.queries.length).toBe(1);
    const q = db.queries[0]!;
    expect(q.sql).toMatch(/'statistics_af'/);
    expect(q.sql).not.toMatch(/'stats'(?!_af)/);
  });

  it("uses jsonb merge so existing live_data keys (incidents/stats/matchMeta/fs_pregame) are preserved", async () => {
    const db = createMockDb();
    await persistStatistics(
      db as unknown as PersistenceDb,
      'evt-stat-3',
      { something: 1 },
      { writeEnabled: true }
    );
    const q = db.queries[0]!;
    // Must use COALESCE+||  to merge into existing live_data, never replace it wholesale.
    expect(q.sql).toMatch(/COALESCE\s*\(\s*live_data\s*,\s*'\{\}'::jsonb\s*\)\s*\|\|/i);
    expect(q.sql).toMatch(/jsonb_build_object/i);
  });

  it('places eventId as the LAST positional parameter', async () => {
    const db = createMockDb();
    await persistStatistics(
      db as unknown as PersistenceDb,
      'evt-stat-LAST',
      { foo: 'bar' },
      { writeEnabled: true }
    );
    const q = db.queries[0]!;
    expect(q.params[q.params.length - 1]).toBe('evt-stat-LAST');
  });
});

describe('persistLiveDataKey (generic helper)', () => {
  it('is a no-op when writeEnabled=false', async () => {
    const db = createMockDb();
    const { persistLiveDataKey } = await import('../persistence.js');
    const result = await persistLiveDataKey(
      db as unknown as PersistenceDb,
      'evt-gen-1',
      'lineups_af',
      { foo: 'bar' },
      { writeEnabled: false }
    );
    expect(result.written).toBe(false);
    expect(db.queries.length).toBe(0);
  });

  it("interpolates the typed key literal (e.g. 'lineups_af') into the SQL and uses jsonb merge", async () => {
    const db = createMockDb();
    const { persistLiveDataKey } = await import('../persistence.js');
    const result = await persistLiveDataKey(
      db as unknown as PersistenceDb,
      'evt-gen-2',
      'lineups_af',
      [{ team: { id: 1 }, startXI: [] }],
      { writeEnabled: true }
    );
    expect(result.written).toBe(true);
    expect(db.queries.length).toBe(1);
    const q = db.queries[0]!;
    expect(q.sql).toMatch(/'lineups_af'/);
    expect(q.sql).not.toMatch(/'statistics_af'/);
    expect(q.sql).toMatch(/COALESCE\s*\(\s*live_data\s*,\s*'\{\}'::jsonb\s*\)\s*\|\|/i);
    expect(q.sql).toMatch(/WHERE\s+id\s*=\s*\$2/i);
    // eventId must be the LAST positional parameter
    expect(q.params[q.params.length - 1]).toBe('evt-gen-2');
  });
});
