// lib/settlement/source-router.ts

export type CanonicalSource = 'api-football' | 'fs';

/**
 * Canonical settlement source router.
 *
 * For (market_type, sport) tuples this returns which provider is the
 * source-of-truth for settling that market:
 *  - 'api-football': api-football fixtures/statistics/players feed
 *  - 'fs':           Flashscore-derived incidents (default fallback)
 *
 * Strategy: explicit allowlist for football markets handled by api-football,
 * default-FS for everything else (non-football sports, exotic/unknown football
 * markets, and the small set of pre-existing FS-owned football player props).
 *
 * Reference: api-football integration spec §4.2 (Bucket A/B/C taxonomy).
 * The canonical_key strings below match supabase/migrations/185_market_
 * normalization_seed_odds_api_football.sql exactly — this router consumes
 * the same namespace produced by the OddsAPI ingester normaliser.
 */

/**
 * Football canonical markets owned by api-football.
 *
 * Bucket A (score-derived): 28 keys
 * Bucket B (statistics-derived): 32 keys
 * Bucket C (player props with api-football statistics/players coverage):
 *   10 keys (excludes pre-existing FS-owned scorer markets, see FS_RETAINED
 *   below for the rationale)
 *
 * Total: 70 keys.
 */
const API_FOOTBALL_CANONICAL: ReadonlySet<string> = new Set<string>([
  // --- Bucket A: score-derived (events_v2.score + period_scores) ---
  '1x2',
  '1x2_ht',
  '1x2_sh',
  'totals',
  'totals_ht',
  'totals_sh',
  'btts',
  'btts_ht',
  'btts_sh',
  'double_chance',
  'draw_no_bet',
  'correct_score',
  'ht_ft',
  'odd_even',
  'spread',
  'spread_ht',
  'european_handicap',
  'asian_handicap',
  'team_total_home',
  'team_total_away',
  'team_total_goals_home',
  'team_total_goals_away',
  'team_total_goals_home_ht',
  'team_total_goals_away_ht',
  'exact_total_goals',
  'number_of_goals',
  'first_team_to_score',
  'method_of_victory',

  // --- Bucket B: statistics-derived (api-football /statistics) ---
  'total_corners',
  'total_corners_ht',
  'corners_totals_home',
  'corners_totals_away',
  'corners_spread',
  'corner_handicap',
  'corner_1x2',
  'corner_2way',
  'bookings_totals',
  'bookings_totals_home',
  'bookings_totals_away',
  'bookings_spread',
  'card_handicap',
  'number_of_cards',
  'team_cards_home',
  'team_cards_away',
  'total_shots',
  'total_shots_home',
  'total_shots_away',
  'total_shots_on_target',
  'total_shots_on_target_home',
  'total_shots_on_target_away',
  'most_shots_on_target',
  'goalkeeper_saves',
  'goalkeeper_saves_home',
  'goalkeeper_saves_away',
  'total_offsides',
  'team_offsides_home',
  'team_offsides_away',
  'total_fouls',
  'total_fouls_home',
  'total_fouls_away',

  // --- Bucket C: player props (api-football /players + /statistics) ---
  // Note: NOT including the legacy FS-owned scorer markets
  // (anytime_goalscorer, first_goalscorer, last_goalscorer, multi_scorers,
  // anytime_goalscorer_or_assist) — those continue to settle from FS
  // incident attribution and predate the api-football integration.
  'to_score_2plus_goals',
  'to_score_3plus_goals',
  'player_shots',
  'player_shots_on_target',
  'player_to_be_booked',
  'player_fouls',
  'player_to_be_fouled',
  'player_tackles',
  'player_to_assist',
  'player_to_score_or_assist',
  'player_passes',
  'team_goalscorer',
  'goal_method',
]);

/**
 * Picks the canonical settlement source for a given (market_type, sport).
 *
 * Football: api-football owns the score-derived + statistics-derived
 * markets listed in API_FOOTBALL_CANONICAL plus a curated subset of
 * player props. Pre-existing FS-owned scorer markets and any exotic /
 * unknown market_type fall through to 'fs'.
 *
 * Non-football: no api-football integration exists → always 'fs'.
 */
export function pickCanonicalSource(
  market_type: string,
  sport: string,
): CanonicalSource {
  if (sport !== 'football') return 'fs';
  return API_FOOTBALL_CANONICAL.has(market_type) ? 'api-football' : 'fs';
}
