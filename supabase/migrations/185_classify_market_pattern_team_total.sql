-- Migration 185: extend classify_market_pattern to cover Team Total / Correct Score / Points
--
-- Surfaced 2026-05-13 sera kiosk smoke darts (van Duijvenbode v Morris):
-- 6 markets in markets_v2 (ML x2, Team Total Home x2, Team Total Away x2) but
-- v_player_markets returned only 1 (ML -> T/T). classify_market_pattern returns
-- 'special' for these market_name, and the view WHERE filter drops 'special'.
--
-- DB audit (markets_v2 sample 10000 recent, 68 distinct market_name):
--   special (filtered): Team Total Away (52), Team Total Home (50),
--                       Correct Score (15), Points (3),
--                       Team Total Goals Away (2), Team Total Goals Home (2)
--
-- Fix: add these market_name patterns to the score regex so they pass through
-- the view filter. translations are added in a separate operation
-- (oddsapi_translations rows) to give them Italian display names. Without
-- translations the kiosk shows market_type raw (English) under tab 'Altri'.
--
-- Note: 'Team Goalscorer' still routes to player branch (alternation order:
-- player check runs before score, and player regex matches 'Team Goalscorer'
-- via \y boundary). 'Goal Method' / 'First 10 Minutes' / 'Special' stay
-- special via the first WHEN branch.

CREATE OR REPLACE FUNCTION public.classify_market_pattern(p_market_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_market_type ~* '^(Metodo Goal|Goal Method|Primi 10 Minuti|First 10|Special)' THEN 'special'
    WHEN p_market_type ~* '\y(Marcator|Giocator|Marca o Assist|Anytime|Player|Scorer|Multi Scorers|Team Goalscorer|Goalscorer)' THEN 'player'
    WHEN p_market_type ~* '\y(Corner|Angoli|Cartellin|Card |Cards|Tackles|Salvataggi|Goalkeeper Saves|Falli|Fouls|Tiri Totali|Tiri in Porta|Tiri Squadra|Team Shots|Match Shots|Shots on Target|Bookings|Doubles|Batter Walks|Hits)' THEN 'stats'
    WHEN p_market_type ~* '^(1X2|U/O|GG/NG|DC|DNB|HT/FT|ML|P/D|3-Way|2-Way|Doppia|Double|Pareggio|Vincente|Pari/Dispari|Odd/Even|Numero Goal|Esatto|Risultato|Linea Goal|Goal/No Goal|Goal Line|Goals Over|Goals Under|Goals Over/Under|Totale|Total|Handicap|Asian Handicap|European Handicap|Spread|Multigol|Multiscores|Alternative|Both Teams|Exact|First Team|Last Team|Number of|To Score|Tempo Regolamentare|Supplementari|Half Time|Full Time|1st Half|2nd Half|First Half|Second Half|Draw No Bet|Match Result|Final Score|Score after|Set Betting|Game Betting|Frame|Race To|Highest Scoring|Lowest Scoring|Penalty|To Win|Win and|Win Either|Winning Margin|Clean Sheet|5 Innings|7 Innings|9 Innings|Team Total|Correct Score|Points)' THEN 'score'
    ELSE 'special'
  END;
$function$;

-- Verification block — fails the migration if any classification is wrong.
DO $$
DECLARE r record;
BEGIN
  FOR r IN VALUES
    -- Pre-existing assertions (regression guard)
    ('Double Chance', 'score'),
    ('Goals Over/Under', 'score'),
    ('Odd/Even', 'score'),
    ('ML', 'score'),
    ('Both Teams To Score', 'score'),
    ('Anytime Goalscorer', 'player'),
    ('Corners', 'stats'),
    ('Goal Method', 'special'),
    -- New assertions (mig 185)
    ('Team Total Home', 'score'),
    ('Team Total Away', 'score'),
    ('Team Total Goals Home', 'score'),
    ('Team Total Goals Away', 'score'),
    ('Correct Score', 'score'),
    ('Points', 'score'),
    -- Player precedence: Team Goalscorer must still resolve to player not score
    ('Team Goalscorer', 'player')
  LOOP
    IF classify_market_pattern(r.column1) <> r.column2 THEN
      RAISE EXCEPTION 'classify_market_pattern(%) returned %, expected %',
        r.column1, classify_market_pattern(r.column1), r.column2;
    END IF;
  END LOOP;
  RAISE NOTICE 'All classification assertions passed (incl. mig 185 additions)';
END $$;
