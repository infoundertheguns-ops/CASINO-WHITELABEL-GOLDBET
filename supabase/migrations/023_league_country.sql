-- ═══════════════════════════════════════════════════════════
-- Migration 023: Populate leagues.country from scraper data
-- The country column already exists in leagues table (001).
-- Both RPCs now accept `country` from event payload and
-- write it to leagues with COALESCE (never overwrite with NULL).
-- ═══════════════════════════════════════════════════════════

-- ── 1. upsert_prematch_batch — add country to league upsert ──
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
  v_league_slug TEXT;
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

      v_league_slug := v_sport_slug || '-' || slugify(v_ev ->> 'league');
      INSERT INTO leagues (sport_id, name, slug, country, is_active)
      VALUES (v_sport_id, v_ev ->> 'league', v_league_slug, v_ev ->> 'country', TRUE)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        sport_id = EXCLUDED.sport_id,
        country = COALESCE(EXCLUDED.country, leagues.country)
      RETURNING id INTO v_league_id;

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

      -- Track source_markets_count: use GREATEST so partial scrapes never lower the count
      IF v_ev -> 'markets' IS NOT NULL
         AND jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) > 0 THEN
        v_batch_count := jsonb_array_length(v_ev -> 'markets');
        UPDATE events SET source_markets_count = GREATEST(COALESCE(source_markets_count, 0), v_batch_count)
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


-- ── 2. upsert_live_batch — add country to league upsert (auto-create block) ──
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
  v_league_slug TEXT;
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
    BEGIN  -- per-event exception block

      IF v_ev ->> 'external_id' IS NULL THEN
        v_errors := v_errors || jsonb_build_array('missing external_id');
        CONTINUE;
      END IF;

      -- ── 1. Find existing event by external_id ──
      SELECT id INTO v_event_id
      FROM events
      WHERE external_id = v_ev ->> 'external_id'
      LIMIT 1;

      -- Fallback: find by team names (catches dupes with different external_ids)
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

      -- ── 2. Auto-create if not found ──
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
        v_league_slug := v_sport_slug || '-' || slugify(v_league_name);

        INSERT INTO leagues (sport_id, name, slug, country, is_active)
        VALUES (v_sport_id, v_league_name, v_league_slug, v_ev ->> 'country', TRUE)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          sport_id = EXCLUDED.sport_id,
          country = COALESCE(EXCLUDED.country, leagues.country)
        RETURNING id INTO v_league_id;

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

      -- ── 3. Build live_data JSONB ──
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

      -- ── 4. Detect ended events ──
      v_is_ended := COALESCE(v_ev ->> 'period', '') IN ('ENDED', 'FINISHED', 'FULL_TIME', 'AFTER_EXTRA_TIME', 'AFTER_PENALTIES');

      -- ── Update event ──
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

      -- ── If event ended, deactivate all its markets + outcomes ──
      IF v_is_ended THEN
        UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
        WHERE market_id IN (SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE);

        UPDATE markets SET is_active = FALSE, is_suspended = TRUE
        WHERE event_id = v_event_id AND is_active = TRUE;

        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      -- ── 5. If no markets, skip market logic ──
      IF v_ev -> 'markets' IS NULL OR jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) = 0 THEN
        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      -- Collect incoming market types
      SELECT array_agg(DISTINCT m ->> 'type')
      INTO v_incoming_types
      FROM jsonb_array_elements(v_ev -> 'markets') AS m;

      -- ── 5a. Deactivate stale markets + their outcomes first ──
      UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
      WHERE market_id IN (
        SELECT id FROM markets
        WHERE event_id = v_event_id AND is_active = TRUE
          AND market_type <> ALL(v_incoming_types)
      );

      UPDATE markets SET is_active = FALSE, is_suspended = TRUE
      WHERE event_id = v_event_id AND is_active = TRUE
        AND market_type <> ALL(v_incoming_types);

      -- ── 5b. Suspend all outcomes of incoming markets (will be un-suspended by upsert) ──
      UPDATE outcomes SET is_suspended = TRUE
      WHERE market_id IN (
        SELECT id FROM markets
        WHERE event_id = v_event_id AND market_type = ANY(v_incoming_types)
      );

      -- ── 5c. Upsert markets + outcomes ──
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

        -- Upsert outcomes
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

      -- ── 5d. Track source_markets_count with ACTUAL live count ──
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
