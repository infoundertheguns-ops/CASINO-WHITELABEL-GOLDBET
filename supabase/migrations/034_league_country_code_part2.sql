-- ═══════════════════════════════════════════════════════════
-- Migration 034 Part 2: VALIDATE CHECK + UNIQUE INDEX + RPC update
--
-- Precondizione: tabella `leagues` deve essere VUOTA (TRUNCATE già eseguito).
-- Se ci sono righe residue con country_code=NULL AND tour_code=NULL,
-- la VALIDATE CONSTRAINT fallirà.
--
-- ORDINE CRITICO:
--   1. VALIDATE CHECK (on empty table, passa)
--   2. CREATE UNIQUE INDEX (expr-based)
--   3. DROP old UNIQUE (leagues_slug_key)
--   4. CREATE helper upsert_league
--   5. CREATE OR REPLACE upsert_prematch_batch (usa helper)
--   6. CREATE OR REPLACE upsert_live_batch (usa helper)
-- ═══════════════════════════════════════════════════════════

-- ── 1. VALIDATE CHECK constraints ──
ALTER TABLE leagues VALIDATE CONSTRAINT leagues_country_or_tour_chk;
ALTER TABLE leagues VALIDATE CONSTRAINT leagues_country_xor_tour_chk;

-- ── 2. UNIQUE INDEX composita expr-based ──
CREATE UNIQUE INDEX uq_leagues_sport_slug_dedup
  ON leagues(sport_id, slug, COALESCE(country_code, tour_code));

-- ── 3. Drop vecchia UNIQUE(slug) ──
ALTER TABLE leagues DROP CONSTRAINT leagues_slug_key;

