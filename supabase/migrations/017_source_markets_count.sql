-- ═══════════════════════════════════════════════════════════
-- Migration 017: Source Markets Count + Gap-Based Coverage RPC
-- Adds source_markets_count to events (how many markets Goldbet/Kambi has)
-- Updates upsert_prematch_batch() to save the count
-- Replaces get_market_coverage() with gap-based version
-- ═══════════════════════════════════════════════════════════

-- ── a) Add column ──
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_markets_count INT;

-- ── b) Update upsert_prematch_batch() — save source_markets_count ──
CREATE OR REPLACE FUNCTION upsert_prematch_batch(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
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
  v_now TIMESTAMPTZ := now();
BEGIN
  v_events := payload -> 'events';

  IF v_events IS NULL OR jsonb_array_length(v_events) = 0 THEN
    RETURN jsonb_build_object('processed', 0, 'errors', jsonb_build_array('events array required'));
  END IF;

  FOR v_ev IN SELECT * FROM jsonb_array_elements(v_events)
  LOOP
    BEGIN  -- per-event exception block

      -- Validate required fields
      IF v_ev ->> 'external_id' IS NULL OR v_ev ->> 'sport' IS NULL
         OR v_ev ->> 'league' IS NULL OR v_ev ->> 'home_team' IS NULL
         OR v_ev ->> 'away_team' IS NULL OR v_ev ->> 'starts_at' IS NULL THEN
        v_errors := v_errors || jsonb_build_array(
          COALESCE(v_ev ->> 'external_id', 'unknown') || ': missing required fields'
        );
        CONTINUE;
      END IF;

      v_overview_only := COALESCE((v_ev ->> 'overview_only')::BOOLEAN, FALSE);

      -- ── 1. Upsert sport ──
      v_sport_slug := slugify(v_ev ->> 'sport');

      INSERT INTO sports (name, slug, icon, is_active)
      VALUES (v_ev ->> 'sport', v_sport_slug, sport_icon(v_sport_slug), TRUE)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_sport_id;

      -- ── 2. Upsert league ──
      v_league_slug := v_sport_slug || '-' || slugify(v_ev ->> 'league');

      INSERT INTO leagues (sport_id, name, slug, is_active)
      VALUES (v_sport_id, v_ev ->> 'league', v_league_slug, TRUE)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, sport_id = EXCLUDED.sport_id
      RETURNING id INTO v_league_id;

      -- ── 3. Find event by external_id, check is_live ──
      SELECT id, is_live INTO v_event_id, v_is_live
      FROM events
      WHERE external_id = v_ev ->> 'external_id'
      LIMIT 1;

      IF v_event_id IS NOT NULL AND v_is_live THEN
        -- Skip prematch update for live events
        v_processed := v_processed + 1;
        CONTINUE;
      END IF;

      -- ── 4. Update or insert event ──
      IF v_event_id IS NOT NULL THEN
        UPDATE events SET
          sport_id = v_sport_id,
          league_id = v_league_id,
          home_team = v_ev ->> 'home_team',
          away_team = v_ev ->> 'away_team',
          starts_at = (v_ev ->> 'starts_at')::TIMESTAMPTZ,
          status = COALESCE(v_ev ->> 'status', 'prematch'),
          is_live = FALSE,
          updated_at = v_now
        WHERE id = v_event_id;
      ELSE
        INSERT INTO events (external_id, sport_id, league_id, home_team, away_team, starts_at, status, is_live, updated_at)
        VALUES (
          v_ev ->> 'external_id', v_sport_id, v_league_id,
          v_ev ->> 'home_team', v_ev ->> 'away_team',
          (v_ev ->> 'starts_at')::TIMESTAMPTZ,
          COALESCE(v_ev ->> 'status', 'prematch'),
          FALSE, v_now
        )
        RETURNING id INTO v_event_id;
      END IF;

      v_processed := v_processed + 1;

      -- ── Save source_markets_count: always overwrite (scraper deduplicates before sending) ──
      IF v_ev -> 'markets' IS NOT NULL
         AND jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) > 0 THEN
        UPDATE events SET source_markets_count = jsonb_array_length(v_ev -> 'markets')
        WHERE id = v_event_id;
      END IF;

      -- ── Handle no markets ──
      IF v_ev -> 'markets' IS NULL OR jsonb_array_length(COALESCE(v_ev -> 'markets', '[]'::JSONB)) = 0 THEN
        IF NOT v_overview_only THEN
          -- Deactivate all active markets + their outcomes
          UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
          WHERE market_id IN (SELECT id FROM markets WHERE event_id = v_event_id AND is_active = TRUE);

          UPDATE markets SET is_active = FALSE, is_suspended = TRUE
          WHERE event_id = v_event_id AND is_active = TRUE;
        END IF;
        CONTINUE;
      END IF;

      -- ── 5. Upsert markets ──
      -- Collect incoming market types for stale detection
      SELECT array_agg(DISTINCT m ->> 'type')
      INTO v_incoming_types
      FROM jsonb_array_elements(v_ev -> 'markets') AS m;

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

        -- ── 7. Upsert outcomes ──
        FOR v_outcome IN SELECT * FROM jsonb_array_elements(v_market -> 'outcomes')
        LOOP
          -- Skip odds <= 1
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

      -- ── 6. Deactivate stale markets + outcomes (skip for overview_only) ──
      IF NOT v_overview_only THEN
        -- Deactivate outcomes of stale markets
        UPDATE outcomes SET is_active = FALSE, is_suspended = TRUE
        WHERE market_id IN (
          SELECT id FROM markets
          WHERE event_id = v_event_id AND is_active = TRUE
            AND market_type <> ALL(v_incoming_types)
        );

        -- Deactivate stale markets
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
$$;


