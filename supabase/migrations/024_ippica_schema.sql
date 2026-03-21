-- ippica_meetings
CREATE TABLE IF NOT EXISTS ippica_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  country_id TEXT NOT NULL,
  race_type TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  race_count INT DEFAULT 0,
  status TEXT DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ippica_races
CREATE TABLE IF NOT EXISTS ippica_races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  meeting_id UUID REFERENCES ippica_meetings(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  race_number INT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  off_time TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled',
  race_class TEXT,
  distance DECIMAL(8,2),
  distance_units TEXT,
  track TEXT,
  race_kind TEXT,
  going TEXT,
  weather TEXT,
  handicap BOOLEAN DEFAULT FALSE,
  eligibility TEXT,
  prize_amount INT,
  prize_currency TEXT,
  runners_count INT DEFAULT 0,
  source_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ippica_runners
CREATE TABLE IF NOT EXISTS ippica_runners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES ippica_races(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  runner_number INT NOT NULL,
  drawn TEXT,
  age INT,
  sex TEXT,
  weight_text TEXT,
  weight_value INT,
  jockey TEXT,
  trainer TEXT,
  trainer_location TEXT,
  owner TEXT,
  breeder TEXT,
  bred TEXT,
  color TEXT,
  silk TEXT,
  form TEXT,
  rating INT,
  comment_it TEXT,
  breeding JSONB,
  tackle JSONB,
  is_non_runner BOOLEAN DEFAULT FALSE,
  finish_position INT,
  disqualified BOOLEAN DEFAULT FALSE,
  disqualify_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_id, runner_number)
);

-- ippica_markets
CREATE TABLE IF NOT EXISTS ippica_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES ippica_races(id) ON DELETE CASCADE,
  market_type TEXT NOT NULL,
  market_label TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (race_id, market_type, market_label)
);

-- ippica_odds
CREATE TABLE IF NOT EXISTS ippica_odds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES ippica_markets(id) ON DELETE CASCADE,
  runner_number INT,
  selection_name TEXT NOT NULL,
  odds DECIMAL(8,2),
  previous_odds DECIMAL(8,2),
  trend TEXT DEFAULT 'stable',
  status TEXT DEFAULT 'active',
  result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (market_id, selection_name)
);

-- Indexes for FK lookups and common queries
CREATE INDEX idx_ippica_races_meeting_id ON ippica_races(meeting_id);
CREATE INDEX idx_ippica_races_status_scheduled ON ippica_races(status, scheduled_at);
CREATE INDEX idx_ippica_runners_race_id ON ippica_runners(race_id);
CREATE INDEX idx_ippica_markets_race_id ON ippica_markets(race_id);
CREATE INDEX idx_ippica_odds_market_id ON ippica_odds(market_id);
CREATE INDEX idx_ippica_odds_result ON ippica_odds(result);
