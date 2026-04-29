-- Migration 147: trigger to block kambi inserts/upserts for major sports.
--
-- Phase 1.D cleanup-first: odds-api now writes major sports (football/basket/
-- tennis/baseball/rugby/cricket/volley/pallamano/hockey-ghiaccio) into legacy
-- events table via derive_legacy_from_v2(). kambi-scraper continues writing
-- the same sports too, which would create duplicates visible to the player
-- frontend once we relax the source filter.
--
-- Solution: a BEFORE INSERT/UPDATE trigger that silently drops any kambi:%%
-- row whose sport is in the major-sport list. Result: kambi-scraper continues
-- running unchanged, but its output for major sports becomes a no-op at the
-- DB layer. Niche sports (esports, snooker, tennis-tavolo, etc.) are
-- unaffected — kambi remains the source of truth for those.
--
-- Rationale for trigger vs modifying kambi-scraper:
--   - kambi-scraper is in a separate repo; trigger keeps the change local
--   - Reversible: just DROP the trigger
--   - Surgically scoped: only kambi:%% external_id, only major sports
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- Rollback: DROP TRIGGER trg_events_block_kambi_major ON events;
--           DROP FUNCTION events_block_kambi_major_sports();

BEGIN;

CREATE OR REPLACE FUNCTION public.events_block_kambi_major_sports()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.external_id LIKE 'kambi:%' THEN
    IF EXISTS (
      SELECT 1 FROM sports s
      WHERE s.id = NEW.sport_id
        AND s.slug IN (
          'calcio',           -- football
          'basket',           -- basketball
          'tennis',
          'baseball',
          'rugby',
          'cricket',
          'volley',           -- volleyball
          'pallamano',        -- handball
          'hockey-ghiaccio'   -- ice-hockey
          -- NOTE: american-football intentionally omitted — kambi sport slug
          -- might be different, and we keep kambi as fallback for that
        )
    ) THEN
      RETURN NULL;  -- silently drop
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_block_kambi_major ON public.events;

CREATE TRIGGER trg_events_block_kambi_major
BEFORE INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.events_block_kambi_major_sports();

-- Cleanup existing kambi rows for major sports that haven't started yet.
-- Past/in-flight events are preserved to avoid breaking historical bets.
-- NOTE: cascading delete to markets/outcomes happens via FK; bets are
-- preserved (bet_selections.market_id FK is NOT VALID = no enforcement).
DELETE FROM public.events
WHERE external_id LIKE 'kambi:%'
  AND starts_at > now()
  AND sport_id IN (
    SELECT id FROM sports
    WHERE slug IN (
      'calcio', 'basket', 'tennis', 'baseball', 'rugby', 'cricket',
      'volley', 'pallamano', 'hockey-ghiaccio'
    )
  );

COMMIT;