-- ── c) Replace get_market_coverage() — gap-based version ──
CREATE OR REPLACE FUNCTION get_market_coverage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '10s'
AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH event_counts AS (
        -- Per-event: source_markets_count vs active markets in DB
        SELECT
            e.id AS event_id,
            e.external_id,
            e.home_team,
            e.away_team,
            e.starts_at,
            e.source,
            e.source_markets_count,
            s.name AS sport_name,
            s.slug AS sport_slug,
            l.name AS league_name,
            CASE WHEN e.status = 'live' THEN 'live' ELSE 'prematch' END AS status_bucket,
            COUNT(m.id)::INT AS vincitu_count
        FROM events e
        JOIN sports s ON s.id = e.sport_id
        LEFT JOIN leagues l ON l.id = e.league_id
        LEFT JOIN markets m ON m.event_id = e.id AND m.is_active = TRUE
        WHERE e.status IN ('prematch', 'live')
        GROUP BY e.id, e.external_id, e.home_team, e.away_team, e.starts_at,
                 e.source, e.source_markets_count, s.name, s.slug, l.name, e.status
    ),
    -- Summary: per sport/source/status
    summary AS (
        SELECT jsonb_agg(row_data ORDER BY total_events DESC, gap_total DESC NULLS LAST) AS data
        FROM (
            SELECT jsonb_build_object(
                'sport_name', sport_name,
                'sport_slug', sport_slug,
                'source', source,
                'status', status_bucket,
                'total_events', COUNT(*),
                'events_with_source', COUNT(*) FILTER (WHERE source_markets_count IS NOT NULL),
                'avg_source', ROUND(AVG(source_markets_count) FILTER (WHERE source_markets_count IS NOT NULL)::NUMERIC, 1),
                'avg_vincitu', ROUND(AVG(vincitu_count)::NUMERIC, 1),
                'gap_pct', CASE
                    WHEN AVG(source_markets_count) FILTER (WHERE source_markets_count IS NOT NULL) > 0
                    THEN ROUND(((1 - AVG(vincitu_count) FILTER (WHERE source_markets_count IS NOT NULL)::NUMERIC
                                    / AVG(source_markets_count) FILTER (WHERE source_markets_count IS NOT NULL)::NUMERIC) * 100)::NUMERIC, 1)
                    ELSE NULL
                END,
                'gap_total', SUM(GREATEST(COALESCE(source_markets_count, 0) - vincitu_count, 0))
                                FILTER (WHERE source_markets_count IS NOT NULL),
                'zero_markets', COUNT(*) FILTER (WHERE vincitu_count = 0)
            ) AS row_data,
            SUM(GREATEST(COALESCE(source_markets_count, 0) - vincitu_count, 0))
                FILTER (WHERE source_markets_count IS NOT NULL) AS gap_total,
            COUNT(*) AS total_events
            FROM event_counts
            GROUP BY sport_name, sport_slug, source, status_bucket
        ) agg
    ),
    -- Top 200 events with biggest gap (source > vincitu)
    gap_events AS (
        SELECT jsonb_agg(row_data ORDER BY gap DESC) AS data
        FROM (
            SELECT jsonb_build_object(
                'event_id', event_id,
                'external_id', external_id,
                'home_team', home_team,
                'away_team', away_team,
                'sport_name', sport_name,
                'sport_slug', sport_slug,
                'league_name', league_name,
                'source', source,
                'status', status_bucket,
                'source_count', source_markets_count,
                'vincitu_count', vincitu_count,
                'gap', source_markets_count - vincitu_count,
                'coverage_pct', CASE
                    WHEN source_markets_count > 0
                    THEN ROUND((vincitu_count::NUMERIC / source_markets_count * 100)::NUMERIC, 1)
                    ELSE 0
                END,
                'starts_at', starts_at
            ) AS row_data,
            source_markets_count - vincitu_count AS gap
            FROM event_counts
            WHERE source_markets_count IS NOT NULL
              AND source_markets_count > vincitu_count
            ORDER BY (source_markets_count - vincitu_count) DESC
            LIMIT 200
        ) ge
    ),
    -- Data availability (prematch only — live batch doesn't save source count)
    availability AS (
        SELECT
            COUNT(*) FILTER (WHERE status_bucket = 'prematch') AS total,
            COUNT(*) FILTER (WHERE status_bucket = 'prematch' AND source_markets_count IS NOT NULL) AS with_source
        FROM event_counts
    )
    SELECT jsonb_build_object(
        'summary', COALESCE((SELECT data FROM summary), '[]'::JSONB),
        'gap_events', COALESCE((SELECT data FROM gap_events), '[]'::JSONB),
        'total_events', (SELECT total FROM availability),
        'events_with_source', (SELECT with_source FROM availability),
        'generated_at', NOW()
    )
    INTO v_result;

    RETURN v_result;
END;
$$;
