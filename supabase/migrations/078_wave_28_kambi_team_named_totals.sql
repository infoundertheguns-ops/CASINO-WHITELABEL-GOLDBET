-- 078_wave_28_kambi_team_named_totals.sql
-- Wave 28: Kambi team-named totals bulk seed (same semantic as Wave 23 for 22bet).
-- Kambi emits "Gol totali - <team> [- <period>] <line>" and
-- "Angoli totali - <team> [- <period>] <line>", etc.
-- Map to total_team_{ft/1h/2h} / total_corners_{ft/1h/2h} etc. (team distinction
-- lost, same design as Wave 23 — consensus at canonical level, not team name).

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
matches AS (
  -- Gol totali - <team> [- <period>] <line>
  SELECT u.source, u.smt,
    CASE
      WHEN smt ~ ' - 1° Tempo [0-9.]+$' THEN 'total_team_1h'
      WHEN smt ~ ' - 2° Tempo [0-9.]+$' THEN 'total_team_2h'
      WHEN smt ~ ' - 3° Tempo [0-9.]+$' THEN 'total_team_3h'
      WHEN smt ~ ' - 4° Tempo [0-9.]+$' THEN 'total_team_4h'
      WHEN smt ~ ' - Supplementari inclusi [0-9.]+$' THEN 'total_team_ft'
      ELSE 'total_team_ft'
    END AS ck,
    (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric ln
  FROM unmapped u
  WHERE u.smt ~ '^Gol totali - [^0-9].*[0-9.]+$'

  -- Angoli totali - <team> [- <period>] <line>
  UNION ALL
  SELECT u.source, u.smt,
    CASE
      WHEN smt ~ ' - 1° Tempo [0-9.]+$' THEN 'total_corners_1h'
      WHEN smt ~ ' - 2° Tempo [0-9.]+$' THEN 'total_corners_2h'
      ELSE 'total_corners_ft'
    END,
    (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric
  FROM unmapped u
  WHERE u.smt ~ '^Angoli totali - [^0-9].*[0-9.]+$'

  -- Tiri totali in porta - <team> [- <period>] <line>
  UNION ALL
  SELECT u.source, u.smt,
    'total_shots_on_target_ft',
    (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric
  FROM unmapped u
  WHERE u.smt ~ '^Tiri totali in porta - [^0-9].*[0-9.]+$'

  -- Tiri totali (generic kambi without "in porta")
  UNION ALL
  SELECT u.source, u.smt,
    'total_shots_on_target_ft',
    (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric
  FROM unmapped u
  WHERE u.smt ~ '^Tiri totali - [^0-9].*[0-9.]+$'

  -- Falli totali concessi - <team> - <period> <line>
  UNION ALL
  SELECT u.source, u.smt,
    CASE
      WHEN smt ~ ' - 1° Tempo [0-9.]+$' THEN 'total_cards_ft'
      WHEN smt ~ ' - 2° Tempo [0-9.]+$' THEN 'total_cards_ft'
      ELSE 'total_cards_ft'
    END,
    (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric
  FROM unmapped u
  WHERE u.smt ~ '^Falli totali concessi [^0-9].*[0-9.]+$'

  -- Cartellini totali - <team> <line>
  UNION ALL
  SELECT u.source, u.smt,
    'total_cards_ft',
    (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric
  FROM unmapped u
  WHERE u.smt ~ '^Cartellini totali - [^0-9].*[0-9.]+$'

  -- Totale Home/Away residue (should already be handled but extra net)
  UNION ALL
  SELECT u.source, u.smt,
    CASE
      WHEN smt ~ ' - 1T$' OR smt ~ ' - 11T$' THEN 'total_team_1h'
      WHEN smt ~ ' - 2T$' OR smt ~ ' - 12T$' THEN 'total_team_2h'
      ELSE 'total_team_ft'
    END,
    (regexp_match(u.smt, '(?:Home|Away)\s+([0-9.]+)'))[1]::numeric
  FROM unmapped u
  WHERE u.smt ~ '^Totale (Home|Away) [0-9.]+'

  -- Punti totali - <team> - N° Tempo <line>
  UNION ALL
  SELECT u.source, u.smt,
    CASE
      WHEN smt ~ ' - 1° Tempo [0-9.]+$' THEN 'u_o_1h'
      WHEN smt ~ ' - 2° Tempo [0-9.]+$' THEN 'u_o_2h'
      WHEN smt ~ ' - 3° Tempo [0-9.]+$' THEN 'u_o_3h'
      WHEN smt ~ ' - 4° Tempo [0-9.]+$' THEN 'u_o_4h'
      WHEN smt ~ ' - 1° Quarto [0-9.]+$' THEN 'u_o_1h'
      WHEN smt ~ ' - 2° Quarto [0-9.]+$' THEN 'u_o_2h'
      WHEN smt ~ ' - 3° Quarto [0-9.]+$' THEN 'u_o_3h'
      WHEN smt ~ ' - 4° Quarto [0-9.]+$' THEN 'u_o_4h'
      ELSE 'u_o_ft'
    END,
    (regexp_match(u.smt, '([0-9.]+)$'))[1]::numeric
  FROM unmapped u
  WHERE u.smt ~ '^Punti totali - [^0-9].*[0-9.]+$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT m.source, m.smt, m.ck, m.ln,
       (SELECT canonical_name_it FROM canonical_markets cm WHERE cm.canonical_key=m.ck),
       false, 'regex', 70, now()
FROM matches m
WHERE (SELECT 1 FROM canonical_markets cm WHERE cm.canonical_key=m.ck) IS NOT NULL
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key = EXCLUDED.canonical_key,
      canonical_line = EXCLUDED.canonical_line,
      canonical_name_it = EXCLUDED.canonical_name_it,
      extracted_by = EXCLUDED.extracted_by,
      confidence = EXCLUDED.confidence,
      updated_at = now()
  WHERE market_normalization.verified = false
    AND market_normalization.canonical_key IS NULL;
