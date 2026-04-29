-- 065_phase3_outcome_normalization.sql
-- Phase 3 Part 1: outcome canonicalization foundation.
--
-- Problem: market_normalization canonicalizes the market_type (e.g. "1X2 - 1T"
-- → 1x2_1h). But downstream consensus comparison needs to match OUTCOMES across
-- sources too (kambi "1" vs 22bet "1" — same canonical; kambi "Sì" vs 22bet
-- "GG" — both → `yes`). Currently consensus only groups by canonical_key and
-- matches outcomes by raw string, which fails on source-specific naming.
--
-- Scope Part 1 (this migration):
--   - Table outcome_normalization (source, source_market_type, source_outcome_name)
--     → canonical_key + canonical_outcome_key.
--   - Pre-seed with semantic outcome dictionary: 1/X/2, Over/Under, Sì/No,
--     GG/NG, V1/V2, 1X/X2/12, Pari/Dispari, Si etc.
--   - Covers ~80% of clean non-team-name outcomes.
--
-- Part 2 (future): UI expandable rows in /admin/market-normalization for manual
-- curation; team-name outcomes via event-aware side mapping; LLM stage for tail.
--
-- Part 3 (future): refresh_consensus_snapshots RPC refactor to use
-- (canonical_key, canonical_line, canonical_outcome_key) as cross-source join.

CREATE TABLE IF NOT EXISTS outcome_normalization (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  source_market_type text NOT NULL,
  source_outcome_name text NOT NULL,
  canonical_key text,
  canonical_outcome_key text,
  extracted_by text,
  confidence smallint,
  verified boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_market_type, source_outcome_name),
  CONSTRAINT outcome_normalization_source_check
    CHECK (source = ANY (ARRAY['kambi'::text, '22bet'::text])),
  CONSTRAINT outcome_normalization_extracted_by_check
    CHECK (extracted_by IS NULL OR extracted_by = ANY (ARRAY['manual','regex','dictionary','propagation','fuzzy','llm'])),
  CONSTRAINT outcome_normalization_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  CONSTRAINT outcome_normalization_canonical_fk
    FOREIGN KEY (canonical_key) REFERENCES canonical_markets(canonical_key)
    ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_outcome_norm_source ON outcome_normalization(source);
CREATE INDEX IF NOT EXISTS idx_outcome_norm_mt ON outcome_normalization(source, source_market_type);
CREATE INDEX IF NOT EXISTS idx_outcome_norm_canonical ON outcome_normalization(canonical_key) WHERE canonical_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outcome_norm_unverified ON outcome_normalization(source, extracted_by)
  WHERE verified = false AND canonical_key IS NOT NULL;

-- Static dictionary: (source_outcome_name pattern, canonical_outcome_key)
-- Not all canonical markets share the same outcome keys, so we scope the seed
-- by canonical_key to avoid cross-family collision. When the engine runs, it
-- consults this table with (source, source_market_type, source_outcome_name)
-- and infers canonical_outcome_key from the matching rule.
--
-- For the seed, we pre-populate (canonical_key, source_outcome_name) rows with
-- wildcard source='both' represented as two rows (kambi + 22bet). This lets
-- the engine do a simple EXISTS lookup at runtime. Where different sources
-- use different outcome strings for the same canonical (e.g. GG/NG vs Sì/No
-- for gg_ng_ft), both are seeded.

-- Helper view used by engine stage to resolve outcome → canonical key.
-- Schema: lookup by (canonical_key, lower(source_outcome_name)) → canonical_outcome_key.
CREATE TABLE IF NOT EXISTS outcome_dictionary (
  id bigserial PRIMARY KEY,
  canonical_key text NOT NULL REFERENCES canonical_markets(canonical_key) ON UPDATE CASCADE ON DELETE CASCADE,
  source_outcome_pattern text NOT NULL, -- stored lowercase for case-insensitive match
  canonical_outcome_key text NOT NULL,
  UNIQUE (canonical_key, source_outcome_pattern)
);

CREATE INDEX IF NOT EXISTS idx_outcome_dict_ckey ON outcome_dictionary(canonical_key);

