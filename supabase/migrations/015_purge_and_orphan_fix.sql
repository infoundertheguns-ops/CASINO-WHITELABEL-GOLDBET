-- ═══════════════════════════════════════════════════════════
-- Migration 015: Purge old ended events + improved orphan fix
-- - purge_old_ended_events(hours_old, batch_limit): cascade delete ended events
-- - fix_orphan_markets(): deactivate active markets+outcomes on non-active events
-- ═══════════════════════════════════════════════════════════

-- ── 1. Purge old ended events (cascade delete markets + outcomes) ──
CREATE OR REPLACE FUNCTION purge_old_ended_events(
    p_hours_old INT DEFAULT 48,
    p_batch_limit INT DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_event_ids UUID[];
    v_outcomes_deleted BIGINT := 0;
    v_markets_deleted BIGINT := 0;
    v_events_deleted BIGINT := 0;
    v_bet_selections_orphaned BIGINT := 0;
BEGIN
    -- Find old ended/finished/cancelled events with no open bets
    SELECT ARRAY_AGG(e.id)
    INTO v_event_ids
    FROM (
        SELECT e2.id
        FROM events e2
        WHERE e2.status IN ('ended', 'finished', 'cancelled', 'postponed')
          AND e2.updated_at < NOW() - (p_hours_old || ' hours')::INTERVAL
          -- Skip events that still have open/pending bets
          AND NOT EXISTS (
              SELECT 1 FROM bet_selections bs
              JOIN bets b ON b.id = bs.bet_id
              WHERE bs.event_id = e2.id
                AND b.status IN ('open', 'pending')
          )
        ORDER BY e2.updated_at ASC
        LIMIT p_batch_limit
    ) e2
    JOIN events e ON e.id = e2.id;

    IF v_event_ids IS NULL OR array_length(v_event_ids, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'events_deleted', 0,
            'markets_deleted', 0,
            'outcomes_deleted', 0
        );
    END IF;

    -- Delete outcomes first (FK dependency)
    DELETE FROM outcomes
    WHERE market_id IN (
        SELECT m.id FROM markets m WHERE m.event_id = ANY(v_event_ids)
    );
    GET DIAGNOSTICS v_outcomes_deleted = ROW_COUNT;

    -- Delete markets
    DELETE FROM markets
    WHERE event_id = ANY(v_event_ids);
    GET DIAGNOSTICS v_markets_deleted = ROW_COUNT;

    -- Nullify event_id in bet_selections (preserve bet history)
    UPDATE bet_selections
    SET event_id = NULL
    WHERE event_id = ANY(v_event_ids);
    GET DIAGNOSTICS v_bet_selections_orphaned = ROW_COUNT;

    -- Delete events
    DELETE FROM events
    WHERE id = ANY(v_event_ids);
    GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

    RETURN jsonb_build_object(
        'events_deleted', v_events_deleted,
        'markets_deleted', v_markets_deleted,
        'outcomes_deleted', v_outcomes_deleted,
        'bet_selections_orphaned', v_bet_selections_orphaned
    );
END;
$$;

-- ── 2. Fix orphan markets + outcomes (active on non-active events) ──
CREATE OR REPLACE FUNCTION fix_orphan_markets()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_markets_fixed BIGINT := 0;
    v_outcomes_fixed BIGINT := 0;
    v_batch_ids UUID[];
    v_batch_size INT := 200;
    v_offset INT := 0;
    v_total_markets BIGINT := 0;
    v_total_outcomes BIGINT := 0;
BEGIN
    -- Process in batches to avoid long locks
    LOOP
        -- Find active markets on non-active events
        SELECT ARRAY_AGG(m.id)
        INTO v_batch_ids
        FROM (
            SELECT m2.id
            FROM markets m2
            JOIN events e ON e.id = m2.event_id
            WHERE m2.is_active = TRUE
              AND e.status NOT IN ('prematch', 'live')
            ORDER BY m2.id
            LIMIT v_batch_size
            OFFSET v_offset
        ) m2
        JOIN markets m ON m.id = m2.id;

        EXIT WHEN v_batch_ids IS NULL OR array_length(v_batch_ids, 1) IS NULL;

        -- Deactivate outcomes for these markets
        BEGIN
            UPDATE outcomes
            SET is_active = FALSE, updated_at = NOW()
            WHERE market_id = ANY(v_batch_ids)
              AND is_active = TRUE;
            GET DIAGNOSTICS v_outcomes_fixed = ROW_COUNT;
            v_total_outcomes := v_total_outcomes + v_outcomes_fixed;
        EXCEPTION WHEN deadlock_detected THEN
            -- Skip this batch on deadlock, will retry next cron cycle
            RAISE NOTICE 'Deadlock on outcomes batch at offset %, skipping', v_offset;
        END;

        -- Deactivate the markets
        BEGIN
            UPDATE markets
            SET is_active = FALSE, updated_at = NOW()
            WHERE id = ANY(v_batch_ids);
            GET DIAGNOSTICS v_markets_fixed = ROW_COUNT;
            v_total_markets := v_total_markets + v_markets_fixed;
        EXCEPTION WHEN deadlock_detected THEN
            RAISE NOTICE 'Deadlock on markets batch at offset %, skipping', v_offset;
        END;

        -- If we got a full batch, there might be more
        IF array_length(v_batch_ids, 1) < v_batch_size THEN
            EXIT;
        END IF;

        -- Don't increment offset since we're deactivating rows (they'll disappear from the query)
        -- But add safety limit to prevent infinite loop
        v_offset := v_offset + v_batch_size;
        IF v_offset > 50000 THEN
            EXIT;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'markets_fixed', v_total_markets,
        'outcomes_fixed', v_total_outcomes
    );
END;
$$;