-- ── 4. Helper function: upsert_league ──
CREATE OR REPLACE FUNCTION upsert_league(
  p_sport_id UUID,
  p_name TEXT,
  p_sport_slug TEXT,
  p_country TEXT,
  p_country_code TEXT,
  p_tour_code TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $fn$
DECLARE
  v_country_code TEXT;
  v_tour_code TEXT;
  v_disambiguator TEXT;
  v_slug TEXT;
  v_league_id UUID;
BEGIN
  -- Normalizzazione input
  v_country_code := NULLIF(p_country_code, '');
  v_tour_code   := NULLIF(p_tour_code,   '');

  -- Fallback: entrambi NULL → 'uncategorized' come tour
  IF v_country_code IS NULL AND v_tour_code IS NULL THEN
    v_tour_code := 'uncategorized';
  END IF;

  -- XOR enforcement: se entrambi popolati, prediligi country_code
  IF v_country_code IS NOT NULL AND v_tour_code IS NOT NULL THEN
    v_tour_code := NULL;
  END IF;

  v_disambiguator := COALESCE(v_country_code, v_tour_code);
  v_slug := p_sport_slug || '-' || slugify(p_name) || '-' || v_disambiguator;

  INSERT INTO leagues (sport_id, name, slug, country, country_code, tour_code, is_active)
  VALUES (p_sport_id, p_name, v_slug, p_country, v_country_code, v_tour_code, TRUE)
  ON CONFLICT (sport_id, slug, COALESCE(country_code, tour_code)) DO UPDATE SET
    name = EXCLUDED.name,
    country = COALESCE(EXCLUDED.country, leagues.country)
  RETURNING id INTO v_league_id;

  RETURN v_league_id;
END;
$fn$;

-- ── 5. upsert_prematch_batch — usa helper ──
CREATE OR REPLACE FUNCTION upsert_prematch_batch(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $fn$
DECLARE
  v_events JSONB;
  v_ev JSONB;
  v_processed INT := 0;
  v_errors JSONB := '[]'::JSONB;
  v_sport_slug TEXT;
  v_sport_id UUID;
  v_league_id UUID;
  v_event_id UUID;
  v_is_live BOOLEAN;
  v_market JSONB;
  v_market_slug TEXT;
  v_market_id UUID;
  v_market_line NUMERIC;
  v_outcome JSONB;
  v_incoming_types TEXT[];
  v_overview_only BOOLEAN;
  v_batch_count INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  v_events := payload -> 'events';
  IF v_events IS NULL OR jsonb_array_length(v_events) = 0 THEN
    RETURN jsonb_build_object('processed', 0, 'errors', jsonb_build_array('events array required'));
  END IF;

  FOR v_ev IN SELECT * FROM jsonb_array_elements(v_events)
  LOOP
    BEGIN
      IF v_ev ->> 'external_id' IS NULL OR v_ev ->> 'sport' IS NULL
         OR v_ev ->> 'league' IS NULL OR v_ev ->> 'home_team' IS NULL
         OR v_ev ->> 'away_team' IS NULL OR v_ev ->> 'starts_at' IS NULL THEN
        v_errors := v_errors || jsonb_build_array(
          COALESCE(v_ev ->> 'external_id', 'unknown') || ': missing required fields'
        );
        CONTINUE;
      END IF;

      v_overview_only := COALESCE((v_ev ->> 'overview_only')::BOOLEAN, FALSE);

      v_sport_slug := slugify(v_ev ->> 'sport');
      INSERT INTO sports (name, slug, icon, is_active)
      VALUES (v_ev ->> 'sport', v_sport_slug, sport_icon(v_sport_slug), TRUE)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_sport_id;

      -- Usa helper upsert_league con country_code/tour_code dal payload
      v_league_id := upsert_league(
        v_sport_id,
        v_ev ->> 'league',
        v_sport_slug,
        v_ev ->> 'country',
        v_ev ->> 'country_code',
        v_ev ->> 'tour_code'
      );

      SELECT id, is_live INTO v_event_id, v_is_live
      FROM events WHERE external_id = v_ev ->> 'external_id' LIMIT 1;

      IF v_event_id IS NOT NULL AND v_is_live THEN
        v_processed := v_processed + 1;
        CONTINUE;
      END IF;

      IF v_event_id IS NOT NULL THEN
        UPDATE events SET
          sport_id = v_sport_id, league_id = v_league_id,
          home_team = v_ev ->> 'home_team', away_team = v_ev ->> 'away_team',
          starts_at = (v_ev ->> 'starts_at')::TIMESTAMPTZ,
          status = COALESCE(v_ev ->> 'status', 'prematch'),
          is_live = FALSE, updated_at = v_now
        WHERE id = v_event_id;
      ELSE
        INSERT INTO events (external_id, sport_id, league_id, home_team, away_team, starts_at, status, is_live, updated_at)
        VALUES (v_ev ->> 'external_id', v_sport_id, v_league_id,
          v_ev ->> 'home_team', v_ev ->> 'away_team',
          (v_ev ->> 'starts_at')::TIMESTAMPTZ,
          COALESCE(v_ev ->> 'status', 'prematch'), FALSE, v_now)
        RETURNING id INTO v_event_id;
      END IF;

      v_processed := v_processed + 1;

      IF v_ev -> 'markets' IS NOT NULL
         AND jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) > 0 THEN
        v_batch_count := jsonb_array_length(v_ev -> 'markets');
        UPDATE events SET source_markets_count = v_batch_count
        WHERE id = v_event_id;
      END IF;

      IF v_ev -> 'markets' IS NULL OR jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) = 0 THEN
        IF NOT v_overview_only THEN
          UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
          WHERE market_id IN (SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE);
          UPDATE markets SET is_active = FALSE, is_suspended = TRUE
          WHERE event_id = v_event_id AND is_active = TRUE;
        END IF;
        CONTINUE;
      END IF;

      SELECT array_agg(DISTINCT m ->> 'type') INTO v_incoming_types
      FROM jsonb_array_elements(v_ev -> 'markets') AS m;

      FOR v_market IN SELECT * FROM jsonb_array_elements(v_ev -> 'markets')
      LOOP
        v_market_slug := slugify(v_market ->> 'type');
        v_market_line := extract_line(v_market ->> 'type');
        INSERT INTO markets (event_id, name, slug, market_type, line, is_active, is_suspended)
        VALUES (v_event_id, v_market ->> 'type', v_market_slug, v_market ->> 'type', v_market_line, TRUE, FALSE)
        ON CONFLICT (event_id, market_type) DO UPDATE SET
          name = EXCLUDED.name, slug = EXCLUDED.slug, line = EXCLUDED.line,
          is_active = TRUE, is_suspended = FALSE, updated_at = v_now
        RETURNING id INTO v_market_id;

        FOR v_outcome IN SELECT * FROM jsonb_array_elements(v_market -> 'outcomes')
        LOOP
          IF (v_outcome ->> 'odds')::NUMERIC <= 1 THEN CONTINUE; END IF;
          INSERT INTO outcomes (market_id, name, odds, is_active, is_suspended)
          VALUES (v_market_id, v_outcome ->> 'name', (v_outcome ->> 'odds')::NUMERIC, TRUE, FALSE)
          ON CONFLICT (market_id, name) DO UPDATE SET
            odds = EXCLUDED.odds, is_active = TRUE, is_suspended = FALSE;
        END LOOP;
      END LOOP;

      IF NOT v_overview_only THEN
        UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
        WHERE market_id IN (
          SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE
            AND market_type <> ALL(v_incoming_types)
        );
        UPDATE markets SET is_active = FALSE, is_suspended = TRUE
        WHERE event_id = v_event_id AND is_active = TRUE
          AND market_type <> ALL(v_incoming_types);
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(
        COALESCE(v_ev ->> 'external_id', 'unknown') || ': ' || SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'errors', v_errors);
