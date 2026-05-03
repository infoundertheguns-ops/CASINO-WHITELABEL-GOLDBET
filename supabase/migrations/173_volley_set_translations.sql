-- Migration 173: volleyball ML 1st Set / 2nd Set translations to T/T <N>° Set.
-- User reported volley listing missing T/T 1° Set column post-mig 171.
-- ML 1st Set is in player listing whitelist but frontend looks for "T/T 1° Set" label.

INSERT INTO oddsapi_translations (kind, sport_slug, source_key, parent_market, translated, notes)
VALUES
  ('market', 'volleyball', 'ML 1st Set', '', 'T/T 1° Set', 'mig 173'),
  ('market', 'volleyball', 'ML 2nd Set', '', 'T/T 2° Set', 'mig 173'),
  -- Generic fallbacks (other sports inherit if no per-sport override)
  ('market', '',           'ML 1st Set', '', 'T/T 1° Set', 'mig 173 generic'),
  ('market', '',           'ML 2nd Set', '', 'T/T 2° Set', 'mig 173 generic')
ON CONFLICT (kind, source_key, sport_slug, parent_market) DO UPDATE
SET translated = EXCLUDED.translated, notes = EXCLUDED.notes, updated_at = now();

INSERT INTO _migrations (name, applied_at, notes)
VALUES ('173_volley_set_translations', now(), 'ML 1st/2nd Set -> T/T <N>° Set for volleyball + generic fallback')
ON CONFLICT (name) DO NOTHING;
