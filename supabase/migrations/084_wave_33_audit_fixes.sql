-- 084_wave_33_audit_fixes.sql
-- Audit fixes from user-reported mapping review.
--
-- Issue 1: "Totale gol - HH:MM-HH:MM N.5" is minute-window goal total,
-- NOT match-total u_o. Collides with u_o_ft in consensus. Fix: create
-- dedicated canonical minute_window_goal_total_ft + remap + seed the other
-- 15 unmapped variants.
--
-- Issue 2: exact_goals_ft canonical_name_it says "Numero Esatto Goal" but
-- residue includes basket/esports with line 11-20 (points/runs, not goals).
-- Fix: rename canonical_name_it to generic "Numero Esatto Totale" —
-- semantically the canonical IS already sport-agnostic at data level,
-- name was misleading.

-- Fix 1: new canonical for minute-window goal totals
INSERT INTO canonical_markets (canonical_key, base_key, period, canonical_name_it, has_line, outcomes) VALUES
  ('minute_window_goal_total_ft', 'minute_window_goal_total', 'ft', 'Totale Gol Intervallo Minuti', true,
   '[{"key":"over","name_it":"Over"},{"key":"under","name_it":"Under"}]'::jsonb)
ON CONFLICT (canonical_key) DO NOTHING;

-- Remap the 1 mismapped row + seed the 15 unmapped
WITH minute_window AS (
  SELECT DISTINCT e.source, m.market_type AS smt
  FROM markets m JOIN events e ON e.id=m.event_id
  WHERE m.is_active AND m.market_type ~ 'Totale gol - [0-9]+:[0-9]+-[0-9]+:[0-9]+'
)
INSERT INTO market_normalization (source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, updated_at)
SELECT source, smt, 'minute_window_goal_total_ft',
       (regexp_match(smt, '([0-9.]+)$'))[1]::numeric,
       'Totale Gol Intervallo Minuti', true, 'regex', 90, now()
FROM minute_window
ON CONFLICT (source, source_market_type) DO UPDATE
  SET canonical_key='minute_window_goal_total_ft',
      canonical_line=EXCLUDED.canonical_line,
      canonical_name_it='Totale Gol Intervallo Minuti',
      verified=true,
      extracted_by='regex',
      confidence=90,
      updated_at=now();

-- Fix 2: rename exact_goals canonicals to clarify sport-agnostic nature
UPDATE canonical_markets
SET canonical_name_it='Numero Esatto Totale'
WHERE canonical_key='exact_goals_ft';
UPDATE canonical_markets
SET canonical_name_it='Numero Esatto Totale 1°T'
WHERE canonical_key='exact_goals_1h';
UPDATE canonical_markets
SET canonical_name_it='Numero Esatto Totale 2°T'
WHERE canonical_key='exact_goals_2h';

-- Propagate to market_normalization entries already mapped
UPDATE market_normalization SET canonical_name_it='Numero Esatto Totale' WHERE canonical_key='exact_goals_ft';
UPDATE market_normalization SET canonical_name_it='Numero Esatto Totale 1°T' WHERE canonical_key='exact_goals_1h';
UPDATE market_normalization SET canonical_name_it='Numero Esatto Totale 2°T' WHERE canonical_key='exact_goals_2h';
