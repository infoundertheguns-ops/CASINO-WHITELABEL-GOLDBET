-- 030_home_content.sql

CREATE TABLE IF NOT EXISTS home_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL CHECK (section IN ('hero_banners', 'leagues', 'sport_tiles', 'virtual_cards', 'live_sidebar')),
  title TEXT NOT NULL,
  image_url TEXT,
  icon_url TEXT,
  flag_url TEXT,
  href TEXT,
  accent_color TEXT,
  is_wide BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_home_content_section ON home_content(section);
ALTER TABLE home_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "home_content_select" ON home_content FOR SELECT USING (true);

-- Seed: Hero Banners
INSERT INTO home_content (section, title, image_url, href, is_wide, sort_order) VALUES
  ('hero_banners', 'ATP Miami Open', '/midas-promo/banner_atp.png', '/pre-match/tennis', true, 0),
  ('hero_banners', 'WTA Miami Open', '/midas-promo/banner_wta.png', '/pre-match/tennis', false, 1),
  ('hero_banners', 'Euroleague Basket', '/midas-promo/banner_euro.png', '/pre-match/basketball', false, 2),
  ('hero_banners', 'Serie A', '/midas-promo/banner_atp.png', '/pre-match/football', false, 3);

-- Seed: Leagues
INSERT INTO home_content (section, title, icon_url, flag_url, href, sort_order) VALUES
  ('leagues', 'Serie A', '/midas-svg/competition/68-Italy-SerieA.svg', '/midas-svg/flags/IT.svg', '/pre-match/football', 0),
  ('leagues', 'World Cup Qualific...', '/midas-svg/competition/68-WorldCup-WorldCup.svg', '/midas-svg/flags/IT.svg', '/pre-match/football', 1),
  ('leagues', 'Premier League', '/midas-svg/competition/68-england-premierleague.svg', '/midas-svg/flags/EN.svg', '/pre-match/football', 2),
  ('leagues', 'La Liga', '/midas-svg/competition/68-Spain-LaLiga.svg', '/midas-svg/flags/ES.svg', '/pre-match/football', 3),
  ('leagues', 'Bundesliga', '/midas-svg/competition/68-Germany-Bundesliga.svg', '/midas-svg/flags/DE.svg', '/pre-match/football', 4),
  ('leagues', 'Ligue 1', '/midas-svg/competition/68-France-Ligue1.svg', '/midas-svg/flags/FR.svg', '/pre-match/football', 5),
  ('leagues', 'Primera Liga', '/midas-svg/competition/68-Portugal-PrimeraLiga .svg', NULL, '/pre-match/football', 6),
  ('leagues', 'Serie B', '/midas-svg/competition/68-Italy-SerieB.svg', '/midas-svg/flags/IT.svg', '/pre-match/football', 7),
  ('leagues', 'Eredivisie', '/midas-svg/competition/68-Netherlands-Eredivisie.svg', '/midas-svg/flags/NL.svg', '/pre-match/football', 8),
  ('leagues', 'Super League', '/midas-svg/competition/68-Turkey-SuperLeague.svg', '/midas-svg/flags/TR.svg', '/pre-match/football', 9),
  ('leagues', 'Liga 1', '/midas-svg/competition/68-Romania-Liga1.svg', '/midas-svg/flags/RO.svg', '/pre-match/football', 10),
  ('leagues', 'MLS', '/midas-svg/competition/68-Usa-MLS.svg', NULL, '/pre-match/football', 11),
  ('leagues', 'Champions League', '/midas-svg/competition/68-europe-ChampionsLeague.svg', NULL, '/pre-match/football', 12),
  ('leagues', 'Europa League', '/midas-svg/competition/68-europe-EuropaLeague.svg', NULL, '/pre-match/football', 13),
  ('leagues', 'Coppa Italia', '/midas-svg/competition/68-italy-CoppaItalia.svg', '/midas-svg/flags/IT.svg', '/pre-match/football', 14),
  ('leagues', 'FA Cup', '/midas-svg/competition/68-England-FACup.svg', '/midas-svg/flags/EN.svg', '/pre-match/football', 15),
  ('leagues', 'Copa del Rey', '/midas-svg/competition/68-Spain-CopaDelRey.svg', '/midas-svg/flags/ES.svg', '/pre-match/football', 16),
  ('leagues', 'Superligaen', '/midas-svg/competition/68-Denmark-Superligaen.svg', '/midas-svg/flags/DK.svg', '/pre-match/football', 17),
  ('leagues', 'Allsvenskan', '/midas-svg/competition/68-sweden-allsvenskan.svg', NULL, '/pre-match/football', 18);

