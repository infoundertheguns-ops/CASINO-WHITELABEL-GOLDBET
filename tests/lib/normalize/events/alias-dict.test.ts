import { describe, it, expect, beforeEach } from 'vitest';
import { matchByAliasDict, __resetAliasCache } from '@/lib/normalize/events/alias-dict';

function fakeSupabase(opts: {
  aliases?: Array<{ alias: string; canonical: string; sport: string | null }>;
  fixtures?: Array<{ be_match_id: string; home_team: string; away_team: string; match_date: string }>;
}) {
  const aliases = opts.aliases ?? [];
  const fixtures = opts.fixtures ?? [];
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        or: () => chain,
        eq: () => chain,
        gte: () => chain,
        lte: () => chain,
        limit: () => chain,
        then(fn: any) {
          if (table === 'team_aliases') return fn({ data: aliases, error: null });
          if (table === 'be_fixtures') return fn({ data: fixtures, error: null });
          return fn({ data: [], error: null });
        },
      };
      return chain;
    },
  } as any;
}

describe('matchByAliasDict', () => {
  beforeEach(() => __resetAliasCache());

  const base = {
    id: 'e1', source: 'flashscore' as const, sport: 'Calcio', league: null,
    starts_at: '2026-04-22T20:00:00Z', flashscore_id: null,
  };

  it('matches via canonical lookup when source raw name is alias', async () => {
    const sb = fakeSupabase({
      aliases: [
        { alias: 'internazionale', canonical: 'inter', sport: 'football' },
        { alias: 'inter', canonical: 'inter', sport: 'football' },
      ],
      fixtures: [
        { be_match_id: 'fs1', home_team: 'Inter', away_team: 'Milan',
          match_date: '2026-04-22T20:00:00Z' },
      ],
    });
    const event = { ...base, home_team: 'Internazionale', away_team: 'Milan' };
    const r = await matchByAliasDict(sb, event);
    expect(r?.flashscore_id).toBe('fs1');
    expect(r?.stage).toBe('alias_dict');
    expect(r?.confidence).toBe(0.9);
  });

  it('returns null when no candidate matches after alias resolve', async () => {
    const sb = fakeSupabase({
      aliases: [],
      fixtures: [
        { be_match_id: 'fs1', home_team: 'Roma', away_team: 'Lazio',
          match_date: '2026-04-22T20:00:00Z' },
      ],
    });
    const event = { ...base, home_team: 'Milan', away_team: 'Inter' };
    const r = await matchByAliasDict(sb, event);
    expect(r).toBeNull();
  });

  it('returns null when no fixtures in window', async () => {
    const sb = fakeSupabase({ aliases: [], fixtures: [] });
    const event = { ...base, home_team: 'Milan', away_team: 'Inter' };
    const r = await matchByAliasDict(sb, event);
    expect(r).toBeNull();
  });

  it('falls back to normalized raw name when no alias entry exists', async () => {
    const sb = fakeSupabase({
      aliases: [],
      fixtures: [
        { be_match_id: 'fs1', home_team: 'Milan', away_team: 'Inter',
          match_date: '2026-04-22T20:00:00Z' },
      ],
    });
    const event = { ...base, home_team: 'milan', away_team: 'inter' };
    const r = await matchByAliasDict(sb, event);
    expect(r?.flashscore_id).toBe('fs1');
  });
});