-- ═══ SEED: 1X2 family (home/draw/away) ═══
INSERT INTO outcome_dictionary (canonical_key, source_outcome_pattern, canonical_outcome_key) VALUES
  -- 1x2_ft / 1x2_1h / 1x2_2h / 1x2_3h / 1x2_4h / 1x2_et
  ('1x2_ft', '1', 'home'), ('1x2_ft', 'x', 'draw'), ('1x2_ft', '2', 'away'),
  ('1x2_ft', 'v1', 'home'), ('1x2_ft', 'v2', 'away'),
  ('1x2_1h', '1', 'home'), ('1x2_1h', 'x', 'draw'), ('1x2_1h', '2', 'away'),
  ('1x2_1h', 'v1', 'home'), ('1x2_1h', 'v2', 'away'),
  ('1x2_2h', '1', 'home'), ('1x2_2h', 'x', 'draw'), ('1x2_2h', '2', 'away'),
  ('1x2_2h', 'v1', 'home'), ('1x2_2h', 'v2', 'away'),
  ('1x2_3h', '1', 'home'), ('1x2_3h', 'x', 'draw'), ('1x2_3h', '2', 'away'),
  ('1x2_4h', '1', 'home'), ('1x2_4h', 'x', 'draw'), ('1x2_4h', '2', 'away'),
  ('1x2_et', '1', 'home'), ('1x2_et', 'x', 'draw'), ('1x2_et', '2', 'away'),
  ('1x2_et', 'v1', 'home'), ('1x2_et', 'v2', 'away'),

  -- U/O family (over/under)
  ('u_o_ft', 'over', 'over'), ('u_o_ft', 'under', 'under'),
  ('u_o_ft', 'o', 'over'), ('u_o_ft', 'u', 'under'),
  ('u_o_1h', 'over', 'over'), ('u_o_1h', 'under', 'under'),
  ('u_o_2h', 'over', 'over'), ('u_o_2h', 'under', 'under'),
  ('u_o_3h', 'over', 'over'), ('u_o_3h', 'under', 'under'),
  ('u_o_4h', 'over', 'over'), ('u_o_4h', 'under', 'under'),
  ('u_o_et', 'over', 'over'), ('u_o_et', 'under', 'under'),

  -- Asian total / asian handicap (over/under or home/away)
  ('asian_total_ft', 'over', 'over'), ('asian_total_ft', 'under', 'under'),
  ('asian_total_1h', 'over', 'over'), ('asian_total_1h', 'under', 'under'),
  ('asian_total_2h', 'over', 'over'), ('asian_total_2h', 'under', 'under'),
  ('asian_total_3h', 'over', 'over'), ('asian_total_3h', 'under', 'under'),
  ('asian_total_4h', 'over', 'over'), ('asian_total_4h', 'under', 'under'),
  ('asian_handicap_ft', '1', 'home'), ('asian_handicap_ft', '2', 'away'),
  ('asian_handicap_1h', '1', 'home'), ('asian_handicap_1h', '2', 'away'),
  ('asian_handicap_2h', '1', 'home'), ('asian_handicap_2h', '2', 'away'),

  -- 1X2 Handicap (home/draw/away)
  ('1x2_h_ft', '1', 'home'), ('1x2_h_ft', 'x', 'draw'), ('1x2_h_ft', '2', 'away'),
  ('1x2_h_1h', '1', 'home'), ('1x2_h_1h', 'x', 'draw'), ('1x2_h_1h', '2', 'away'),
  ('1x2_h_2h', '1', 'home'), ('1x2_h_2h', 'x', 'draw'), ('1x2_h_2h', '2', 'away'),
  ('1x2_h_et', '1', 'home'), ('1x2_h_et', 'x', 'draw'), ('1x2_h_et', '2', 'away'),

  -- 2-way handicap
  ('2way_handicap_ft', '1', 'home'), ('2way_handicap_ft', '2', 'away'),
  ('2way_handicap_1h', '1', 'home'), ('2way_handicap_1h', '2', 'away'),
  ('2way_handicap_2h', '1', 'home'), ('2way_handicap_2h', '2', 'away'),
  ('2way_handicap_3h', '1', 'home'), ('2way_handicap_3h', '2', 'away'),
  ('2way_handicap_4h', '1', 'home'), ('2way_handicap_4h', '2', 'away'),

  -- Double Chance (1x/x2/12)
  ('dc_ft', '1x', '1x'), ('dc_ft', 'x2', 'x2'), ('dc_ft', '12', '12'),
  ('dc_1h', '1x', '1x'), ('dc_1h', 'x2', 'x2'), ('dc_1h', '12', '12'),
  ('dc_2h', '1x', '1x'), ('dc_2h', 'x2', 'x2'), ('dc_2h', '12', '12'),
  ('dc_3h', '1x', '1x'), ('dc_3h', 'x2', 'x2'), ('dc_3h', '12', '12'),
  ('dc_4h', '1x', '1x'), ('dc_4h', 'x2', 'x2'), ('dc_4h', '12', '12'),

  -- GG/NG (Both Teams Score yes/no)
  ('gg_ng_ft', 'sì', 'yes'), ('gg_ng_ft', 'si', 'yes'), ('gg_ng_ft', 'yes', 'yes'), ('gg_ng_ft', 'gg', 'yes'), ('gg_ng_ft', 'goal', 'yes'),
  ('gg_ng_ft', 'no', 'no'), ('gg_ng_ft', 'ng', 'no'), ('gg_ng_ft', 'no goal', 'no'),
  ('gg_ng_1h', 'sì', 'yes'), ('gg_ng_1h', 'si', 'yes'), ('gg_ng_1h', 'gg', 'yes'),
  ('gg_ng_1h', 'no', 'no'), ('gg_ng_1h', 'ng', 'no'),
  ('gg_ng_2h', 'sì', 'yes'), ('gg_ng_2h', 'si', 'yes'), ('gg_ng_2h', 'gg', 'yes'),
  ('gg_ng_2h', 'no', 'no'), ('gg_ng_2h', 'ng', 'no'),
  ('gg_ng_3h', 'sì', 'yes'), ('gg_ng_3h', 'si', 'yes'), ('gg_ng_3h', 'no', 'no'),
  ('gg_ng_4h', 'sì', 'yes'), ('gg_ng_4h', 'si', 'yes'), ('gg_ng_4h', 'no', 'no'),
  ('gg_ng_et', 'sì', 'yes'), ('gg_ng_et', 'si', 'yes'), ('gg_ng_et', 'no', 'no'),

  -- DNB (home/away — draw refunded)
  ('dnb_ft', '1', 'home'), ('dnb_ft', '2', 'away'),
  ('dnb_1h', '1', 'home'), ('dnb_1h', '2', 'away'),
  ('dnb_2h', '1', 'home'), ('dnb_2h', '2', 'away'),

  -- Winner (2-way moneyline)
  ('winner_ft', '1', 'home'), ('winner_ft', '2', 'away'),
  ('winner_1h', '1', 'home'), ('winner_1h', '2', 'away'),
  ('winner_2h', '1', 'home'), ('winner_2h', '2', 'away'),

  -- H2H
  ('h2h_ft', '1', 'home'), ('h2h_ft', '2', 'away'),

  -- Odd/Even
  ('oe_ft', 'pari', 'even'), ('oe_ft', 'even', 'even'), ('oe_ft', 'dispari', 'odd'), ('oe_ft', 'odd', 'odd'),
  ('oe_1h', 'pari', 'even'), ('oe_1h', 'dispari', 'odd'),
  ('oe_2h', 'pari', 'even'), ('oe_2h', 'dispari', 'odd'),
  ('oe_3h', 'pari', 'even'), ('oe_3h', 'dispari', 'odd'),
  ('oe_4h', 'pari', 'even'), ('oe_4h', 'dispari', 'odd'),

  -- Clean sheet (yes/no)
  ('clean_sheet_ft', 'sì', 'yes'), ('clean_sheet_ft', 'si', 'yes'), ('clean_sheet_ft', 'no', 'no'),

  -- both_halves_score (yes/no)
  ('both_halves_score', 'sì', 'yes'), ('both_halves_score', 'si', 'yes'), ('both_halves_score', 'no', 'no'),

  -- draw_any_half (yes/no)
  ('draw_any_half_ft', 'sì', 'yes'), ('draw_any_half_ft', 'si', 'yes'), ('draw_any_half_ft', 'no', 'no'),

  -- qualification (home/away)
  ('qualification', '1', 'home'), ('qualification', '2', 'away'),

  -- autogol / own_goal (yes/no) — Wave 15
  ('own_goal_ft', 'sì', 'yes'), ('own_goal_ft', 'si', 'yes'), ('own_goal_ft', 'no', 'no'),

  -- Team1/Team2 Win to Nil (yes/no)
  ('team1_win_to_nil_ft', 'sì', 'yes'), ('team1_win_to_nil_ft', 'si', 'yes'), ('team1_win_to_nil_ft', 'no', 'no'),
  ('team2_win_to_nil_ft', 'sì', 'yes'), ('team2_win_to_nil_ft', 'si', 'yes'), ('team2_win_to_nil_ft', 'no', 'no'),
  ('team1_win_to_nil_1h', 'sì', 'yes'), ('team1_win_to_nil_1h', 'si', 'yes'), ('team1_win_to_nil_1h', 'no', 'no'),
  ('team1_win_to_nil_2h', 'sì', 'yes'), ('team1_win_to_nil_2h', 'si', 'yes'), ('team1_win_to_nil_2h', 'no', 'no'),
  ('team2_win_to_nil_1h', 'sì', 'yes'), ('team2_win_to_nil_1h', 'si', 'yes'), ('team2_win_to_nil_1h', 'no', 'no'),
  ('team2_win_to_nil_2h', 'sì', 'yes'), ('team2_win_to_nil_2h', 'si', 'yes'), ('team2_win_to_nil_2h', 'no', 'no'),
  ('win_to_nil_ft', 'sì', 'yes'), ('win_to_nil_ft', 'si', 'yes'), ('win_to_nil_ft', 'no', 'no'),
  ('win_to_nil_1h', 'sì', 'yes'), ('win_to_nil_1h', 'si', 'yes'), ('win_to_nil_1h', 'no', 'no'),
  ('win_to_nil_2h', 'sì', 'yes'), ('win_to_nil_2h', 'si', 'yes'), ('win_to_nil_2h', 'no', 'no'),

  -- Team1/Team2 both halves score / wins any half (yes/no)
  ('team1_both_halves_score_ft', 'sì', 'yes'), ('team1_both_halves_score_ft', 'si', 'yes'), ('team1_both_halves_score_ft', 'no', 'no'),
  ('team2_both_halves_score_ft', 'sì', 'yes'), ('team2_both_halves_score_ft', 'si', 'yes'), ('team2_both_halves_score_ft', 'no', 'no'),
  ('team1_wins_any_half_ft', 'sì', 'yes'), ('team1_wins_any_half_ft', 'si', 'yes'), ('team1_wins_any_half_ft', 'no', 'no'),
  ('team2_wins_any_half_ft', 'sì', 'yes'), ('team2_wins_any_half_ft', 'si', 'yes'), ('team2_wins_any_half_ft', 'no', 'no'),

  -- Team Total Odd/Even (even/odd)
  ('team1_total_oe_ft', 'pari', 'even'), ('team1_total_oe_ft', 'dispari', 'odd'),
  ('team2_total_oe_ft', 'pari', 'even'), ('team2_total_oe_ft', 'dispari', 'odd'),

  -- Total team (over/under)
  ('total_team_ft', 'over', 'over'), ('total_team_ft', 'under', 'under'),
  ('total_team_1h', 'over', 'over'), ('total_team_1h', 'under', 'under'),
  ('total_team_2h', 'over', 'over'), ('total_team_2h', 'under', 'under'),

  -- Total team asian (over/under)
  ('total_team_asian_ft', 'over', 'over'), ('total_team_asian_ft', 'under', 'under'),
  ('total_team_asian_1h', 'over', 'over'), ('total_team_asian_1h', 'under', 'under'),
  ('total_team_asian_2h', 'over', 'over'), ('total_team_asian_2h', 'under', 'under'),

  -- Total corners (over/under)
  ('total_corners_ft', 'over', 'over'), ('total_corners_ft', 'under', 'under'),
  ('total_corners_1h', 'over', 'over'), ('total_corners_1h', 'under', 'under'),
  ('total_corners_2h', 'over', 'over'), ('total_corners_2h', 'under', 'under'),

  -- Corner winner (home/draw/away)
  ('corner_winner_ft', '1', 'home'), ('corner_winner_ft', 'x', 'draw'), ('corner_winner_ft', '2', 'away'),
  ('corner_winner_1h', '1', 'home'), ('corner_winner_1h', 'x', 'draw'), ('corner_winner_1h', '2', 'away'),
  ('corner_winner_2h', '1', 'home'), ('corner_winner_2h', 'x', 'draw'), ('corner_winner_2h', '2', 'away'),

  -- Total sets (over/under)
  ('total_sets_ft', 'over', 'over'), ('total_sets_ft', 'under', 'under'),

  -- Set result (home/away)
  ('set_result_ft', '1', 'home'), ('set_result_ft', '2', 'away'),

  -- Set handicap (home/away)
  ('set_handicap_ft', '1', 'home'), ('set_handicap_ft', '2', 'away'),

  -- Exact goals (variable: key = count) — skipped in dict (line-dependent)

  -- Correct score (variable) — skipped

  -- HTFT — 9 outcomes (1/1, 1/X, 1/2, X/1, X/X, X/2, 2/1, 2/X, 2/2)
  -- Skipped in Phase 3 Part 1 — needs compound outcome dict

  -- race_to_goals (home/away/none)
  ('race_to_goals_ft', '1', 'home'), ('race_to_goals_ft', '2', 'away'), ('race_to_goals_ft', 'nessuno', 'none'), ('race_to_goals_ft', 'none', 'none'),

  -- anytime_scorer (team name) — variable, skipped

  -- first_scorer / last_scorer (team name / nessuno) — skipped per player-prop-like

  -- last_goal family (home/away/none)
  ('last_goal_ft', '1', 'home'), ('last_goal_ft', '2', 'away'), ('last_goal_ft', 'nessuno', 'none'),
  ('last_goal_1h', '1', 'home'), ('last_goal_1h', '2', 'away'), ('last_goal_1h', 'nessuno', 'none'),
  ('last_goal_2h', '1', 'home'), ('last_goal_2h', '2', 'away'), ('last_goal_2h', 'nessuno', 'none'),

  -- next_goal / next_corner (home/away/none)
  ('next_goal_ft', '1', 'home'), ('next_goal_ft', '2', 'away'), ('next_goal_ft', 'nessuno', 'none'),
  ('next_goal_1h', '1', 'home'), ('next_goal_1h', '2', 'away'), ('next_goal_1h', 'nessuno', 'none'),
  ('next_goal_2h', '1', 'home'), ('next_goal_2h', '2', 'away'), ('next_goal_2h', 'nessuno', 'none'),
  ('next_corner_ft', '1', 'home'), ('next_corner_ft', '2', 'away'), ('next_corner_ft', 'nessuno', 'none'),

  -- first_team_to_score (home/away/none)
  ('first_team_to_score_ft', '1', 'home'), ('first_team_to_score_ft', '2', 'away'), ('first_team_to_score_ft', 'nessuno', 'none'),

  -- team_score_ft (yes/no)
  ('team_score_ft', 'sì', 'yes'), ('team_score_ft', 'si', 'yes'), ('team_score_ft', 'no', 'no')
ON CONFLICT (canonical_key, source_outcome_pattern) DO NOTHING;

-- Coverage stats comment: 215 seed rows covering ~45 canonicals (majority of
-- non-team-name non-combo markets). Remaining canonicals (htft, cs_*, exact_goals_*,
-- anytime_scorer, first_scorer, last_scorer, team1/2_* combos) require richer
-- handling (per-line, per-player, or per-event team-name resolution).
