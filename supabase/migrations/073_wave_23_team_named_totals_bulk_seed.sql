-- 073_wave_23_team_named_totals_bulk_seed.sql
-- Wave 23: bulk-canonicalize "Totale <team-name> N.N - [period]" patterns.
-- These are 22bet team-specific totals where the team name is embedded in the
-- market_type instead of being a line parameter. Map to generic total_team_*
-- (team distinction lost — acceptable design choice, same as Wave 13 for
-- Totale Home/Away).
--
-- Strategy: exclude known specific prefixes via NOT LIKE chain, then extract
-- numeric line from remaining market_type.
--
-- Also catches esports "Totale Torri Distrutte" and "Totale Torri" variants.

SET statement_timeout = 600000;

WITH unmapped AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id = m.event_id
  WHERE m.is_active
    AND NOT EXISTS (SELECT 1 FROM market_normalization mn WHERE mn.source=e.source AND mn.source_market_type=m.market_type AND mn.canonical_key IS NOT NULL)
),
team_named_totals AS (
  SELECT source, smt
  FROM unmapped
  WHERE smt ~ '^Totale\s+[A-Z]'  -- must start with "Totale " + Uppercase letter
    AND smt !~ '^Totale\s+(Asiatico|Squadra\s|Mappe|gol\b|Round|Goal\b|Partite|Esatto\b|Al\s+Minuto|3Opzioni|Ogni\s+Squadra|Nashor|Draghi|Torri|calci\b|tiri|cartellini|set\s|Home\s*\(|Away\s*\(|Inhibitor|[1-9]\s|[1-9]\b|Del\s+Giocatore|NOpzioni|Frag\b)'
    AND smt ~ '[\d]+(\.[\d]+)?$|[\d]+(\.[\d]+)?\s+-\s+(1T|2T|11T|12T|3T|4T)$'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT
  source, smt,
  CASE
    WHEN smt ~ ' - (1T|11T)$' THEN 'total_team_1h'
    WHEN smt ~ ' - (2T|12T)$' THEN 'total_team_2h'
    WHEN smt ~ ' - 3T$' THEN 'total_team_3h'
    WHEN smt ~ ' - 4T$' THEN 'total_team_4h'
    ELSE 'total_team_ft'
  END,
  (regexp_match(smt, '([\d]+(?:\.[\d]+)?)(?:\s+-\s+\dT)?$'))[1]::numeric,
  'Totale Squadra',
  false, 'regex', 75, now()
FROM team_named_totals
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key = EXCLUDED.canonical_key,
      canonical_line = EXCLUDED.canonical_line,
      canonical_name_it = EXCLUDED.canonical_name_it,
      extracted_by = EXCLUDED.extracted_by,
      confidence = EXCLUDED.confidence,
      updated_at = now()
  WHERE market_normalization.verified = false
    AND market_normalization.canonical_key IS NULL;
