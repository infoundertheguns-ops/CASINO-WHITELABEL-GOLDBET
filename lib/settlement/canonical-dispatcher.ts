// Canonical-driven settlement dispatcher (Phase B + C).
//
// When the regex-based MARKET_PATTERNS in settlement.ts fail to match a
// source-specific market name (e.g. 22bet "1X2 - 1T" vs Kambi "1X2 - 1° Tempo"),
// this module provides a fallback lookup via market_normalization +
// outcome_normalization / outcome_dictionary.
//
// Contract: pure functions only. Callers are responsible for loading the
// lookup maps from the DB once per event and passing them in.

export type SettlerKey = string;

// canonical_key → settler key already registered in SETTLERS map in settlement.ts.
// Only canonicals whose settler accepts standard (home,away,total,line) or
// canonical-safe outcomes are listed here. Exotic canonicals (player props,
// team-name outcomes, compound team-specific markets) live in VOID_BY_DESIGN
// or fall through to void naturally.
export const CANONICAL_TO_SETTLER: Record<string, SettlerKey> = {
  // ─── 1X2 family ───
  "1x2_ft": "1X2",
  "1x2_1h": "1X2_HT",
  "1x2_2h": "1X2_SH",
  "1x2_3h": "1X2_QUARTER", // setIdx derived from suffix
  "1x2_4h": "1X2_QUARTER",

  // ─── Over/Under family ───
  u_o_ft: "O/U",
  u_o_1h: "O/U_HT",
  u_o_2h: "O/U_SH",
  u_o_3h: "O/U_QUARTER",
  u_o_4h: "O/U_QUARTER",

  // ─── GG/NG family ───
  gg_ng_ft: "GG/NG",
  gg_ng_1h: "GG/NG_HT",
  gg_ng_2h: "GG/NG_SH",

  // ─── Double Chance family ───
  dc_ft: "DC",
  dc_1h: "DC_HT",
  dc_2h: "DC_SH",
  dc_3h: "DC_PERIOD",
  dc_4h: "DC_PERIOD",

  // ─── Handicap family ───
  "1x2_h_ft": "HANDICAP",
  "1x2_h_1h": "HANDICAP_HT",
  "1x2_h_3h": "HANDICAP_QUARTER",
  "1x2_h_4h": "HANDICAP_QUARTER",

  // ─── 2-way handicap (tennis/basket/hockey no-draw) ───
  "2way_handicap_ft": "HANDICAP",
  "2way_handicap_1h": "HANDICAP_HT",
  "2way_handicap_3h": "HANDICAP_QUARTER",
  "2way_handicap_4h": "HANDICAP_QUARTER",

  // ─── Draw No Bet family ───
  dnb_ft: "DNB",
  dnb_1h: "DNB_HT",
  dnb_3h: "DNB_QUARTER",
  dnb_4h: "DNB_QUARTER",

  // ─── Correct Score family ───
  cs_ft: "EXACT_SCORE",
  cs_1h: "EXACT_SCORE_HT",

  // ─── Odd/Even family ───
  oe_ft: "ODD_EVEN",
  oe_1h: "ODD_EVEN_HT",
  oe_3h: "ODD_EVEN_QUARTER",
  oe_4h: "ODD_EVEN_QUARTER",

  // ─── HT/FT ───
  htft: "HT_FT",

  // ─── Winner family (2-way: tennis, basket no-draw, hockey) ───
  winner_ft: "MATCH_WINNER",
  h2h_ft: "MATCH_WINNER",

  // ─── Corners ───
  total_corners_ft: "O/U_CORNERS",
  total_corners_1h: "O/U_CORNERS_HT",
  total_corners_2h: "O/U_CORNERS_SH",
  corner_winner_ft: "1X2_CORNERS",
  corner_winner_1h: "1X2_CORNERS_HT",
  corner_winner_2h: "1X2_CORNERS_SH",
  corner_1x2_handicap_ft: "HANDICAP_CORNERS",

  // ─── Family C combos ───
  // 1X2 + GG → outcomes: home_yes, home_no, draw_yes, draw_no, away_yes, away_no
  "1x2_btts_ft": "COMBO_1X2_GG",
  "1x2_btts_1h": "COMBO_1X2_GG_HT",
  // DC + GG → outcomes: 1X_yes, 1X_no, 12_yes, 12_no, X2_yes, X2_no
  dc_btts_ft: "COMBO_DC_GG",
  // DC + O/U → outcomes: 1X_over, 1X_under, 12_over, 12_under, X2_over, X2_under
  dc_and_total_ft: "COMBO_DC_OU",
  // GG + O/U → outcomes: over_yes, over_no, under_yes, under_no
  btts_and_total_ft: "COMBO_GG_OU",
};

