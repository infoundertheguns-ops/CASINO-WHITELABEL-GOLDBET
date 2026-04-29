import { describe, it, expect } from 'vitest';
import { normalizeEvent } from '@/lib/normalize/events/engine';

// Mock Supabase. Sprint 2 (mig 118): fetchCandidates and matchByTrigram both
// call match_event_by_trigram_v2. Sprint 2.x (mig 119): persistMatch may issue
// a separate UPDATE on event_normalization to flip verified=true (we capture
// every chained call to inspect the auto-verify gate).
function fakeSupabase(config: {
  candidates?: any[];
  trigram?: any[];
  aliases?: Record<string, string>;
  propagationMappings?: any[];
  captureUpserts?: any[];
  captureUpdates?: any[];
}) {
  const c = config;
  let rpcCallCount = 0;
  return {
    from(table: string) {
      const state: { lastAlias?: string; pendingUpdate?: any; eqStack?: Array<[string, any]> } = { eqStack: [] };
      const chain: any = {
        select: () => chain,
        eq(col: string, val: any) {
          if (table === 'team_aliases' && col === 'alias') state.lastAlias = val;
          state.eqStack!.push([col, val]);
          if (state.pendingUpdate) {
            // The auto-verify UPDATE chains .eq('event_id', x).eq('verified', false)
            // Only push the captured update once both eq are applied (i.e. on Promise resolution path).
          }
          return chain;
        },
        or: () => chain,
        in: () => chain,
        gte: () => chain,
        lte: () => chain,
        limit: () => chain,
        upsert(row: any) {
          c.captureUpserts?.push({ table, row });
          return chain;
        },
        update(row: any) {
          state.pendingUpdate = row;
          c.captureUpdates?.push({ table, row, eqs: state.eqStack ?? [] });
          return chain;
        },
        then(fn: any) {
          if (table === 'team_aliases') {
            const alias = state.lastAlias ?? '';
            if (c.aliases?.[alias]) {
              return fn({ data: [{ canonical: c.aliases[alias], sport: 'football' }], error: null });
            }
            return fn({ data: [], error: null });
          }
          if (table === 'team_mapping') return fn({ data: c.propagationMappings ?? [], error: null });
          return fn({ data: [], error: null });
        },
      };
      return chain;
    },
    rpc: async (fn: string) => {
      if (fn === 'match_event_by_trigram_v2') {
        rpcCallCount++;
        if (rpcCallCount === 1) return { data: c.candidates ?? [], error: null };
        return { data: c.trigram ?? c.candidates ?? [], error: null };
      }
      return { data: null, error: null };
    },
  } as any;
}

