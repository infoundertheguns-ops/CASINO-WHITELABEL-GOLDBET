import { describe, it, expect } from 'vitest';
import { betfairRules } from '../../../lib/normalize/regex-patterns-betfair';

function applyFirstMatch(input: string): { base_key: string | null } {
  for (const rule of betfairRules) {
    if (input.match(rule.pattern)) return { base_key: rule.base_key };
  }
  return { base_key: null };
}

describe('betfairRules — base_key mapping', () => {
  const cases: Array<[string, string]> = [
    ['MATCH_ODDS',                '1x2_h_ft'],
    ['HALF_TIME',                 '1x2_h_ht'],
    ['FIRST_HALF_RESULT',         '1x2_h_ht'],
    ['HALF_TIME_FULL_TIME',       'htft_ft'],
    ['DOUBLE_CHANCE',             'dc_ft'],
    ['DRAW_NO_BET',               'dnb_ft'],
    ['BOTH_TEAMS_TO_SCORE',       'gg_ng_ft'],
    ['OVER_UNDER_05',             'u_o_ft_0.5'],
    ['OVER_UNDER_15',             'u_o_ft_1.5'],
    ['OVER_UNDER_25',             'u_o_ft_2.5'],
    ['OVER_UNDER_35',             'u_o_ft_3.5'],
    ['OVER_UNDER_45',             'u_o_ft_4.5'],
    ['OVER_UNDER_55',             'u_o_ft_5.5'],
    ['FIRST_HALF_GOALS_05',       'u_o_ht_0.5'],
    ['FIRST_HALF_GOALS_15',       'u_o_ht_1.5'],
    ['FIRST_HALF_GOALS_25',       'u_o_ht_2.5'],
    ['CORRECT_SCORE',             'correct_score_ft'],
    ['TOTAL_GOALS',               'total_goals_ft'],
    ['ODD_OR_EVEN',               'odd_even_ft'],
    ['CLEAN_SHEET',               'clean_sheet_ft'],
    ['WIN_TO_NIL',                'win_to_nil_ft'],
    ['HIGHEST_SCORING_HALF',      'highest_scoring_half_ft'],
    ['TO_SCORE',                  'anytime_scorer_ft'],
    ['GOAL_IN_BOTH_HALVES',       'goal_both_halves_ft'],
    ['NEXT_GOAL',                 'next_goal'],
    ['ASIAN_HANDICAP',            'asian_handicap_ft'],
    ['HANDICAP',                  '1x2_handicap_ft'],
  ];

  it.each(cases)('%s -> %s', (input, expected) => {
    expect(applyFirstMatch(input).base_key).toBe(expected);
  });
});

describe('betfairRules — negative matches', () => {
  it('does not match garbage', () => {
    expect(applyFirstMatch('RANDOM_UNKNOWN_KEY').base_key).toBeNull();
  });
  it('does not match Kambi Italian strings', () => {
    expect(applyFirstMatch('1X2').base_key).toBeNull();
    expect(applyFirstMatch('U/O 2.5').base_key).toBeNull();
  });
  it('does not match with trailing whitespace (strict anchors)', () => {
    expect(applyFirstMatch('MATCH_ODDS ').base_key).toBeNull();
  });
});
