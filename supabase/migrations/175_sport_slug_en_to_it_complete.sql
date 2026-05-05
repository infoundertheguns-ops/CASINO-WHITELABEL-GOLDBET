-- Migration 175: complete _sport_slug_en_to_it() mapping for all v2-supported sports.
--
-- Problem: function had only 10 mappings; was missing esports/darts/boxing/mma/snooker
-- and incorrectly returned 'american-football' instead of 'football-americano'.
-- Side effect: v_player_events view returned sport_slug=NULL for those sports →
-- page-v2 never fired (rawDbEvent had no sport.slug → flag check failed →
-- legacy UI rendered for 6 entire sports).
--
-- Fix: add the 5 missing mappings + correct american-football → football-americano.

CREATE OR REPLACE FUNCTION public._sport_slug_en_to_it(p_en text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_en
    WHEN 'football'          THEN 'calcio'
    WHEN 'basketball'        THEN 'basket'
    WHEN 'handball'          THEN 'pallamano'
    WHEN 'volleyball'        THEN 'volley'
    WHEN 'ice-hockey'        THEN 'hockey-ghiaccio'
    WHEN 'tennis'            THEN 'tennis'
    WHEN 'baseball'          THEN 'baseball'
    WHEN 'rugby'             THEN 'rugby'
    WHEN 'cricket'           THEN 'cricket'
    WHEN 'american-football' THEN 'football-americano'  -- was incorrect (passthrough)
    WHEN 'esports'           THEN 'esports'             -- new
    WHEN 'darts'             THEN 'freccette'           -- new
    WHEN 'boxing'            THEN 'boxe'                -- new
    WHEN 'mma'               THEN 'arti-marziali'       -- new
    WHEN 'snooker'           THEN 'snooker'             -- new
    ELSE NULL  -- unknown → skip
  END
$function$;
