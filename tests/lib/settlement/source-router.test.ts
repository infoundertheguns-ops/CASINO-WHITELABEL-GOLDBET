// tests/lib/settlement/source-router.test.ts
import { describe, it, expect } from 'vitest';
import { pickCanonicalSource } from '@/lib/settlement/source-router';

describe('pickCanonicalSource', () => {
  // --- Bucket A (score-derived, football) ---
  it('routes football 1x2 to api-football', () => {
    expect(pickCanonicalSource('1x2', 'football')).toBe('api-football');
  });
  it('routes football totals to api-football', () => {
    expect(pickCanonicalSource('totals', 'football')).toBe('api-football');
  });
  it('routes football btts to api-football', () => {
    expect(pickCanonicalSource('btts', 'football')).toBe('api-football');
  });
  it('routes football ht_ft to api-football', () => {
    expect(pickCanonicalSource('ht_ft', 'football')).toBe('api-football');
  });
  it('routes football correct_score to api-football', () => {
    expect(pickCanonicalSource('correct_score', 'football')).toBe('api-football');
  });
  it('routes football double_chance to api-football', () => {
    expect(pickCanonicalSource('double_chance', 'football')).toBe('api-football');
  });

  // --- Bucket B (statistics-derived, football) ---
  it('routes football corners_totals_home to api-football (Bucket B)', () => {
    expect(pickCanonicalSource('corners_totals_home', 'football')).toBe('api-football');
  });
  it('routes football total_corners to api-football (Bucket B)', () => {
    expect(pickCanonicalSource('total_corners', 'football')).toBe('api-football');
  });
  it('routes football bookings_totals to api-football (Bucket B)', () => {
    expect(pickCanonicalSource('bookings_totals', 'football')).toBe('api-football');
  });
  it('routes football total_shots_on_target to api-football (Bucket B)', () => {
    expect(pickCanonicalSource('total_shots_on_target', 'football')).toBe('api-football');
  });
  it('routes football goalkeeper_saves to api-football (Bucket B)', () => {
    expect(pickCanonicalSource('goalkeeper_saves', 'football')).toBe('api-football');
  });

  // --- Bucket C (player props, football, api-football-owned) ---
  it('routes football to_score_2plus_goals to api-football (Bucket C)', () => {
    expect(pickCanonicalSource('to_score_2plus_goals', 'football')).toBe('api-football');
  });
  it('routes football to_score_3plus_goals to api-football (Bucket C)', () => {
    expect(pickCanonicalSource('to_score_3plus_goals', 'football')).toBe('api-football');
  });
  it('routes football player_shots to api-football (Bucket C)', () => {
    expect(pickCanonicalSource('player_shots', 'football')).toBe('api-football');
  });
  it('routes football player_to_be_booked to api-football (Bucket C)', () => {
    expect(pickCanonicalSource('player_to_be_booked', 'football')).toBe('api-football');
  });
  it('routes football player_to_assist to api-football (Bucket C)', () => {
    expect(pickCanonicalSource('player_to_assist', 'football')).toBe('api-football');
  });
  it('routes football team_goalscorer to api-football (Bucket C)', () => {
    expect(pickCanonicalSource('team_goalscorer', 'football')).toBe('api-football');
  });
  it('routes football goal_method to api-football (Bucket C)', () => {
    expect(pickCanonicalSource('goal_method', 'football')).toBe('api-football');
  });

  // --- Football pre-existing FS-owned player markets (NOT in api-football set) ---
  it('routes football anytime_goalscorer to fs (pre-existing FS player market)', () => {
    expect(pickCanonicalSource('anytime_goalscorer', 'football')).toBe('fs');
  });
  it('routes football first_goalscorer to fs', () => {
    expect(pickCanonicalSource('first_goalscorer', 'football')).toBe('fs');
  });
  it('routes football last_goalscorer to fs', () => {
    expect(pickCanonicalSource('last_goalscorer', 'football')).toBe('fs');
  });
  it('routes football multi_scorers to fs', () => {
    expect(pickCanonicalSource('multi_scorers', 'football')).toBe('fs');
  });
  it('routes football anytime_goalscorer_or_assist to fs', () => {
    expect(pickCanonicalSource('anytime_goalscorer_or_assist', 'football')).toBe('fs');
  });

  // --- Non-football sports fallback ---
  it('routes basketball ml to fs (non-football fallback)', () => {
    expect(pickCanonicalSource('ml', 'basketball')).toBe('fs');
  });
  it('routes basketball 1x2 to fs (non-football, even if key matches set)', () => {
    expect(pickCanonicalSource('1x2', 'basketball')).toBe('fs');
  });
  it('routes tennis match_winner to fs', () => {
    expect(pickCanonicalSource('match_winner', 'tennis')).toBe('fs');
  });
  it('routes baseball totals to fs (non-football)', () => {
    expect(pickCanonicalSource('totals', 'baseball')).toBe('fs');
  });
  it('routes hockey 1x2 to fs (non-football)', () => {
    expect(pickCanonicalSource('1x2', 'hockey')).toBe('fs');
  });

  // --- Default-FS for unknown football markets ---
  it('routes football unknown_market to fs (default-fs)', () => {
    expect(pickCanonicalSource('some_unknown_exotic_market', 'football')).toBe('fs');
  });
  it('routes football empty market_type to fs', () => {
    expect(pickCanonicalSource('', 'football')).toBe('fs');
  });
});
