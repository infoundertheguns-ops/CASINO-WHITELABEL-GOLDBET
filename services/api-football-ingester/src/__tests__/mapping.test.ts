import { describe, it, expect } from 'vitest';
import {
  computeConfidence,
  nameSimilarity,
  leagueMatchScore,
  kickoffProximityScore,
  resolveMapping,
  type V2EventCandidate,
} from '../mapping.js';
import type { AFFixture } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAFFixture(overrides: Partial<{
  date: string;
  league: string;
  home: string;
  away: string;
}> = {}): AFFixture {
  return {
    fixture: {
      id: 999,
      date: overrides.date ?? '2026-05-18T19:00:00+00:00',
      status: { elapsed: null, long: 'Not Started' },
      venue: { id: 1, name: 'Test', city: 'Test' },
    },
    league: {
      id: 39,
      name: overrides.league ?? 'Premier League',
      country: 'England',
    },
    teams: {
      home: { id: 1, name: overrides.home ?? 'Arsenal' },
      away: { id: 2, name: overrides.away ?? 'Chelsea' },
    },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

function makeCandidate(overrides: Partial<V2EventCandidate> = {}): V2EventCandidate {
  return {
    id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
    home: overrides.home ?? 'Arsenal',
    away: overrides.away ?? 'Chelsea',
    league_name: overrides.league_name ?? 'Premier League',
    starts_at: overrides.starts_at ?? '2026-05-18T19:00:00+00:00',
  };
}

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('returns 1.0 for perfect match across all components', () => {
    const score = computeConfidence({
      name_similarity: 1.0,
      league_match_score: 1.0,
      kickoff_proximity_score: 1.0,
    });
    expect(score).toBeCloseTo(1.0, 10);
  });

  it('returns 0.7 when only league mismatches (0.5*1 + 0.3*0 + 0.2*1)', () => {
    const score = computeConfidence({
      name_similarity: 1.0,
      league_match_score: 0.0,
      kickoff_proximity_score: 1.0,
    });
    expect(score).toBeCloseTo(0.7, 10);
  });

  it('returns 0.8 when only kickoff is far apart (0.5*1 + 0.3*1 + 0.2*0)', () => {
    const score = computeConfidence({
      name_similarity: 1.0,
      league_match_score: 1.0,
      kickoff_proximity_score: 0.0,
    });
    expect(score).toBeCloseTo(0.8, 10);
  });

  it('returns 0.5 when only names mismatch (0.5*0 + 0.3*1 + 0.2*1)', () => {
    const score = computeConfidence({
      name_similarity: 0.0,
      league_match_score: 1.0,
      kickoff_proximity_score: 1.0,
    });
    expect(score).toBeCloseTo(0.5, 10);
  });

  it('combines partial scores additively (0.5*0.8 + 0.3*1 + 0.2*0.5 = 0.8)', () => {
    const score = computeConfidence({
      name_similarity: 0.8,
      league_match_score: 1.0,
      kickoff_proximity_score: 0.5,
    });
    expect(score).toBeCloseTo(0.8, 10);
  });

  it('clamps out-of-range inputs to [0,1]', () => {
    const above = computeConfidence({
      name_similarity: 2.0,
      league_match_score: 5.0,
      kickoff_proximity_score: 1.0,
    });
    expect(above).toBeCloseTo(1.0, 10);

    const below = computeConfidence({
      name_similarity: -1.0,
      league_match_score: -0.5,
      kickoff_proximity_score: -2.0,
    });
    expect(below).toBeCloseTo(0.0, 10);
  });
});

// ---------------------------------------------------------------------------
// kickoffProximityScore
// ---------------------------------------------------------------------------