// Canonicals that we explicitly know we cannot settle with the data we have.
// Treated identically to "no mapping" in terms of dispatch behavior (both →
// void), but separated so admin tooling can tell "unsettleable by design"
// apart from "not yet mapped". Do not add canonicals here if there's a
// realistic path to settling them with stats we ingest.
export const VOID_BY_DESIGN: ReadonlySet<string> = new Set([
  // Player-specific markets — need roster/player event data we don't ingest.
  "anytime_scorer",
  "first_scorer",
  "last_scorer",
  "player_assists_ft",
  "player_booked_ft",
  "player_first_and_last_scorer_ft",
  "player_first_or_last_scorer_ft",
  "player_points_et_ft",
  "player_pra_et_ft",
  "player_red_card_ft",
  "player_scores_goals_ft",
  "player_scores_header_ft",
  "player_scores_or_assists_ft",
  "player_scores_outside_ft",
  "player_shots_on_target_ft",
  "team1_first_player_to_score_ft",
  "team2_first_player_to_score_ft",

  // Minute-window / in-play timeline markets.
  "goal_at_minute_ft",
  "first_goal_half_ft",
  "second_goal_time_ft",
  "minute_window_goal_total_ft",
  "corner_interval_ft",
  "corners_four_sides_ft",
  "team_interval_total_ft",
  "team_interval_total_1h",
  "team_interval_total_2h",
  "next_corner_ft",

  // Specific in-play events — need incident feed we don't ingest.
  "penalty_awarded_1h",
  "penalty_awarded_2h",
  "red_card_given_2h",
  "woodwork_hit_ft",
  "own_goal_ft",
  "coin_toss_winner_ft",
  "coin_toss_and_match_ft",

  // Esports-specific — need game-internal events (towers, frags, maps).
  "first_blood_1h",
  "first_blood_2h",
  "first_blood_ft",
  "frag_moment_1h",
  "frag_moment_2h",
  "who_destroys_tower_1h",
  "who_destroys_tower_2h",
  "who_destroys_tower_ft",
  "map_to_overtime_ft",
  "map_total_towers_ft",
  "cs_map_ft",
  "total_dragons_slain_ft",

  // Cricket-specific — need ball-by-ball data.
  "cricket_ball_run_ft",
  "first_run_ft",
  "last_run_ft",
  "super_over_winner_ft",

  // Pre-tournament props (resolved at tournament end, not per-event).
  "tournament_highest_away_score_1h",
  "tournament_highest_away_score_2h",
  "tournament_highest_home_score_1h",
  "tournament_highest_home_score_2h",
  "tournament_least_scoring_match_1h",
  "tournament_least_scoring_match_2h",
  "tournament_least_scoring_team_1h",
  "tournament_least_scoring_team_2h",
  "tournament_most_scoring_match_1h",
  "tournament_most_scoring_match_2h",
  "tournament_most_scoring_team_1h",
  "tournament_most_scoring_team_2h",
]);

// Lookup maps loaded once per event from the DB.
export interface CanonicalLookups {
  // key = `${source}|${source_market_type}`
  market: Map<string, { canonical_key: string; canonical_line: number | null }>;
  // key = `${source}|${source_market_type}|${lower(source_outcome_name)}`
  outcome: Map<string, string>; // → canonical_outcome_key
  // key = `${canonical_key}|${lower(source_outcome_pattern)}`
  dictionary: Map<string, string>; // → canonical_outcome_key
}

export function makeEmptyLookups(): CanonicalLookups {
  return {
    market: new Map(),
    outcome: new Map(),
    dictionary: new Map(),
  };
}

