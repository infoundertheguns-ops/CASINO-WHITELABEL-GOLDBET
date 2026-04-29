import { describe, it, expect } from 'vitest';
import { matchByTrigram } from '@/lib/normalize/events/trigram';

function fakeSupabase(rpcResults: any[]) {
  let lastArgs: any = null;
  return {
    rpc: async (fn: string, args: any) => {
      lastArgs = args;
      if (fn === 'match_event_by_trigram_v2') return { data: rpcResults, error: null };
      return { data: null, error: new Error('unexpected rpc ' + fn) };
    },
    _lastArgs: () => lastArgs,
  } as any;
}

describe('matchByTrigram (v2)', () => {
  const event = {
    id: 'e1', source: 'flashscore' as const,
    sport: 'Tennis',
    league: 'ATP Madrid',
    country: 'Spain',
    home_team: 'Djokovic N',
    away_team: 'Alcaraz C',
    starts_at: '2026-04-22T15:00:00Z',
    flashscore_id: null,
  };

  it('returns top candidate above threshold using `score` field', async () => {
    const sb = fakeSupabase([
      { flashscore_id: 'fs1', score: 0.92, similarity: 0.92 },
      { flashscore_id: 'fs2', score: 0.65, similarity: 0.65 },
    ]);
    const r = await matchByTrigram(sb, event);
    expect(r?.flashscore_id).toBe('fs1');
    expect(r?.stage).toBe('trigram');
    expect(r?.confidence).toBeCloseTo(0.92);
  });

  it('falls back to similarity when score missing (legacy v1 mock)', async () => {
    const sb = fakeSupabase([{ flashscore_id: 'fs1', similarity: 0.88 }]);
    const r = await matchByTrigram(sb, event);
    expect(r?.flashscore_id).toBe('fs1');
    expect(r?.confidence).toBeCloseTo(0.88);
  });

  it('returns null when best score below threshold', async () => {
    const sb = fakeSupabase([{ flashscore_id: 'fs1', score: 0.5 }]);
    const r = await matchByTrigram(sb, event);
    expect(r).toBeNull();
  });

  it('returns null on empty data', async () => {
    const sb = fakeSupabase([]);
    const r = await matchByTrigram(sb, event);
    expect(r).toBeNull();
  });

  it('clamps confidence to 1.0', async () => {
    const sb = fakeSupabase([{ flashscore_id: 'fs1', score: 1.25 }]);
    const r = await matchByTrigram(sb, event);
    expect(r?.confidence).toBe(1);
  });

  it('passes league + country + 12h window to RPC', async () => {
    const sb = fakeSupabase([{ flashscore_id: 'fs1', score: 0.95 }]);
    await matchByTrigram(sb, event);
    const args = sb._lastArgs();
    expect(args.p_league).toBe('ATP Madrid');
    expect(args.p_country).toBe('Spain');
    expect(args.p_window_hours).toBe(12);
    expect(args.p_limit).toBe(10);
  });

  it('passes nulls for league/country when absent on event', async () => {
    const sb = fakeSupabase([{ flashscore_id: 'fs1', score: 0.95 }]);
    await matchByTrigram(sb, { ...event, league: null, country: null });
    const args = sb._lastArgs();
    expect(args.p_league).toBeNull();
    expect(args.p_country).toBeNull();
  });
});
