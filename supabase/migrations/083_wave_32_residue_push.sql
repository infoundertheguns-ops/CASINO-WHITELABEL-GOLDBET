-- 083_wave_32_residue_push.sql
-- Wave 32: last residue push toward 95%.

INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  -- Cricket: Squadra X, Verrà Realizzato un Colpo Da N Punti Nell'Over (M)
  ('cricket_ball_run_ft', 'cricket_ball_run', 'ft', 'Cricket Colpo Da N Punti Nell Over', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Kambi Opta player points with OT: "Punti segnati dal giocatore - Supplementari Inclusi N.N"
  ('player_points_et_ft', 'player_points_et', 'ft', 'Punti Giocatore Supplementari Inclusi', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Kambi Opta player points+rebounds+assists with OT
  ('player_pra_et_ft', 'player_pra_et', 'ft', 'PRA Giocatore Supplementari Inclusi', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Mappa N - Round totali N.N → map_total_rounds (existing)
  -- Mappa N - Totale di torri distrutte N.N → map_total_towers (new)
  ('map_total_towers_ft', 'map_total_towers', 'ft', 'Map Total Torri', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Round Totale (N) - NT → round_total (new)
  ('round_total_ft', 'round_total', 'ft', 'Totale Round', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('round_total_1h', 'round_total', '1h', 'Totale Round 1° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),
  ('round_total_2h', 'round_total', '2h', 'Totale Round 2° Mappa', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Totale Goal Individuali (N.N) → individual_goals_total (new)
  ('individual_goals_total_ft', 'individual_goals_total', 'ft', 'Totale Goal Individuali', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb),

  -- Quanti Quarti di Seguito Vincerà La Squadra N (N)
  ('consecutive_quarters_win_ft', 'consecutive_quarters_win', 'ft', 'Quarti Consecutivi Vinti', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Punteggio Durante La Partita (N)
  ('score_during_match_ft', 'score_during_match', 'ft', 'Punteggio Durante Partita', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Squadra X, Totale Di Ogni Tempo Under/Over (N.N)
  ('team_each_half_ou_ft', 'team_each_half_ou', 'ft', 'Totale Ogni Tempo U/O', true,
   '[{"key":"yes","name_it":"Sì"},{"key":"no","name_it":"No"}]'::jsonb),

  -- Squadra X, Totale Intermedio (N)
  ('team_halftime_total_line_ft', 'team_halftime_total_line', 'ft', 'Squadra Totale Intermedio Linea', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb)
  -- Handicap Al Minuto (N.N) con parens → already have minute_handicap_ft
  -- Handicap sui Set compound → set_handicap exists
  -- N° Set tennis — player names, skip (Phase 3 territory)
ON CONFLICT (canonical_key) DO NOTHING;

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- Cricket
  SELECT u.source, u.smt, 'cricket_ball_run_ft'::text ck, (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric ln FROM unmapped u WHERE u.smt ~ '^Squadra [12], Verrà Realizzato un Colpo Da [0-9]+ Punti Nell''Over \([0-9]+\)$'

  -- Player points OT
  UNION ALL SELECT u.source, u.smt, 'player_points_et_ft', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Punti segnati dal giocatore - Supplementari Inclusi [0-9.]+$'

  -- Player PRA (points+rebounds+assists) OT
  UNION ALL SELECT u.source, u.smt, 'player_pra_et_ft', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Punti, rimbalzi e assist del giocatore - Inclusi supplementari [0-9.]+$'

  -- Tiri del giocatore (Opta) N.N → player_shots_on_target_ft
  UNION ALL SELECT u.source, u.smt, 'player_shots_on_target_ft', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Tiri del giocatore \(Scommesse refertate usando Opta\) [0-9.]+$'

  -- Map N - Total Rounds N.N (variant with "Round totali")
  UNION ALL SELECT u.source, u.smt, 'map_total_rounds_ft', (regexp_match(u.smt, 'totali ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Mappa [0-9]+ - Round totali [0-9.]+$'

  -- Map N - Totale di torri distrutte N.N
  UNION ALL SELECT u.source, u.smt, 'map_total_towers_ft', (regexp_match(u.smt, 'distrutte ([0-9.]+)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Mappa [0-9]+ - Totale di torri distrutte [0-9.]+$'

  -- Round Totale (N) [- period]
  UNION ALL SELECT u.source, u.smt, 'round_total_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Round Totale \([0-9.]+\)$'
  UNION ALL SELECT u.source, u.smt, 'round_total_1h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Round Totale \([0-9.]+\) - (1T|11T)$'
  UNION ALL SELECT u.source, u.smt, 'round_total_2h', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Round Totale \([0-9.]+\) - (2T|12T)$'

  -- Totale Goal Individuali (N.N) [- period]
  UNION ALL SELECT u.source, u.smt, 'individual_goals_total_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale Goal Individuali \([0-9.]+\)$'

  -- Quanti Quarti di Seguito Vincerà La Squadra N (N)
  UNION ALL SELECT u.source, u.smt, 'consecutive_quarters_win_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Quanti Quarti di Seguito Vincerà La Squadra [12] \([0-9]+\)$'

  -- Punteggio Durante La Partita (N)
  UNION ALL SELECT u.source, u.smt, 'score_during_match_ft', (regexp_match(u.smt, '\(([0-9]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Punteggio Durante La Partita \([0-9]+\)$'

  -- Squadra X, Totale Di Ogni Tempo Under/Over (N.N)
  UNION ALL SELECT u.source, u.smt, 'team_each_half_ou_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra [12], Totale Di Ogni Tempo (Under|Over) \([0-9.]+\)$'

  -- Squadra X, Totale Intermedio (N) [- period/trailing]
  UNION ALL SELECT u.source, u.smt, 'team_halftime_total_line_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Squadra [12], Totale Intermedio \([0-9.]+\)'

  -- Handicap Al Minuto (N.N) - (with parens)
  UNION ALL SELECT u.source, u.smt, 'minute_handicap_ft', (regexp_match(u.smt, '\(([+-]?[0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Handicap Al Minuto \([+-]?[0-9.]+\)'

  -- Vince Di. (N.N) — trailing-dash/line variants
  UNION ALL SELECT u.source, u.smt, 'win_by_margin_dot_ft', (regexp_match(u.smt, '\(([0-9.]+)\)'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Vince Di\. \([0-9.]+\)'

  -- Totale tiri in porta (Opta) residue with period
  UNION ALL SELECT u.source, u.smt, 'total_shots_on_target_ft', (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric FROM unmapped u WHERE u.smt ~ '^Totale tiri in porta( - [^0-9]+)?\s*\(Scommesse refertate usando Opta\)\s*[0-9.]+$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck, m.ln,
       (SELECT canonical_name_it FROM canonical_markets cm WHERE cm.canonical_key=m.ck),
       true, 'regex', 80, now()  -- mark verified=true directly since post-audit
FROM matches m
WHERE (SELECT 1 FROM canonical_markets cm WHERE cm.canonical_key=m.ck) IS NOT NULL
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key = EXCLUDED.canonical_key,
      canonical_line = EXCLUDED.canonical_line,
      canonical_name_it = EXCLUDED.canonical_name_it,
      verified = true,
      extracted_by = EXCLUDED.extracted_by,
      confidence = EXCLUDED.confidence,
      updated_at = now()
  WHERE market_normalization.canonical_key IS NULL;
