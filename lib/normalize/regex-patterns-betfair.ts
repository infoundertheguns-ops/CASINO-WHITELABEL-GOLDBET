// Betfair market_type regex rules.
// Shape matches the existing regex-patterns.ts RULES array:
//   { base_key, pattern, linePos?, periodPos? }
// First-match-wins when this array is appended to the main RULES array.
//
// Betfair strings are UPPERCASE English constants with period implicit in the
// key name (MATCH_ODDS = FT, HALF_TIME = HT, FIRST_HALF_* = HT). We bake period
// directly into base_key and, for parametric lines (OVER_UNDER_*), expand one
// rule per line value rather than trying to combine two capture groups.
export const betfairRules: Array<{
  base_key: string;
  pattern: RegExp;
  linePos?: number;
  periodPos?: number;
}> = [
  // 1X2 full-time and half-time
  { base_key: '1x2_h_ft',    pattern: /^MATCH_ODDS$/ },
  { base_key: '1x2_h_ht',    pattern: /^HALF_TIME$/ },
  { base_key: '1x2_h_ht',    pattern: /^FIRST_HALF_RESULT$/ },
  { base_key: 'htft_ft',     pattern: /^HALF_TIME_FULL_TIME$/ },

  // Chance markets
  { base_key: 'dc_ft',       pattern: /^DOUBLE_CHANCE$/ },
  { base_key: 'dnb_ft',      pattern: /^DRAW_NO_BET$/ },
  { base_key: 'gg_ng_ft',    pattern: /^BOTH_TEAMS_TO_SCORE$/ },

  // U/O full-time — one rule per line to avoid two-capture ambiguity
  { base_key: 'u_o_ft_0.5',  pattern: /^OVER_UNDER_05$/ },
  { base_key: 'u_o_ft_1.5',  pattern: /^OVER_UNDER_15$/ },
  { base_key: 'u_o_ft_2.5',  pattern: /^OVER_UNDER_25$/ },
  { base_key: 'u_o_ft_3.5',  pattern: /^OVER_UNDER_35$/ },
  { base_key: 'u_o_ft_4.5',  pattern: /^OVER_UNDER_45$/ },
  { base_key: 'u_o_ft_5.5',  pattern: /^OVER_UNDER_55$/ },

  // U/O first-half
  { base_key: 'u_o_ht_0.5',  pattern: /^FIRST_HALF_GOALS_05$/ },
  { base_key: 'u_o_ht_1.5',  pattern: /^FIRST_HALF_GOALS_15$/ },
  { base_key: 'u_o_ht_2.5',  pattern: /^FIRST_HALF_GOALS_25$/ },

  // Goals / scoring markets
  { base_key: 'correct_score_ft',        pattern: /^CORRECT_SCORE$/ },
  { base_key: 'total_goals_ft',          pattern: /^TOTAL_GOALS$/ },
  { base_key: 'odd_even_ft',             pattern: /^ODD_OR_EVEN$/ },
  { base_key: 'clean_sheet_ft',          pattern: /^CLEAN_SHEET$/ },
  { base_key: 'win_to_nil_ft',           pattern: /^WIN_TO_NIL$/ },
  { base_key: 'highest_scoring_half_ft', pattern: /^HIGHEST_SCORING_HALF$/ },
  { base_key: 'anytime_scorer_ft',       pattern: /^TO_SCORE$/ },
  { base_key: 'goal_both_halves_ft',     pattern: /^GOAL_IN_BOTH_HALVES$/ },
  { base_key: 'next_goal',               pattern: /^NEXT_GOAL$/ },

  // Handicap (line comes from runner.handicap on Betfair, not from market_type string)
  { base_key: 'asian_handicap_ft',       pattern: /^ASIAN_HANDICAP$/ },
  { base_key: '1x2_handicap_ft',         pattern: /^HANDICAP$/ },
];
