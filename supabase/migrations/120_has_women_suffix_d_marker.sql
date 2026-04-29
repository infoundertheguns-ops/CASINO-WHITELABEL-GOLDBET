-- ═══════════════════════════════════════════════════
-- Migration 120: extend has_women_suffix() to recognise " D" trailing marker
--
-- Edge case found during Sprint 2 prod smoke (2026-04-25):
--   Event:    "R.A.E.C. Mons (Women) vs Anderlecht II (Women)"
--   Candidate: "Mons D vs RSC Anderlecht II D"  ← Belgian women's marker
-- v1 has_women_suffix returned false for "Mons D" → gender_penalty -0.15
-- applied → composite score collapsed below 0.7 threshold.
--
-- Also adds normalize_team_name() handling of trailing " D" so the trigram
-- comparison normalises consistently ("Mons D" → "mons" matches "Mons" → "mons").
--
-- Belgian women's football explicitly uses the " D" suffix (Dames = women in Dutch).
-- We add to existing patterns; no removal so non-Belgian "B" / "II" / "U23" still work.
-- ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION has_women_suffix(input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(input,'')) ~ '(\(women\)|\(w\)|\(d\)|\swomen\s*$|\sw\s*$|\sd\s*$|\sfemminile\s*$|\sdonna\s*$|\sdonne\s*$|\sdames\s*$)';
$$;

COMMENT ON FUNCTION has_women_suffix IS
  'Recognises women-team suffix in raw team name. Mig 120 adds " D" / " (D)" / " Dames" (Belgian women''s convention).';

CREATE OR REPLACE FUNCTION normalize_team_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  -- 1. lowercase + unaccent (Šeško → sesko, Atlético → atletico)
  -- 2. strip parenthesised gender/reserves tags (mig 120 adds (d))
  -- 3. strip trailing gender/reserves words (mig 120 adds D / Dames)
  -- 4. collapse internal whitespace
  -- 5. trim
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(public.unaccent(coalesce(input, ''))),
          '\s*\((women|w|d|reserves|riserve|riserva|res|ii|u\s*17|u\s*19|u\s*21|u\s*23)\)\s*', ' ', 'gi'
        ),
        '\s+(women|w|d|femminile|donna|donne|dames)\s*$', '', 'i'
      ),
      '\s+(ii|iii|b|reserves|riserve|riserva|res|u\s*17|u\s*19|u\s*21|u\s*23)\s*$', '', 'i'
    ),
    '\s+', ' ', 'g'
  ));
$$;

COMMENT ON FUNCTION normalize_team_name IS
  'Mig 120: extends gender-suffix stripping with Belgian D / Dames marker. Otherwise identical to mig 118.';