END;
$fn$;

-- ── 6. upsert_live_batch — usa helper ──
CREATE OR REPLACE FUNCTION upsert_live_batch(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
  v_events JSONB;
  v_ev JSONB;
  v_updated INT := 0;
  v_inserted INT := 0;
  v_errors JSONB := '[]'::JSONB;
  v_event_id UUID;
  v_sport_slug TEXT;
  v_sport_id UUID;
  v_league_id UUID;
  v_league_name TEXT;
  v_live_data JSONB;
  v_is_ended BOOLEAN;
  v_market JSONB;
  v_market_slug TEXT;
  v_market_id UUID;
  v_market_line NUMERIC;
  v_outcome JSONB;
  v_incoming_types TEXT[];
  v_now TIMESTAMPTZ := now();
BEGIN
  v_events := payload -> 'events';

  IF v_events IS NULL OR jsonb_array_length(v_events) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'inserted', 0, 'errors', jsonb_build_array('events array required'));
  END IF;

  FOR v_ev IN SELECT * FROM jsonb_array_elements(v_events)
  LOOP
    BEGIN
      IF v_ev ->> 'external_id' IS NULL THEN
        v_errors := v_errors || jsonb_build_array('missing external_id');
        CONTINUE;
      END IF;

      SELECT id INTO v_event_id
      FROM events
      WHERE external_id = v_ev ->> 'external_id'
      LIMIT 1;

      IF v_event_id IS NULL AND v_ev ->> 'home_team' IS NOT NULL AND v_ev ->> 'away_team' IS NOT NULL THEN
        SELECT id INTO v_event_id
        FROM events
        WHERE home_team = v_ev ->> 'home_team'
          AND away_team = v_ev ->> 'away_team'
          AND is_live = TRUE
        LIMIT 1;

        IF v_event_id IS NOT NULL THEN
          UPDATE events SET external_id = v_ev ->> 'external_id'
          WHERE id = v_event_id;
        END IF;
      END IF;

      IF v_event_id IS NULL THEN
        IF v_ev ->> 'home_team' IS NULL OR v_ev ->> 'away_team' IS NULL OR v_ev ->> 'sport' IS NULL THEN
          v_errors := v_errors || jsonb_build_array(
            (v_ev ->> 'external_id') || ': event not found and missing creation fields'
          );
          CONTINUE;
        END IF;

        v_sport_slug := slugify(v_ev ->> 'sport');
        INSERT INTO sports (name, slug, icon, is_active)
        VALUES (v_ev ->> 'sport', v_sport_slug, sport_icon(v_sport_slug), TRUE)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_sport_id;

        v_league_name := COALESCE(v_ev ->> 'league', 'Sconosciuto');

        -- Usa helper upsert_league
        v_league_id := upsert_league(
          v_sport_id,
          v_league_name,
          v_sport_slug,
          v_ev ->> 'country',
          v_ev ->> 'country_code',
          v_ev ->> 'tour_code'
        );

        INSERT INTO events (external_id, sport_id, league_id, home_team, away_team, starts_at, status, is_live, updated_at)
        VALUES (
          v_ev ->> 'external_id', v_sport_id, v_league_id,
          v_ev ->> 'home_team', v_ev ->> 'away_team',
          COALESCE((v_ev ->> 'starts_at')::TIMESTAMPTZ, v_now),
          'live', TRUE, v_now
        )
        RETURNING id INTO v_event_id;

        v_inserted := v_inserted + 1;
      END IF;

      v_live_data := '{}'::JSONB;
      IF v_ev ->> 'period_code' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('periodCode', (v_ev ->> 'period_code')::INT);
      END IF;
      IF v_ev -> 'half_score_home' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('halfScoreHome', v_ev -> 'half_score_home');
      END IF;
      IF v_ev -> 'half_score_away' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('halfScoreAway', v_ev -> 'half_score_away');
      END IF;
      IF v_ev -> 'stats' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('stats', v_ev -> 'stats');
      END IF;
      IF v_ev -> 'match_events' IS NOT NULL THEN
        v_live_data := v_live_data || jsonb_build_object('matchEvents', v_ev -> 'match_events');
      END IF;

      v_is_ended := COALESCE(v_ev ->> 'period', '') IN ('ENDED', 'FINISHED', 'FULL_TIME', 'AFTER_EXTRA_TIME', 'AFTER_PENALTIES');

      UPDATE events SET
        status = CASE WHEN v_is_ended THEN 'finished' ELSE COALESCE(v_ev ->> 'status', 'live') END,
        is_live = NOT v_is_ended,
        minute = (v_ev ->> 'minute')::INT,
        score_home = (v_ev ->> 'home_score')::INT,
        score_away = (v_ev ->> 'away_score')::INT,
        period = v_ev ->> 'period',
        live_data = CASE WHEN v_live_data = '{}'::JSONB THEN NULL ELSE v_live_data END,
        updated_at = v_now
      WHERE id = v_event_id;

      IF v_is_ended THEN
        UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
        WHERE market_id IN (SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE);

        UPDATE markets SET is_active = FALSE, is_suspended = TRUE
        WHERE event_id = v_event_id AND is_active = TRUE;

        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      IF v_ev -> 'markets' IS NULL OR jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) = 0 THEN
        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      SELECT array_agg(DISTINCT m ->> 'type')
      INTO v_incoming_types
      FROM jsonb_array_elements(v_ev -> 'markets') AS m;

      UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
      WHERE market_id IN (
        SELECT id FROM markets
        WHERE event_id = v_event_id AND is_active = TRUE
          AND market_type <> ALL(v_incoming_types)
      );

      UPDATE markets SET is_active = FALSE, is_suspended = TRUE
      WHERE event_id = v_event_id AND is_active = TRUE
        AND market_type <> ALL(v_incoming_types);

      UPDATE outcomes SET is_suspended = TRUE
      WHERE market_id IN (
        SELECT id FROM markets
        WHERE event_id = v_event_id AND market_type = ANY(v_incoming_types)
      );

      FOR v_market IN SELECT * FROM jsonb_array_elements(v_ev -> 'markets')
      LOOP
        v_market_slug := slugify(v_market ->> 'type');
        v_market_line := extract_line(v_market ->> 'type');

        INSERT INTO markets (event_id, name, slug, market_type, line, is_active, is_suspended)
        VALUES (v_event_id, v_market ->> 'type', v_market_slug, v_market ->> 'type', v_market_line, TRUE, FALSE)
        ON CONFLICT (event_id, market_type) DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          line = EXCLUDED.line,
          is_active = TRUE,
          is_suspended = FALSE,
          updated_at = v_now
        RETURNING id INTO v_market_id;

        FOR v_outcome IN SELECT * FROM jsonb_array_elements(v_market -> 'outcomes')
        LOOP
          IF (v_outcome ->> 'odds')::NUMERIC <= 1 THEN
            CONTINUE;
          END IF;

          INSERT INTO outcomes (market_id, name, odds, is_active, is_suspended)
          VALUES (v_market_id, v_outcome ->> 'name', (v_outcome ->> 'odds')::NUMERIC, TRUE, FALSE)
          ON CONFLICT (market_id, name) DO UPDATE SET
            odds = EXCLUDED.odds,
            is_active = TRUE,
            is_suspended = FALSE;
        END LOOP;
      END LOOP;

      UPDATE events SET source_markets_count = jsonb_array_length(v_ev -> 'markets')
      WHERE id = v_event_id;

      v_updated := v_updated + 1;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(
        COALESCE(v_ev ->> 'external_id', 'unknown') || ': ' || SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated, 'inserted', v_inserted, 'errors', v_errors);
END;
$$;