describe('kickoffProximityScore', () => {
  it('returns 1.0 at exact match', () => {
    expect(
      kickoffProximityScore(
        '2026-05-18T19:00:00+00:00',
        '2026-05-18T19:00:00+00:00',
      ),
    ).toBeCloseTo(1.0, 10);
  });

  it('returns 0.5 at 30min apart (linear)', () => {
    expect(
      kickoffProximityScore(
        '2026-05-18T19:00:00+00:00',
        '2026-05-18T19:30:00+00:00',
      ),
    ).toBeCloseTo(0.5, 10);
  });

  it('returns 0 at 60min apart (boundary exclusive)', () => {
    expect(
      kickoffProximityScore(
        '2026-05-18T19:00:00+00:00',
        '2026-05-18T20:00:00+00:00',
      ),
    ).toBe(0);
  });

  it('clamps to 0 beyond 60min (not negative)', () => {
    expect(
      kickoffProximityScore(
        '2026-05-18T19:00:00+00:00',
        '2026-05-18T21:00:00+00:00',
      ),
    ).toBe(0);
  });

  it('is symmetric (a vs b == b vs a)', () => {
    const a = kickoffProximityScore(
      '2026-05-18T19:00:00+00:00',
      '2026-05-18T19:15:00+00:00',
    );
    const b = kickoffProximityScore(
      '2026-05-18T19:15:00+00:00',
      '2026-05-18T19:00:00+00:00',
    );
    expect(a).toBeCloseTo(b, 10);
  });

  it('returns 0 for invalid ISO strings', () => {
    expect(kickoffProximityScore('not-a-date', '2026-05-18T19:00:00Z')).toBe(0);
    expect(kickoffProximityScore('2026-05-18T19:00:00Z', 'garbage')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// leagueMatchScore
// ---------------------------------------------------------------------------

describe('leagueMatchScore', () => {
  it('returns 1.0 on exact match', () => {
    expect(leagueMatchScore('Premier League', 'Premier League')).toBe(1);
  });

  it('returns 1.0 normalized (case + trailing whitespace)', () => {
    expect(leagueMatchScore('Premier League', 'premier league ')).toBe(1);
  });

  it('returns 1.0 normalized across diacritics', () => {
    expect(leagueMatchScore('Ligue 1', 'ligue 1')).toBe(1);
  });

  it('returns 0 for totally different leagues', () => {
    expect(leagueMatchScore('Premier League', 'Serie A')).toBe(0);
  });

  it('returns 0 when either side is null/empty', () => {
    expect(leagueMatchScore(null, 'Premier League')).toBe(0);
    expect(leagueMatchScore('Premier League', null)).toBe(0);
    expect(leagueMatchScore('', '')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// nameSimilarity
// ---------------------------------------------------------------------------

describe('nameSimilarity', () => {
  it('returns 1.0 for identical home+away pairs', () => {
    expect(nameSimilarity('Arsenal', 'Chelsea', 'Arsenal', 'Chelsea')).toBeCloseTo(1.0, 10);
  });

  it('averages per-team scores (one perfect, one mismatch)', () => {
    // home identical (1.0), away totally different (likely 0 or low)
    const score = nameSimilarity('Arsenal', 'Chelsea', 'Arsenal', 'Zzzzz Xyz');
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// resolveMapping
// ---------------------------------------------------------------------------

describe('resolveMapping', () => {
  it('returns null when candidate list is empty', () => {
    const fixture = makeAFFixture();
    expect(resolveMapping(fixture, [])).toBeNull();
  });

  it('returns null when best confidence < 0.50', () => {
    const fixture = makeAFFixture({
      home: 'Arsenal',
      away: 'Chelsea',
      league: 'Premier League',
    });
    // Totally different teams + league + kickoff 2h apart -> confidence very low
    const cand = makeCandidate({
      home: 'Boca Juniors',
      away: 'River Plate',
      league_name: 'Argentine Primera',
      starts_at: '2026-05-18T21:00:00+00:00',
    });
    expect(resolveMapping(fixture, [cand])).toBeNull();
  });

  it('returns verified=true when best confidence >= 0.85', () => {
    const fixture = makeAFFixture();
    const cand = makeCandidate(); // identical to fixture defaults
    const result = resolveMapping(fixture, [cand]);
    expect(result).not.toBeNull();
    expect(result!.event_id).toBe(cand.id);
    expect(result!.verified).toBe(true);
    expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('returns verified=false when best confidence is 0.50-0.85', () => {
    // Perfect names + kickoff, league mismatch => 0.7 (deterministic)
    const fixture = makeAFFixture({ league: 'Premier League' });
    const cand = makeCandidate({ league_name: 'La Liga' });
    const result = resolveMapping(fixture, [cand]);
    expect(result).not.toBeNull();
    expect(result!.event_id).toBe(cand.id);
    expect(result!.verified).toBe(false);
    expect(result!.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result!.confidence).toBeLessThan(0.85);
    expect(result!.confidence).toBeCloseTo(0.7, 10);
  });

  it('picks the best candidate when multiple match', () => {
    const fixture = makeAFFixture();
    const weaker = makeCandidate({
      id: '00000000-0000-0000-0000-000000000aaa',
      league_name: 'Different League', // forces league_match_score=0
    });
    const stronger = makeCandidate({
      id: '00000000-0000-0000-0000-000000000bbb',
    });
    const result = resolveMapping(fixture, [weaker, stronger]);
    expect(result).not.toBeNull();
    expect(result!.event_id).toBe(stronger.id);
    expect(result!.verified).toBe(true);
  });
});