-- Seed: Sport Tiles
INSERT INTO home_content (section, title, icon_url, accent_color, href, sort_order) VALUES
  ('sport_tiles', 'Calcio', '/midas-svg/football.svg', '#8DC63F', '/pre-match/football', 0),
  ('sport_tiles', 'Tennis', '/midas-svg/tennis.svg', '#EEDC00', '/pre-match/tennis', 1),
  ('sport_tiles', 'Pallacanestro', '/midas-svg/basketball.svg', '#FAA61A', '/pre-match/basketball', 2),
  ('sport_tiles', 'Football Americano', '/midas-svg/americanfootball.svg', '#40BA8D', '/pre-match/amfootball', 3),
  ('sport_tiles', 'Rugby', '/midas-svg/rugby.svg', '#62A78D', '/pre-match/rugby', 4),
  ('sport_tiles', 'Hockey', '/midas-svg/icehockey.svg', '#0068A6', '/pre-match/icehockey', 5),
  ('sport_tiles', 'Formula 1', '/midas-svg/formula1.svg', '#D71920', '/pre-match/formula1', 6),
  ('sport_tiles', 'Pallavolo', '/midas-svg/volleyball.svg', '#E00085', '/pre-match/volleyball', 7),
  ('sport_tiles', 'Pallamano', '/midas-svg/handball.svg', '#A72428', '/pre-match/handball', 8),
  ('sport_tiles', 'Baseball', '/midas-svg/baseball.svg', '#E8AC9A', '/pre-match/baseball', 9),
  ('sport_tiles', 'Boxe', '/midas-svg/boxing.svg', '#B1B3B6', '/pre-match/boxing', 10),
  ('sport_tiles', 'Cricket', '/midas-svg/cricket.svg', '#C4D9A5', '/pre-match/cricket', 11),
  ('sport_tiles', 'Ciclismo', '/midas-svg/cycling.svg', '#43679B', '/pre-match/cycling', 12),
  ('sport_tiles', 'Freccette', '/midas-svg/darts.svg', '#C58CF7', '/pre-match/darts', 13),
  ('sport_tiles', 'Golf', '/midas-svg/golf.svg', '#0098D5', '/pre-match/golf', 14),
  ('sport_tiles', 'Biliardo', '/midas-svg/snooker.svg', '#006B69', '/pre-match/snooker', 15),
  ('sport_tiles', 'Table Tennis', '/midas-svg/tabletennis.svg', '#00427A', '/pre-match/tabletennis', 16),
  ('sport_tiles', 'MotoGP', '/midas-svg/motogp.svg', '#58595B', '/pre-match/motogp', 17),
  ('sport_tiles', 'Futsal', '/midas-svg/futsal.svg', '#BDA37B', '/pre-match/futsal', 18),
  ('sport_tiles', 'Sci', '/midas-svg/skiing.svg', '#0087BF', '/pre-match/skiing', 19),
  ('sport_tiles', 'Biathlon', '/midas-svg/skiing.svg', '#007DC8', '/pre-match/biathlon', 20);

-- Seed: Virtual Cards
INSERT INTO home_content (section, title, icon_url, accent_color, href, sort_order) VALUES
  ('virtual_cards', 'Football', '/midas-svg/vfootball.svg', '#4CAF50', '/virtual', 0),
  ('virtual_cards', 'Motor Racing', '/midas-svg/motoracing.svg', '#E91E63', '/virtual', 1);

-- Seed: Live Sidebar
INSERT INTO home_content (section, title, image_url, icon_url, sort_order) VALUES
  ('live_sidebar', 'Tennis', '/midas-sport/tennis.png', '/midas-svg/tennis.svg', 0),
  ('live_sidebar', 'Football', '/midas-sport/football.png', '/midas-svg/football.svg', 1),
  ('live_sidebar', 'Table Tennis', '/midas-sport/tabletennis.png', '/midas-svg/tabletennis.svg', 2);
