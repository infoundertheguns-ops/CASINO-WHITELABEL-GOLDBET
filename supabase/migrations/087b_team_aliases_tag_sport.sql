-- ═══════════════════════════════════════════════════
-- Migration 087b: Tag existing team_aliases seeds with sport
-- Based on observation: all mig 013 seeds are football-specific
-- (Italian clubs + national teams used as football brand names).
-- Tag all NULL as 'football' (= events sport 'Calcio' — matching
-- handled in application layer via canonical lowercase lookup).
-- ═══════════════════════════════════════════════════

UPDATE team_aliases
SET sport = 'football'
WHERE sport IS NULL;
