-- Migration 174: add missing homepage sport_tiles for esports + mma.
-- Both have events in events_v2 but no homepage tile, so users can't navigate.
--
-- esports: 429 events (mostly Counter-Strike, Dota 2, Valorant, LoL, etc.) -> /pre-match/eleague
-- mma: 49 events -> /pre-match/mma
--
-- Sort orders 21-22 placed after the existing 21 tiles (sort_order 0-20).

INSERT INTO home_content (section, title, icon_url, href, accent_color, is_wide, sort_order, is_active, title_en)
VALUES
  ('sport_tiles', 'E-Sports', '/midas-svg/esports.svg', '/pre-match/eleague', '#00AA00', false, 21, true, 'E-Sports'),
  ('sport_tiles', 'MMA',      '/midas-svg/combatsports.svg', '/pre-match/mma', '#684D9F', false, 22, true, 'MMA');

INSERT INTO _migrations (name, applied_at, notes)
VALUES ('174_add_missing_sport_tiles', now(), 'Add esports + mma to home sport_tiles (events present but no tile)')
ON CONFLICT (name) DO NOTHING;
