// Sprint 2 sentinel cases — verify the engine pipeline behaves correctly
// when match_event_by_trigram_v2 returns the kind of candidates the new
// boost/penalty system is designed to surface or reject.
//
// SQL-level normalization (normalize_team_name, has_women_suffix,
// has_reserves_suffix, league/country boost, gender/reserves penalty) is
// covered by integration in mig 118; here we mock the RPC's *output* and
// assert the engine wires it through correctly.

import { describe, it, expect } from 'vitest';
import { matchByTrigram } from '@/lib/normalize/events/trigram';
import type { EventToNormalize } from '@/lib/normalize/events/types';

function fakeSupabase(rpcResults: any[]) {
  return {
    rpc: async (fn: string) => {
      if (fn === 'match_event_by_trigram_v2') return { data: rpcResults, error: null };
      return { data: null, error: new Error('unexpected rpc ' + fn) };
    },
  } as any;
}

describe('trigram v2 sentinel cases', () => {
  it('Šeško diacritic — high-score candidate is accepted', async () => {
    // After SQL normalize_team_name: "Šeško" → "sesko", "Sesko" → "sesko".
    // Trigram(home) = 1.0, trigram(away) = 1.0, league exact +0.20.
    // Expected score = 0.45 + 0.45 + 0.20 ≈ clamp 1.0.
    const event: EventToNormalize = {
      id: 'e-sesko', source: 'kambi', sport: 'Calcio',
      league: 'Bundesliga', country: 'Germany',
      home_team: 'RB Leipzig', away_team: 'Šeško United',
      starts_at: '2026-04-22T19:30:00Z', flashscore_id: null,
    };
    const sb = fakeSupabase([
      { flashscore_id: 'fs-sesko', score: 1.0, similarity: 1.0,
        league_boost: 0.20, gender_penalty: 0, reserves_penalty: 0 },
    ]);
    const r = await matchByTrigram(sb, event);
    expect(r?.flashscore_id).toBe('fs-sesko');
    expect(r?.confidence).toBe(1);
  });

  it('Atletico Alagoinhas (Women) vs Atletico Alagoinhas — gender penalty drops below threshold', async () => {
    // Event has Women suffix, candidate doesn't → SQL applies -0.15.
    // Trigram(home) ≈ 1.0 (after strip Women), trigram(away) ≈ 1.0.
    // Expected raw = 0.9 + (league_boost) − 0.15. If league missing, score ≈ 0.75 → above 0.7 threshold but the engine should rank gender-mismatched LOWER than gender-matched.
    // Here we simulate the case where ONLY a gender-mismatched candidate is returned and it falls below threshold:
    const event: EventToNormalize = {
      id: 'e-women', source: 'kambi', sport: 'Calcio',
      league: 'Brasileiro Women', country: 'Brazil',
      home_team: 'Atletico Alagoinhas (Women)',
      away_team: 'Bahia (Women)',
      starts_at: '2026-04-22T22:00:00Z', flashscore_id: null,
    };
    // Mock returns the men's match with penalty applied → score 0.65 (below threshold)
    const sb = fakeSupabase([
      { flashscore_id: 'fs-men', score: 0.65, similarity: 0.65,
        gender_penalty: -0.15, league_boost: 0 },
    ]);
    const r = await matchByTrigram(sb, event);
    expect(r).toBeNull(); // 0.65 < 0.7 threshold
  });

  it('Atletico Alagoinhas (Women) — correct women candidate accepted at 0.95', async () => {
    const event: EventToNormalize = {
      id: 'e-women-ok', source: 'kambi', sport: 'Calcio',
      league: 'Brasileiro Women', country: 'Brazil',
      home_team: 'Atletico Alagoinhas (Women)',
      away_team: 'Bahia (Women)',
      starts_at: '2026-04-22T22:00:00Z', flashscore_id: null,
    };
    const sb = fakeSupabase([
      { flashscore_id: 'fs-women', score: 0.95, similarity: 0.95,
        gender_penalty: 0, league_boost: 0.20, country_boost: 0.10 },
    ]);
    const r = await matchByTrigram(sb, event);
    expect(r?.flashscore_id).toBe('fs-women');
    expect(r?.confidence).toBeCloseTo(0.95);
  });

  it('Smorgon D vs Smorgon — reserves penalty handled by SQL, top candidate is the senior squad without penalty', async () => {
    // Event home "Smorgon D" has reserves marker D (treated like II/B/U23 family
    // by SQL has_reserves_suffix). If the candidate is ALSO a reserve squad (matched),
    // no penalty. If candidate is the senior squad (NOT reserve), penalty -0.15 applies.
    const event: EventToNormalize = {
      id: 'e-smorgon', source: 'kambi', sport: 'Calcio',
      league: 'Belarus 2 Division', country: 'Belarus',
      home_team: 'Smorgon II',
      away_team: 'BATE II',
      starts_at: '2026-04-22T15:00:00Z', flashscore_id: null,
    };
    // Mock RPC returns the correct reserve match (no penalty, league exact)
    const sb = fakeSupabase([
      { flashscore_id: 'fs-smorgon-2', score: 0.97, similarity: 0.97,
        league_boost: 0.20, country_boost: 0.10, reserves_penalty: 0 },
    ]);
    const r = await matchByTrigram(sb, event);
    expect(r?.flashscore_id).toBe('fs-smorgon-2');
  });

  it('PSG ↔ Paris Saint-Germain — alias pre-resolution lifts trigram score', async () => {
    // Acronym expansion is alias_dict territory (stage 3b), but the trigram
    // RPC itself benefits from passing league=Ligue 1 + country=France:
    // even with low base similarity (PSG ~ 0.3 vs 'paris saint germain'),
    // the league + country boost pushes the score above threshold.
    const event: EventToNormalize = {
      id: 'e-psg', source: 'kambi', sport: 'Calcio',
      league: 'Ligue 1', country: 'France',
      home_team: 'PSG', away_team: 'Marseille',
      starts_at: '2026-04-22T20:00:00Z', flashscore_id: null,
    };
    // Score = trigram(0.3 * 0.45) + trigram(0.95 * 0.45) + league(0.20) + country(0.10) + time(0.05)
    //       ≈ 0.135 + 0.4275 + 0.35 = 0.91
    const sb = fakeSupabase([
      { flashscore_id: 'fs-psg', score: 0.91, similarity: 0.91,
        trigram_home: 0.3, trigram_away: 0.95,
        league_boost: 0.20, country_boost: 0.10, time_bonus: 0.05 },
    ]);
    const r = await matchByTrigram(sb, event);
    expect(r?.flashscore_id).toBe('fs-psg');
    expect(r?.confidence).toBeCloseTo(0.91);
  });

  it('cross-country same-name guard — Premier League Ethiopia vs England disambiguated by country boost ranking', async () => {
    // Two candidates with same league name but different countries. The
    // RPC ranks them by score; only the matching-country one passes threshold.
    const event: EventToNormalize = {
      id: 'e-eth', source: 'kambi', sport: 'Calcio',
      league: 'Premier League', country: 'Ethiopia',
      home_team: 'Saint George', away_team: 'Hawassa',
      starts_at: '2026-04-22T13:00:00Z', flashscore_id: null,
    };
    // Mock returns the Ethiopia candidate as top (with country_boost=0.10),
    // the English candidate would be ranked below and not returned as top:
    const sb = fakeSupabase([
      { flashscore_id: 'fs-eth', score: 0.88, similarity: 0.88,
        league_boost: 0.20, country_boost: 0.10 },
    ]);
    const r = await matchByTrigram(sb, event);
    expect(r?.flashscore_id).toBe('fs-eth');
  });
});
