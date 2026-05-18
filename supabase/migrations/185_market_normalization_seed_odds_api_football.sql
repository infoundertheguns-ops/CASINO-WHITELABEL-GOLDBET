-- 185: market_normalization seed for OddsAPI source, sport=football
-- Maps the 108 distinct OddsAPI football market_name values (last 7 days) to
-- canonical_key per the api-football integration spec (§4.2/§4.3).
--
-- Bucket A: score-derived, api-football canonical settle (verified=true)
-- Bucket B: statistics-derived, api-football canonical settle (verified=true)
-- Bucket C: player attribution, FS canonical settle (verified=true)
-- Non-fixable: canonical_key=NULL, verified=false (display layer hides via
--              filter canonical_key IS NOT NULL).
--
-- Generated from scripts/db/probe-all-football-markets.mjs output 2026-05-18
-- (TOTAL_ROWS=108).
--
-- NOTE: the api-football canonical naming scheme (e.g. "1x2", "totals",
-- "btts") is intentionally divorced from the legacy `canonical_markets`
-- table which was built for kambi/22bet/betfair Italian market names
-- (e.g. "1x2_ft", "u_o_ft"). We therefore drop the FK to canonical_markets
-- so these new canonical keys do not require pre-existing rows there.
-- A future migration may seed canonical_markets for the api-football scheme
-- and re-add a (deferrable) FK if cross-source canonical reconciliation is
-- needed; for now the canonical_key is a free-form tag consumed by the
-- api-football ingester settle dispatcher.
--
-- We also extend the source CHECK constraint to allow 'odds-api'.

-- 1) Relax source CHECK to allow 'odds-api' (previous set:
--    'kambi','22bet','betfair' per migration 089).
ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_normalization_source_check;
ALTER TABLE market_normalization
  ADD CONSTRAINT market_normalization_source_check
    CHECK (source = ANY (ARRAY['kambi'::text, '22bet'::text, 'betfair'::text, 'odds-api'::text]));

-- 2) Drop FK to canonical_markets — api-football canonical scheme is
--    a separate namespace (see header note). Idempotent.
ALTER TABLE market_normalization
  DROP CONSTRAINT IF EXISTS market_norm_canonical_fk;

-- 3) Bulk seed for source='odds-api' / sport football (108 rows).
INSERT INTO market_normalization
  (source, source_market_type, canonical_key, canonical_name_it, verified, extracted_by, confidence)
