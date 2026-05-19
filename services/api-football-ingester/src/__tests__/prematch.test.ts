import { describe, it, expect, vi } from 'vitest';
import { pollHeadToHead, pollPredictions } from '../prematch.js';
import type { PersistenceDb } from '../persistence.js';
import type { ApiFootballClient } from '../api-client.js';

/**
 * Smoke tests for M1.12 prematch-window pollers (h2h + predictions).
 * Verify URL shape, key choice, and flag-gating.
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

describe('pollHeadToHead', () => {
  it("calls /fixtures/headtohead?h2h=A-B and writes h2h_af", async () => {
    const db = createMockDb();
    const client = createMockClient([{ fixture: { id: 999 } }]);
    const result = await pollHeadToHead(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-h1',
      33,
      40,
      { writeEnabled: true }
    );
    expect(result).toEqual({ ok: true, written: true, rawCount: 1 });
    expect(client.calls).toEqual(['/fixtures/headtohead?h2h=33-40']);
    expect(db.queries.length).toBe(1);
    expect(db.queries[0]!.sql).toMatch(/'h2h_af'/);
    expect(db.queries[0]!.params[db.queries[0]!.params.length - 1]).toBe('evt-h1');
  });
});

describe('pollPredictions', () => {
  it('flag-gated: writeEnabled=false fetches API but skips DB write', async () => {
    const db = createMockDb();
    const client = createMockClient([{ predictions: { winner: { id: 1 } } }]);
    const result = await pollPredictions(
      client as unknown as ApiFootballClient,
      db as unknown as PersistenceDb,
      'evt-pr1',
      5001,
      { writeEnabled: false }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.written).toBe(false);
    }
    expect(client.calls).toEqual(['/predictions?fixture=5001']);
    expect(db.queries.length).toBe(0);
  });
});