describe('normalizeEvent', () => {
  const base = {
    id: 'evt1', source: 'kambi' as const,
    sport: 'Calcio', league: 'Serie A', country: 'Italy',
    home_team: 'Milan', away_team: 'Inter', starts_at: '2026-04-22T20:00:00Z',
    flashscore_id: null,
  };

  it('short-circuits on flashscore_native + auto-verifies', async () => {
    const upserts: any[] = [];
    const updates: any[] = [];
    const sb = fakeSupabase({ captureUpserts: upserts, captureUpdates: updates });
    const r = await normalizeEvent(sb, { ...base, flashscore_id: 'fs-existing' });
    expect(r.stage).toBe('flashscore_native');
    expect(upserts[0]).toMatchObject({ table: 'event_normalization', row: { match_stage: 'flashscore_native' } });
    // flashscore_native is in ALWAYS_AUTO_VERIFY_STAGES → expect a verify UPDATE
    const vu = updates.find(u => u.table === 'event_normalization' && u.row.verified === true);
    expect(vu).toBeTruthy();
  });

  it('regex word-set tier (no v2 score) → confidence 0.88, NOT auto-verified', async () => {
    // Word-set match (reordered tokens) without v2 RPC score → confidence 0.88.
    // Below auto-verify (0.97) AND below auto-apply to events.flashscore_id (0.95).
    const upserts: any[] = [];
    const updates: any[] = [];
    const sb = fakeSupabase({
      candidates: [{
        flashscore_id: 'fs1',
        home_team: 'Milan AC', away_team: 'Inter FC', // reordered
        starts_at: '2026-04-22T20:00:00Z',
        league: 'Serie A', country: 'Italy',
        // No `score` field → regex relies on its own tier (word-set = 0.88)
      }],
      trigram: [],
      captureUpserts: upserts,
      captureUpdates: updates,
    });
    // Use an event with reordered tokens that share the same word-set as the candidate.
    const eventReordered = { ...base, home_team: 'AC Milan', away_team: 'FC Inter' };
    const r = await normalizeEvent(sb, eventReordered);
    expect(r.stage).toBe('regex');
    expect(r.confidence).toBeCloseTo(0.88);
    expect(upserts.find(u => u.table === 'event_normalization' && u.row.flashscore_id === 'fs1')).toBeTruthy();
    expect(updates.find(u => u.table === 'events')).toBeFalsy();
    expect(updates.find(u => u.table === 'event_normalization' && u.row.verified === true)).toBeFalsy();
  });

  it('regex exact + v2 score 0.99 → auto-applies AND auto-verifies', async () => {
    // Tier 1 exact within 30min = 0.99 regex confidence; v2 score 0.99 from RPC
    // → final confidence 0.99 → above both 0.95 (auto-apply) and 0.97 (auto-verify).
    const upserts: any[] = [];
    const updates: any[] = [];
    const sb = fakeSupabase({
      candidates: [{
        flashscore_id: 'fs1',
        home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-22T20:00:00Z',
        league: 'Serie A', country: 'Italy',
        score: 0.99, similarity: 0.99,
      }],
      trigram: [],
      captureUpserts: upserts,
      captureUpdates: updates,
    });
    const r = await normalizeEvent(sb, base);
    expect(r.stage).toBe('regex');
    expect(r.confidence).toBeCloseTo(0.99);
    expect(updates.find(u => u.table === 'events' && u.row.flashscore_id === 'fs1')).toBeTruthy();
    expect(updates.find(u => u.table === 'event_normalization' && u.row.verified === true)).toBeTruthy();
  });

  it('trigram 0.92 → applies but does NOT auto-verify (<0.97)', async () => {
    const upserts: any[] = [];
    const updates: any[] = [];
    const sb = fakeSupabase({
      candidates: [],
      trigram: [{ flashscore_id: 'fs-trig', score: 0.92, similarity: 0.92 }],
      captureUpserts: upserts,
      captureUpdates: updates,
    });
    const r = await normalizeEvent(sb, base);
    expect(r.stage).toBe('trigram');
    expect(r.confidence).toBeCloseTo(0.92);
    // confidence 0.92 < auto-apply 0.95 → NO events.flashscore_id update
    expect(updates.find(u => u.table === 'events')).toBeFalsy();
    // confidence 0.92 < auto-verify 0.97 → NO verified UPDATE
    expect(updates.find(u => u.table === 'event_normalization' && u.row.verified === true)).toBeFalsy();
  });

  it('trigram 0.98 → both events update + verify update', async () => {
    const updates: any[] = [];
    const sb = fakeSupabase({
      candidates: [],
      trigram: [{ flashscore_id: 'fs-hi', score: 0.98, similarity: 0.98 }],
      captureUpserts: [],
      captureUpdates: updates,
    });
    const r = await normalizeEvent(sb, base);
    expect(r.confidence).toBeCloseTo(0.98);
    expect(updates.find(u => u.table === 'events')?.row).toMatchObject({ flashscore_id: 'fs-hi' });
    expect(updates.find(u => u.table === 'event_normalization' && u.row.verified === true)).toBeTruthy();
  });

  it('returns unmapped + persists negative-cache row + NO verify UPDATE', async () => {
    const upserts: any[] = [];
    const updates: any[] = [];
    const sb = fakeSupabase({ candidates: [], trigram: [], captureUpserts: upserts, captureUpdates: updates });
    const r = await normalizeEvent(sb, base);
    expect(r.stage).toBe('unmapped');
    expect(upserts.find((u) => u.row.match_stage === 'unmapped')).toBeTruthy();
    expect(updates.find(u => u.table === 'event_normalization' && u.row.verified === true)).toBeFalsy();
  });

  it('upsert payload includes llm_verify=null for non-LLM stages', async () => {
    const upserts: any[] = [];
    const sb = fakeSupabase({
      candidates: [{
        flashscore_id: 'fs1', home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-22T20:00:00Z', league: 'Serie A', country: 'Italy',
        score: 0.99, similarity: 0.99,
      }],
      trigram: [],
      captureUpserts: upserts,
      captureUpdates: [],
    });
    await normalizeEvent(sb, base);
    const evNormUpsert = upserts.find(u => u.table === 'event_normalization');
    expect(evNormUpsert?.row).toHaveProperty('llm_verify', null);
  });
});