VALUES
  -- --- Bucket A: api-football canonical, score-derived ---
  ('odds-api', 'ML',                                  '1x2',                       'Vincente incontro',                  true, 'manual', 100),
  ('odds-api', 'Totals',                              'totals',                    'U/O Totali',                         true, 'manual', 100),
  ('odds-api', 'Double Chance',                       'double_chance',             'Doppia Chance',                      true, 'manual', 100),
  ('odds-api', 'Both Teams To Score',                 'btts',                      'Gol/NoGol',                          true, 'manual', 100),
  ('odds-api', 'Spread',                              'spread',                    'Handicap',                           true, 'manual', 100),
  ('odds-api', 'Totals HT',                           'totals_ht',                 'U/O 1° Tempo',                       true, 'manual', 100),
  ('odds-api', 'European Handicap',                   'european_handicap',         'Handicap Europeo',                   true, 'manual', 100),
  ('odds-api', 'Team Total Home',                     'team_total_home',           'Totale Casa',                        true, 'manual', 100),
  ('odds-api', 'Team Total Away',                     'team_total_away',           'Totale Ospite',                      true, 'manual', 100),
  ('odds-api', 'Draw No Bet',                         'draw_no_bet',               'Draw No Bet',                        true, 'manual', 100),
  ('odds-api', 'Correct Score',                       'correct_score',             'Risultato esatto',                   true, 'manual', 100),
  ('odds-api', 'ML 2H',                               '1x2_sh',                    '1X2 2° Tempo',                       true, 'manual', 100),
  ('odds-api', 'Spread HT',                           'spread_ht',                 'Handicap 1° Tempo',                  true, 'manual', 100),
  ('odds-api', 'Totals 2H',                           'totals_sh',                 'U/O 2° Tempo',                       true, 'manual', 100),
  ('odds-api', 'ML HT',                               '1x2_ht',                    '1X2 1° Tempo',                       true, 'manual', 100),
  ('odds-api', 'Half Time / Full Time',               'ht_ft',                     '1° Tempo / Finale',                  true, 'manual', 100),
  ('odds-api', 'Odd/Even',                            'odd_even',                  'Pari/Dispari',                       true, 'manual', 100),
  ('odds-api', 'First Team To Score',                 'first_team_to_score',       'Primo a Segnare',                    true, 'manual', 100),
  ('odds-api', 'Both Teams To Score HT',              'btts_ht',                   'Gol/NoGol 1° Tempo',                 true, 'manual', 100),
  ('odds-api', 'Goals Over/Under',                    'totals',                    'U/O Totali',                         true, 'manual', 100),
  ('odds-api', 'Half Time Result',                    '1x2_ht',                    '1X2 1° Tempo',                       true, 'manual', 100),
  ('odds-api', 'Alternative Goal Line',               'totals',                    'U/O Totali',                         true, 'manual', 100),
  ('odds-api', 'Alternative Asian Handicap',          'asian_handicap',            'Handicap Asiatico',                  true, 'manual', 100),
  ('odds-api', 'Both Teams To Score 2H',              'btts_sh',                   'Gol/NoGol 2° Tempo',                 true, 'manual', 100),
  ('odds-api', 'Alternative Total Goals',             'totals',                    'U/O Totali',                         true, 'manual', 100),
  ('odds-api', '1st Half Handicap',                   'spread_ht',                 'Handicap 1° Tempo',                  true, 'manual', 100),
  ('odds-api', 'Exact Total Goals',                   'exact_total_goals',         'Numero gol esatto',                  true, 'manual', 100),
  ('odds-api', 'Number of Goals In Match',            'number_of_goals',           'Numero gol nella partita',           true, 'manual', 100),
  ('odds-api', 'Team Total Goals Home',               'team_total_goals_home',     'Totale gol Casa',                    true, 'manual', 100),
  ('odds-api', 'Team Total Goals Away',               'team_total_goals_away',     'Totale gol Ospite',                  true, 'manual', 100),
  ('odds-api', '1st Half Goal Line',                  'totals_ht',                 'U/O 1° Tempo',                       true, 'manual', 100),
  ('odds-api', 'Team Total (Goals) Home',             'team_total_goals_home',     'Totale gol Casa',                    true, 'manual', 100),
  ('odds-api', 'Team Total (Goals) Away',             'team_total_goals_away',     'Totale gol Ospite',                  true, 'manual', 100),
  ('odds-api', '1st Half Team Total Goals Home',      'team_total_goals_home_ht',  'Totale gol Casa 1° Tempo',           true, 'manual', 100),
  ('odds-api', '1st Half Team Total Goals Away',      'team_total_goals_away_ht',  'Totale gol Ospite 1° Tempo',         true, 'manual', 100),
  ('odds-api', 'Team Total Home HT',                  'team_total_goals_home_ht',  'Totale gol Casa 1° Tempo',           true, 'manual', 100),
  ('odds-api', 'Team Total Away HT',                  'team_total_goals_away_ht',  'Totale gol Ospite 1° Tempo',         true, 'manual', 100),
  ('odds-api', 'Method of Victory',                   'method_of_victory',         'Metodo di vittoria',                 true, 'manual', 100),

  -- --- Bucket B: api-football canonical, statistics-derived ---
  ('odds-api', 'Corners Totals',                      'total_corners',             'Totale Corner',                      true, 'manual', 100),
  ('odds-api', 'Corners Spread',                      'corners_spread',            'Handicap Corner',                    true, 'manual', 100),
  ('odds-api', 'Corners Totals Away',                 'corners_totals_away',       'Totale Corner Ospite',               true, 'manual', 100),
  ('odds-api', 'Corners Totals Home',                 'corners_totals_home',       'Totale Corner Casa',                 true, 'manual', 100),
  ('odds-api', 'Corners',                             'corner_1x2',                '1X2 Corner',                         true, 'manual', 100),
  ('odds-api', 'Corners 2-Way',                       'corner_2way',               'Corner 2-Way',                       true, 'manual', 100),
  ('odds-api', 'Corners Totals HT',                   'total_corners_ht',          'Totale Corner 1° Tempo',             true, 'manual', 100),
  ('odds-api', 'Total Corners',                       'total_corners',             'Totale Corner',                      true, 'manual', 100),
  ('odds-api', 'Alternative Corners',                 'total_corners',             'Totale Corner',                      true, 'manual', 100),
  ('odds-api', 'Corner Handicap',                     'corner_handicap',           'Handicap Corner',                    true, 'manual', 100),
  ('odds-api', 'Team Corners Home',                   'corners_totals_home',       'Totale Corner Casa',                 true, 'manual', 100),
  ('odds-api', 'Team Corners Away',                   'corners_totals_away',       'Totale Corner Ospite',               true, 'manual', 100),
  ('odds-api', 'Bookings Totals',                     'bookings_totals',           'Totale Cartellini',                  true, 'manual', 100),
  ('odds-api', 'Bookings Spread',                     'bookings_spread',           'Handicap Cartellini',                true, 'manual', 100),
  ('odds-api', 'Bookings Totals Away',                'bookings_totals_away',      'Totale Cartellini Ospite',           true, 'manual', 100),
  ('odds-api', 'Bookings Totals Home',                'bookings_totals_home',      'Totale Cartellini Casa',             true, 'manual', 100),
  ('odds-api', 'Card Handicap',                       'card_handicap',             'Handicap Cartellini',                true, 'manual', 100),
  ('odds-api', 'Number of Cards In Match',            'number_of_cards',           'Numero cartellini',                  true, 'manual', 100),
  ('odds-api', 'Team Cards Away',                     'team_cards_away',           'Cartellini Ospite',                  true, 'manual', 100),
  ('odds-api', 'Team Cards Home',                     'team_cards_home',           'Cartellini Casa',                    true, 'manual', 100),
  ('odds-api', 'Total Shots Away',                    'total_shots_away',          'Totale Tiri Ospite',                 true, 'manual', 100),
  ('odds-api', 'Total Shots Home',                    'total_shots_home',          'Totale Tiri Casa',                   true, 'manual', 100),
  ('odds-api', 'Total Shots',                         'total_shots',               'Totale Tiri',                        true, 'manual', 100),
  ('odds-api', 'Team Shots Home',                     'total_shots_home',          'Totale Tiri Casa',                   true, 'manual', 100),
  ('odds-api', 'Team Shots Away',                     'total_shots_away',          'Totale Tiri Ospite',                 true, 'manual', 100),
  ('odds-api', 'Match Shots',                         'total_shots',               'Totale Tiri',                        true, 'manual', 100),
  ('odds-api', 'Total Shots on Target Away',          'total_shots_on_target_away','Totale Tiri in porta Ospite',        true, 'manual', 100),
  ('odds-api', 'Total Shots on Target Home',          'total_shots_on_target_home','Totale Tiri in porta Casa',          true, 'manual', 100),
  ('odds-api', 'Total Shots on Target',               'total_shots_on_target',     'Totale Tiri in porta',               true, 'manual', 100),
  ('odds-api', 'Match Shots on Target',               'total_shots_on_target',     'Totale Tiri in porta',               true, 'manual', 100),
  ('odds-api', 'Team Shots on Target Home',           'total_shots_on_target_home','Totale Tiri in porta Casa',          true, 'manual', 100),
  ('odds-api', 'Team Shots on Target Away',           'total_shots_on_target_away','Totale Tiri in porta Ospite',        true, 'manual', 100),
  ('odds-api', 'Most Shots on Target',                'most_shots_on_target',      'Più Tiri in porta',                  true, 'manual', 100),
  ('odds-api', 'Goalkeeper Saves',                    'goalkeeper_saves',          'Parate Portiere',                    true, 'manual', 100),
  ('odds-api', 'Goalkeeper Saves Away',               'goalkeeper_saves_away',     'Parate Portiere Ospite',             true, 'manual', 100),
  ('odds-api', 'Goalkeeper Saves Home',               'goalkeeper_saves_home',     'Parate Portiere Casa',               true, 'manual', 100),
  ('odds-api', 'Total Offsides',                      'total_offsides',            'Totale Fuorigioco',                  true, 'manual', 100),
  ('odds-api', 'Match Offsides',                      'total_offsides',            'Totale Fuorigioco',                  true, 'manual', 100),
  ('odds-api', 'Team Offsides Away',                  'team_offsides_away',        'Fuorigioco Ospite',                  true, 'manual', 100),
  ('odds-api', 'Team Offsides Home',                  'team_offsides_home',        'Fuorigioco Casa',                    true, 'manual', 100),
  ('odds-api', 'Total Fouls Away',                    'total_fouls_away',          'Totale Falli Ospite',                true, 'manual', 100),
  ('odds-api', 'Total Fouls Home',                    'total_fouls_home',          'Totale Falli Casa',                  true, 'manual', 100),
  ('odds-api', 'Total Fouls',                         'total_fouls',               'Totale Falli',                       true, 'manual', 100),

  -- --- Bucket C: FS canonical, player attribution ---
  ('odds-api', 'Anytime Goalscorer',                  'anytime_goalscorer',        'Marcatore',                          true, 'manual', 100),
  ('odds-api', 'To Score 2+ Goals',                   'to_score_2plus_goals',      'Doppietta',                          true, 'manual', 100),
  ('odds-api', 'Multi Scorers',                       'multi_scorers',             'Più marcatori',                      true, 'manual', 100),
  ('odds-api', 'Team Goalscorer',                     'team_goalscorer',           'Marcatore squadra',                  true, 'manual', 100),
  ('odds-api', 'Player Shots on Target',              'player_shots_on_target',    'Tiri in porta giocatore',            true, 'manual', 100),
  ('odds-api', 'Player Shots',                        'player_shots',              'Tiri giocatore',                     true, 'manual', 100),
  ('odds-api', 'Player To Score or Assist',           'player_to_score_or_assist', 'Gol o Assist giocatore',             true, 'manual', 100),
  ('odds-api', 'To Score 3+ Goals',                   'to_score_3plus_goals',      'Tripletta',                          true, 'manual', 100),
  ('odds-api', 'Player To Assist',                    'player_to_assist',          'Assist giocatore',                   true, 'manual', 100),
  ('odds-api', 'Player to be Booked',                 'player_to_be_booked',       'Giocatore ammonito',                 true, 'manual', 100),
  ('odds-api', 'Player Cards',                        'player_to_be_booked',       'Giocatore ammonito',                 true, 'manual', 100),
  ('odds-api', 'Player Fouls',                        'player_fouls',              'Falli giocatore',                    true, 'manual', 100),
  ('odds-api', 'Player Fouls Committed',              'player_fouls',              'Falli giocatore',                    true, 'manual', 100),
  ('odds-api', 'Player To Be Fouled',                 'player_to_be_fouled',       'Falli subiti giocatore',             true, 'manual', 100),
  ('odds-api', 'Player Tackles',                      'player_tackles',            'Contrasti giocatore',                true, 'manual', 100),
  ('odds-api', 'Player Passes',                       'player_passes',             'Passaggi giocatore',                 true, 'manual', 100),
  ('odds-api', 'Goal Method',                         'goal_method',               'Modalità gol',                       true, 'manual', 100),

  -- --- Non-fixable: canonical_key NULL, verified=false ---
  ('odds-api', 'Specials',                            NULL,                        'Mercati speciali',                   false, 'manual', 100),
  ('odds-api', 'Player Props',                        NULL,                        'Quote giocatore (generico)',         false, 'manual', 100),
  ('odds-api', 'Player of the Match',                 NULL,                        'Giocatore del match',                false, 'manual', 100),
  ('odds-api', 'Corners Race',                        NULL,                        'Corsa ai corner',                    false, 'manual', 100),
  ('odds-api', 'Player Shots on Target Outside Box',  NULL,                        'Tiri in porta fuori area giocatore', false, 'manual', 100),
  ('odds-api', 'Player Headed Shots on Target',       NULL,                        'Tiri in porta di testa giocatore',   false, 'manual', 100),
  ('odds-api', 'Team Tackles Home',                   NULL,                        'Contrasti Casa',                     false, 'manual', 100),
  ('odds-api', 'Team Tackles Away',                   NULL,                        'Contrasti Ospite',                   false, 'manual', 100),
  ('odds-api', 'Match Tackles',                       NULL,                        'Totale Contrasti',                   false, 'manual', 100),
  ('odds-api', 'First 10 Minutes (00:00 - 09:59)',    NULL,                        'Primi 10 minuti',                    false, 'manual', 100)

ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key     = EXCLUDED.canonical_key,
      canonical_name_it = EXCLUDED.canonical_name_it,
      verified          = EXCLUDED.verified,
      extracted_by      = EXCLUDED.extracted_by,
      confidence        = EXCLUDED.confidence,
      updated_at        = now();

-- Rollback:
--   DELETE FROM market_normalization WHERE source = 'odds-api';
--   ALTER TABLE market_normalization DROP CONSTRAINT IF EXISTS market_normalization_source_check;
--   ALTER TABLE market_normalization ADD CONSTRAINT market_normalization_source_check
--     CHECK (source = ANY (ARRAY['kambi'::text, '22bet'::text, 'betfair'::text]));
--   (FK to canonical_markets is intentionally NOT restored — see header note.)