// Extract the period index from a canonical_key suffix. Used to supply
// setIdx to QUARTER/PERIOD settlers (halfScores[setIdx-1]) when dispatch
// comes from canonical fallback instead of a regex with a capture group.
//   1x2_3h → 3, u_o_4h → 4, dc_1h/2h/ft → undefined (handled by _HT/_SH
//   settlers directly), winner_ft → undefined.
export function deriveSetIdx(canonicalKey: string): number | undefined {
  const m = canonicalKey.match(/_(\d)h$/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  // 1h/2h are handled by dedicated _HT/_SH settlers without setIdx
  if (n === 1 || n === 2) return undefined;
  return n;
}

// Resolve a market to a settler key via canonical_key fallback.
// Returns null if (a) market has no canonical mapping, or (b) canonical_key
// is in VOID_BY_DESIGN or has no registered settler.
export function resolveCanonicalSettler(
  source: string,
  marketType: string,
  marketLine: number | null | undefined,
  lookups: CanonicalLookups
): { key: SettlerKey; line?: number; setIdx?: number; canonicalKey: string } | null {
  const mnKey = `${source}|${marketType}`;
  const mn = lookups.market.get(mnKey);
  if (!mn) return null;

  // Void by design wins even if a settler exists — treat the mapping as
  // deliberately unsettleable (current stats don't support it).
  if (VOID_BY_DESIGN.has(mn.canonical_key)) return null;

  const settlerKey = CANONICAL_TO_SETTLER[mn.canonical_key];
  if (!settlerKey) return null;

  const line =
    mn.canonical_line != null
      ? Number(mn.canonical_line)
      : marketLine != null
        ? Number(marketLine)
        : undefined;

  return {
    key: settlerKey,
    line,
    setIdx: deriveSetIdx(mn.canonical_key),
    canonicalKey: mn.canonical_key,
  };
}

// Translate a (source, market_type, outcome_name, canonical_key) tuple into
// a settler-compatible outcome string. Falls back to raw name if no mapping
// exists — settlers like settle1X2 and settleGGNG already tolerate both
// canonical ("1"/"X"/"2"/"Sì"/"No") and verbose Italian forms.
export function canonicalizeOutcome(
  source: string,
  marketType: string,
  outcomeName: string,
  canonicalKey: string | null,
  lookups: CanonicalLookups
): string {
  const raw = outcomeName.trim();
  const rawLower = raw.toLowerCase();

  // 1. Try outcome_normalization (source-specific, manually curated)
  const onKey = `${source}|${marketType}|${rawLower}`;
  let canonicalOutcome = lookups.outcome.get(onKey);

  // 2. Fall back to outcome_dictionary (canonical_key + lower name)
  if (!canonicalOutcome && canonicalKey) {
    const dictKey = `${canonicalKey}|${rawLower}`;
    canonicalOutcome = lookups.dictionary.get(dictKey);
  }

  // 3. No canonical → return raw (settlers accept verbose Italian)
  if (!canonicalOutcome) return raw;

  // Translate canonical_outcome_key → form the existing settlers understand.
  return canonicalOutcomeToSettlerInput(canonicalOutcome, raw);
}

// canonical_outcome_key → raw outcome string that the existing settlers
// in SETTLERS{} know how to parse. Most settlers already handle multiple
// aliases (e.g. settle1X2: "1"/"X"/"2"; settleGGNG: "GG"/"NG"/"Sì"/"No").
// We pick the most restrictive canonical form.
export function canonicalOutcomeToSettlerInput(
  canonicalOutcome: string,
  fallback: string
): string {
  switch (canonicalOutcome) {
    // 1x2 family
    case "home":
      return "1";
    case "draw":
      return "X";
    case "away":
      return "2";

    // u_o family
    case "over":
      return "Over";
    case "under":
      return "Under";

    // gg_ng family
    case "yes":
      return "Sì";
    case "no":
      return "No";

    // dc family
    case "1X":
    case "12":
    case "X2":
      return canonicalOutcome;

    // oe family
    case "odd":
      return "Dispari";
    case "even":
      return "Pari";

    // htft family — settlers expect "1/1", "1/X", etc.
    case "1_1":
      return "1/1";
    case "1_X":
      return "1/X";
    case "1_2":
      return "1/2";
    case "X_1":
      return "X/1";
    case "X_X":
      return "X/X";
    case "X_2":
      return "X/2";
    case "2_1":
      return "2/1";
    case "2_X":
      return "2/X";
    case "2_2":
      return "2/2";

    // ─── Family C combos ───
    // 1x2_btts (COMBO_1X2_GG expects "1 - Sì", "X - No", etc.)
    case "home_yes":
      return "1 - Sì";
    case "home_no":
      return "1 - No";
    case "draw_yes":
      return "X - Sì";
    case "draw_no":
      return "X - No";
    case "away_yes":
      return "2 - Sì";
    case "away_no":
      return "2 - No";

    // dc_btts (COMBO_DC_GG expects "1X - Sì", etc.)
    case "1X_yes":
      return "1X - Sì";
    case "1X_no":
      return "1X - No";
    case "12_yes":
      return "12 - Sì";
    case "12_no":
      return "12 - No";
    case "X2_yes":
      return "X2 - Sì";
    case "X2_no":
      return "X2 - No";

    // dc_and_total (COMBO_DC_OU expects "1X - Over", etc.)
    case "1X_over":
      return "1X - Over";
    case "1X_under":
      return "1X - Under";
    case "12_over":
      return "12 - Over";
    case "12_under":
      return "12 - Under";
    case "X2_over":
      return "X2 - Over";
    case "X2_under":
      return "X2 - Under";

    // btts_and_total (COMBO_GG_OU expects "Sì - Over", etc. — GG first)
    case "over_yes":
      return "Sì - Over";
    case "over_no":
      return "No - Over";
    case "under_yes":
      return "Sì - Under";
    case "under_no":
      return "No - Under";

    // cs family / others → raw is already canonical
    default:
      return fallback;
  }
}
