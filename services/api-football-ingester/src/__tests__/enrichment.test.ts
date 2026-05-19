import { describe, it, expect, vi } from 'vitest';
import { pollEvents, pollStatistics, pollLineups, pollPlayers } from '../enrichment.js';
import type { PersistenceDb } from '../persistence.js';
import type { ApiFootballClient } from '../api-client.js';

/**
 * Smoke tests for M1.12 live-window pollers.
 *
 * Each poller is a thin composition of:
 *   1. client.fetch(path)  -> returns the unwrapped `response` field
 *   2. persistLiveDataKey(db, eventId, key, payload, opts)
 *
 * We verify the wiring (path shape, key choice, flag-gating, error
 * surface) but NOT the inner persistence SQL (covered by persistence.test).
 */

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

function createMockClient(response: unknown) {
  const calls: string[] = [];
  const client = {
    calls,
    fetch: vi.fn(async (path: string) => {
      calls.push(path);
      return response;
    }),
  };
  return client;
}

function createThrowingClient(message: string) {
  const calls: string[] = [];
  const client = {
    calls,
    fetch: vi.fn(async (path: string) => {
      calls.push(path);
      throw new Error(message);
    }),
  };
  return client;
}

describe('pollEvents', () => {
  it('happy path: fetches /fixtures/events?fixture=X, writes events_af, returns rawCount', async () => {
    const db = createMockDb();
    const events = [{ time: { elapsed: 23 }, type: 'Goal' }, { time: { elapsed: 67 }, type: 'Card' }];
    const client = createMockClient(events);
    const result = await pollEvents(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-1',
      1001,
      { writeEnabled: true }
    );
    expect(result).toEqual({ ok: true, written: true, rawCount: 2 });
    expect(client.calls).toEqual(['/fixtures/events?fixture=1001']);
    expect(db.queries.length).toBe(1);
    expect(db.queries[0]!.sql).toMatch(/'events_af'/);
  });

  it('flag-gated: writeEnabled=false fetches API but skips DB write (returns written:false)', async () => {
    const db = createMockDb();
    const client = createMockClient([{ type: 'Goal' }]);
    const result = await pollEvents(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-2',
      1002,
      { writeEnabled: false }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.written).toBe(false);
    }
    expect(client.calls).toEqual(['/fixtures/events?fixture=1002']);
    expect(db.queries.length).toBe(0);
  });

  it('api error: client throws → returns {ok:false, error}; db not called', async () => {
    const db = createMockDb();
    const client = createThrowingClient('api-football 500: boom');
    const result = await pollEvents(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-3',
      1003,
      { writeEnabled: true }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/api-football 500/);
    }
    expect(db.queries.length).toBe(0);
  });
});

describe('pollStatistics', () => {
  it('fetches /fixtures/statistics?fixture=X and writes statistics_af', async () => {
    const db = createMockDb();
    const stats = [{ team: { id: 1 }, statistics: [{ type: 'Shots on Goal', value: 5 }] }];
    const client = createMockClient(stats);
    const result = await pollStatistics(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-s1',
      2001,
      { writeEnabled: true }
    );
    expect(result.ok).toBe(true);
    expect(client.calls).toEqual(['/fixtures/statistics?fixture=2001']);
    expect(db.queries[0]!.sql).toMatch(/'statistics_af'/);
  });
});

describe('pollLineups', () => {
  it('fetches /fixtures/lineups?fixture=X and writes lineups_af', async () => {
    const db = createMockDb();
    const client = createMockClient([{ team: { id: 1 }, startXI: [] }]);
    const result = await pollLineups(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-l1',
      3001,
      { writeEnabled: true }
    );
    expect(result.ok).toBe(true);
    expect(client.calls).toEqual(['/fixtures/lineups?fixture=3001']);
    expect(db.queries[0]!.sql).toMatch(/'lineups_af'/);
  });
});

describe('pollPlayers', () => {
  it("half='ht' writes players_af_ht", async () => {
    const db = createMockDb();
    const client = createMockClient([{ team: { id: 1 }, players: [] }]);
    const result = await pollPlayers(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-p1',
      4001,
      'ht',
      { writeEnabled: true }
    );
    expect(result.ok).toBe(true);
    expect(client.calls).toEqual(['/fixtures/players?fixture=4001']);
    expect(db.queries[0]!.sql).toMatch(/'players_af_ht'/);
  });

  it("half='ft' writes players_af_ft", async () => {
    const db = createMockDb();
    const client = createMockClient([{ team: { id: 1 }, players: [] }]);
    const result = await pollPlayers(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-p2',
      4002,
      'ft',
      { writeEnabled: true }
    );
    expect(result.ok).toBe(true);
    expect(db.queries[0]!.sql).toMatch(/'players_af_ft'/);
    expect(db.queries[0]!.sql).not.toMatch(/'players_af_ht'/);
  });
});
