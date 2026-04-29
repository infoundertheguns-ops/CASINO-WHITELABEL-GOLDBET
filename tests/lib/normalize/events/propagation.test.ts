import { describe, it, expect } from 'vitest';
import { matchByPropagation } from '@/lib/normalize/events/propagation';

function fakeSupabase(opts: {
  mappings?: Array<{ raw_name: string; canonical_name: string | null }>;
  fixtures?: Array<{ be_match_id: string; home_team: string; away_team: string; match_date: string }>;
}) {
  const mappings = opts.mappings ?? [];
  const fixtures = opts.fixtures ?? [];
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        lte: () => chain,
        limit: () => chain,
        then(fn: any) {
          if (table === 'team_mapping') return fn({ data: mappings, error: null });
          if (table === 'be_fixtures') return fn({ data: fixtures, error: null });
          return fn({ data: [], error: null });
        },
      };
      return chain;
    },
  } as any;
}

describe('matchByPropagation', () => {
  const base = {
    id: 'e1', source: 'flashscore' as const, sport: 'Calcio', league: null,
    starts_at: '2026-04-22T20:00:00Z', flashscore_id: null,
  };

  it('resolves both sides and finds fixture', async () => {
    const sb = fakeSupabase({
      mappings: [
        { raw_name: 'Milan', canonical_name: 'milan' },
        { raw_name: 'Inter', canonical_name: 'inter' },
      ],
      fixtures: [
        { be_match_id: 'fs1', home_team: 'Milan', away_team: 'Inter',
          match_date: '2026-04-22T20:00:00Z' },
      ],
    });
    const event = { ...base, home_team: 'Milan', away_team: 'Inter' };
    const r = await matchByPropagation(sb, event);
    expect(r?.flashscore_id).toBe('fs1');
    expect(r?.stage).toBe('propagation');
    expect(r?.confidence).toBe(1.0);
  });

  it('returns null when either canonical is null (negative cache)', async () => {
    const sb = fakeSupabase({
      mappings: [
        { raw_name: 'Milan', canonical_name: 'milan' },
        { raw_name: 'Inter', canonical_name: null },
      ],
      fixtures: [],
    });
    const event = { ...base, home_team: 'Milan', away_team: 'Inter' };
    const r = await matchByPropagation(sb, event);
    expect(r).toBeNull();
  });

  it('returns null when only one side mapped', async () => {
    const sb = fakeSupabase({
      mappings: [{ raw_name: 'Milan', canonical_name: 'milan' }],
      fixtures: [],
    });
    const event = { ...base, home_team: 'Milan', away_team: 'Inter' };
    const r = await matchByPropagation(sb, event);
    expect(r).toBeNull();
  });

  it('returns null when no fixture in window matches resolved names', async () => {
    const sb = fakeSupabase({
      mappings: [
        { raw_name: 'Milan', canonical_name: 'milan' },
        { raw_name: 'Inter', canonical_name: 'inter' },
      ],
      fixtures: [
        { be_match_id: 'fs1', home_team: 'Roma', away_team: 'Lazio',
          match_date: '2026-04-22T20:00:00Z' },
      ],
    });
    const event = { ...base, home_team: 'Milan', away_team: 'Inter' };
    const r = await matchByPropagation(sb, event);
    expect(r).toBeNull();
  });
});
