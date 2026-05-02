-- Migration 163: extend classify_market_pattern score regex
--
-- Bug discovered 2026-05-02: 'Double Chance' and 'Goals Over/Under'
-- (English odds-api raw names) were classified as 'special' because the
-- score regex only included Italian translated forms (Doppia/U/O) and a
-- few English variants (Both Teams, Match Result). The v_player_markets
-- view filters out 'special' → these markets were invisible on the player
-- listing. Add English equivalents.

CREATE OR REPLACE FUNCTION public.classify_market_pattern(p_market_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_market_type ~* '^(Metodo Goal|Goal Method|Primi 10 Minuti|First 10|Special)' THEN 'special'
    WHEN p_market_type ~* '\y(Marcator|Giocator|Marca o Assist|Anytime|Player|Scorer|Multi Scorers|Team Goalscorer|Goalscorer)' THEN 'player'
    WHEN p_market_type ~* '\y(Corner|Angoli|Cartellin|Card |Cards|Tackles|Salvataggi|Goalkeeper Saves|Falli|Fouls|Tiri Totali|Tiri in Porta|Tiri Squadra|Team Shots|Match Shots|Shots on Target|Bookings|Doubles|Batter Walks|Hits)' THEN 'stats'
    WHEN p_market_type ~* '^(1X2|U/O|GG/NG|DC|DNB|HT/FT|ML|P/D|3-Way|2-Way|Doppia|Double|Pareggio|Vincente|Pari/Dispari|Odd/Even|Numero Goal|Esatto|Risultato|Linea Goal|Goal/No Goal|Goal Line|Goals Over|Goals Under|Goals Over/Under|Totale|Total|Handicap|Asian Handicap|European Handicap|Spread|Multigol|Multiscores|Alternative|Both Teams|Exact|First Team|Last Team|Number of|To Score|Tempo Regolamentare|Supplementari|Half Time|Full Time|1st Half|2nd Half|First Half|Second Half|Draw No Bet|Match Result|Final Score|Score after|Set Betting|Game Betting|Frame|Race To|Highest Scoring|Lowest Scoring|Penalty|To Win|Win and|Win Either|Winning Margin|Clean Sheet|5 Innings|7 Innings|9 Innings)' THEN 'score'
    ELSE 'special'
  END;
$function$;

-- Verification block — fails the migration if any classification is wrong
DO $$
DECLARE r record;
BEGIN
  FOR r IN VALUES
    ('Double Chance', 'score'),
    ('Goals Over/Under', 'score'),
    ('Odd/Even', 'score'),
    ('ML', 'score'),
    ('Both Teams To Score', 'score'),
    ('Anytime Goalscorer', 'player'),
    ('Corners', 'stats'),
    ('Goal Method', 'special')
  LOOP
    IF classify_market_pattern(r.column1) <> r.column2 THEN
      RAISE EXCEPTION 'classify_market_pattern(%) returned %, expected %',
        r.column1, classify_market_pattern(r.column1), r.column2;
    END IF;
  END LOOP;
  RAISE NOTICE 'All classification assertions passed';
END $$;
