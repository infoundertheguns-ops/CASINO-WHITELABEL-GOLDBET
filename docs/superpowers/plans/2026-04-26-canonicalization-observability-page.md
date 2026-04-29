# Canonicalization Observability Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new admin page `/admin/canonicalization` with two tabs (Inspector evento + Gerarchia 5-livelli KPI) backed by 2 read-only Postgres RPCs, providing observability over the entire canonicalization pipeline (sports → leagues → events → markets → outcomes) for the 3 sources Kambi/22bet/Betfair.

**Architecture:** Single Next.js App Router page in `app/admin/canonicalization/`, two client tabs reading from two new RPCs via API routes. Migration 122 adds only `canonicalization_overview()` and `inspect_event(text, int)` — no schema changes, no new tables. Sidebar gets one new nav item "🔭 Canonicalizzazione" in SISTEMA group.

**Tech Stack:** Next.js App Router, React Server Components (page shell) + Client Components (tabs), TypeScript, Supabase (Postgres + RPC), Vitest (unit), tsx + node script (RPC smoke tests).

**Spec:** `docs/superpowers/specs/2026-04-26-canonicalization-observability-page-design.md`

---

## File Structure

**Created (NEW):**
- `supabase/migrations/122_canonicalization_observability_rpcs.sql` — Mig 122: 2 RPCs
- `lib/admin/canonicalization-types.ts` — TypeScript types mirroring RPC JSONB outputs
- `lib/admin/canonicalization-signals.ts` — pure helpers (color/icon classification)
- `app/api/admin/canonicalization/overview/route.ts` — GET handler with 60s cache
- `app/api/admin/canonicalization/inspect/route.ts` — GET handler no-cache
- `app/admin/canonicalization/page.tsx` — page shell (server component, tab routing)
- `app/admin/canonicalization/inspector-tab.tsx` — client component for Inspector tab
- `app/admin/canonicalization/overview-tab.tsx` — client component for Gerarchia tab
- `app/admin/canonicalization/components/status-icon.tsx` — atomic icon w/ tooltip
- `app/admin/canonicalization/components/source-card.tsx` — single source card
- `app/admin/canonicalization/components/event-group.tsx` — wraps 1-3 source cards + cross-source footer
- `app/admin/canonicalization/components/kpi-strip.tsx` — single level KPI strip
- `tests/lib/admin/canonicalization-signals.test.ts` — unit tests for helpers

**Modified:**
- `app/admin/layout.tsx` — add nav item, title, activeId map, routeMap (4 small edits)

---

## Task 1: Migration 122 — write SQL with both RPCs

**Files:**
- Create: `supabase/migrations/122_canonicalization_observability_rpcs.sql`

**Reference:** Similar mig pattern in `supabase/migrations/117_event_norm_coverage_v2.sql`. Use `SET search_path = public, extensions` per memory pattern (immutable SQL functions accessing extension funcs).

- [ ] **Step 1.1: Create the migration SQL file**

```sql
-- Migration 122: Canonicalization observability RPCs (read-only).
--
-- Two functions for /admin/canonicalization page:
--   1. canonicalization_overview() → single JSONB with 5-level KPI snapshot.
--   2. inspect_event(p_query, p_limit) → array JSONB grouped events (1-3 source cards per group).
--
-- Both are read-only. No schema changes elsewhere.
-- Rollback: DROP FUNCTION canonicalization_overview(); DROP FUNCTION inspect_event(text, int);

-- ═══════════════════════════════════════════════════════════════════
-- RPC 1: canonicalization_overview()
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION canonicalization_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_result jsonb;
  v_total_sports int;
  v_total_leagues int;
  v_unknown_leagues int;
  v_betfair_unknown int;
  v_22bet_unknown int;
  v_total_events_active int;
  v_fs_mapped int;
  v_verified int;
  v_auto int;
  v_manual int;
  v_llm_auto int;
  v_kambi_total int; v_kambi_mapped int;
  v_22bet_total int; v_22bet_mapped int;
  v_betfair_total int; v_betfair_mapped int;
  v_total_markets int; v_canonical_markets int;
  v_total_outcomes int; v_canonical_outcomes int;
BEGIN
  -- Level 1: sports
  SELECT count(*) INTO v_total_sports FROM sports WHERE is_active;

  -- Level 2: leagues — Unknown sentinel = name='Unknown' OR name LIKE 'Unknown (%)'
  SELECT count(*) INTO v_total_leagues FROM leagues;
  SELECT count(*) INTO v_unknown_leagues
    FROM leagues
    WHERE name = 'Unknown' OR name LIKE 'Unknown (%)';

  -- Per-source unknown leagues — count leagues that ONLY have events from a given source AND name is Unknown.
  -- Approximation: count Unknown leagues that have ANY events from each source.
  SELECT count(DISTINCT l.id) INTO v_betfair_unknown
    FROM leagues l
    JOIN events e ON e.league_id = l.id
    WHERE (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
      AND e.external_id LIKE 'betfair:%'
      AND e.starts_at > now() - interval '14 days';

  SELECT count(DISTINCT l.id) INTO v_22bet_unknown
    FROM leagues l
    JOIN events e ON e.league_id = l.id
    WHERE (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
      AND e.external_id LIKE '22bet:%'
      AND e.starts_at > now() - interval '14 days';

  -- Level 3: events (active 7d, exclude 22bet placeholders, exclude ended) — same filter as event_normalization_coverage_pct
  SELECT count(*) INTO v_total_events_active
    FROM events
    WHERE status IN ('prematch', 'live')
      AND home_team NOT IN ('Home', 'Home (Special bets)')
      AND home_team NOT LIKE '% +'
      AND starts_at > now() - interval '7 days';

  SELECT count(*) INTO v_fs_mapped
    FROM events
    WHERE status IN ('prematch', 'live')
      AND home_team NOT IN ('Home', 'Home (Special bets)')
      AND home_team NOT LIKE '% +'
      AND starts_at > now() - interval '7 days'
      AND flashscore_id IS NOT NULL;

  SELECT count(*) INTO v_verified
    FROM event_normalization en
    JOIN events e ON e.id = en.event_id
    WHERE e.status IN ('prematch', 'live')
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
      AND e.starts_at > now() - interval '7 days'
      AND en.verified = true;

  -- per-stage breakdown (auto vs manual vs llm_auto)
  SELECT
    count(*) FILTER (WHERE en.verified_by IS NULL AND en.match_stage <> 'llm') AS auto_count,
    count(*) FILTER (WHERE en.verified_by IS NOT NULL) AS manual_count,
    count(*) FILTER (WHERE en.verified_by IS NULL AND en.match_stage = 'llm') AS llm_auto_count
  INTO v_auto, v_manual, v_llm_auto
  FROM event_normalization en
  JOIN events e ON e.id = en.event_id
  WHERE e.status IN ('prematch', 'live')
    AND e.home_team NOT IN ('Home', 'Home (Special bets)')
    AND e.home_team NOT LIKE '% +'
    AND e.starts_at > now() - interval '7 days'
    AND en.verified = true;

  -- per-source: total active + flashscore-mapped
  SELECT
    count(*) FILTER (WHERE external_id LIKE 'kambi:%'),
    count(*) FILTER (WHERE external_id LIKE 'kambi:%' AND flashscore_id IS NOT NULL),
    count(*) FILTER (WHERE external_id LIKE '22bet:%'),
    count(*) FILTER (WHERE external_id LIKE '22bet:%' AND flashscore_id IS NOT NULL),
    count(*) FILTER (WHERE external_id LIKE 'betfair:%'),
    count(*) FILTER (WHERE external_id LIKE 'betfair:%' AND flashscore_id IS NOT NULL)
  INTO v_kambi_total, v_kambi_mapped, v_22bet_total, v_22bet_mapped, v_betfair_total, v_betfair_mapped
  FROM events
  WHERE status IN ('prematch', 'live')
    AND home_team NOT IN ('Home', 'Home (Special bets)')
    AND home_team NOT LIKE '% +'
    AND starts_at > now() - interval '7 days';

  -- Level 4: markets — basic counts (refined later)
  SELECT count(*) INTO v_total_markets FROM markets WHERE is_active = true;
  -- Canonical markets: those with a non-null canonical_key in market_normalization (best-effort)
  SELECT count(*) INTO v_canonical_markets
    FROM markets m
    WHERE m.is_active = true
      AND EXISTS (
        SELECT 1 FROM market_normalization mn
        WHERE mn.source_market_type = m.market_type
          AND mn.canonical_key IS NOT NULL
      );

  -- Level 5: outcomes — basic counts
  SELECT count(DISTINCT name) INTO v_total_outcomes FROM outcomes WHERE is_active = true;
  v_canonical_outcomes := COALESCE((
    SELECT count(*) FROM outcome_normalization WHERE canonical_outcome_key IS NOT NULL
  ), 0);

  -- Build result JSONB
  v_result := jsonb_build_object(
    'generated_at', now(),
    'level_1_sports', jsonb_build_object(
      'total', v_total_sports,
      'canonical', v_total_sports,
      'pct', 100.0,
      'color', 'green'
    ),
    'level_2_leagues', jsonb_build_object(
      'total', v_total_leagues,
      'identified', v_total_leagues - v_unknown_leagues,
      'unknown', v_unknown_leagues,
      'pct', CASE WHEN v_total_leagues > 0
        THEN round(((v_total_leagues - v_unknown_leagues)::numeric / v_total_leagues) * 100, 1)
        ELSE 0 END,
      'color', CASE
        WHEN v_total_leagues = 0 THEN 'gray'
        WHEN ((v_total_leagues - v_unknown_leagues)::numeric / v_total_leagues) >= 0.9 THEN 'green'
        WHEN ((v_total_leagues - v_unknown_leagues)::numeric / v_total_leagues) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END,
      'per_source', jsonb_build_object(
        'kambi', jsonb_build_object('unknown', 0),
        '22bet', jsonb_build_object('unknown', v_22bet_unknown),
        'betfair', jsonb_build_object('unknown', v_betfair_unknown)
      )
    ),
    'level_3_events', jsonb_build_object(
      'total_active_7d', v_total_events_active,
      'flashscore_mapped', v_fs_mapped,
      'flashscore_pct', CASE WHEN v_total_events_active > 0
        THEN round((v_fs_mapped::numeric / v_total_events_active) * 100, 1)
        ELSE 0 END,
      'verified', v_verified,
      'verified_pct', CASE WHEN v_fs_mapped > 0
        THEN round((v_verified::numeric / v_fs_mapped) * 100, 1)
        ELSE 0 END,
      'per_stage', jsonb_build_object(
        'auto', v_auto,
        'manual', v_manual,
        'llm_auto', v_llm_auto
      ),
      'cross_source_canonical', 0,
      'cross_source_pct', 0.0,
      'source_only_flagged', 0,
      'color', CASE
        WHEN v_total_events_active = 0 THEN 'gray'
        WHEN (v_fs_mapped::numeric / v_total_events_active) >= 0.9 THEN 'green'
        WHEN (v_fs_mapped::numeric / v_total_events_active) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END,
      'per_source', jsonb_build_object(
        'kambi', jsonb_build_object(
          'total', v_kambi_total, 'mapped', v_kambi_mapped,
          'pct', CASE WHEN v_kambi_total > 0 THEN round((v_kambi_mapped::numeric / v_kambi_total) * 100, 1) ELSE 0 END
        ),
        '22bet', jsonb_build_object(
          'total', v_22bet_total, 'mapped', v_22bet_mapped,
          'pct', CASE WHEN v_22bet_total > 0 THEN round((v_22bet_mapped::numeric / v_22bet_total) * 100, 1) ELSE 0 END
        ),
        'betfair', jsonb_build_object(
          'total', v_betfair_total, 'mapped', v_betfair_mapped,
          'pct', CASE WHEN v_betfair_total > 0 THEN round((v_betfair_mapped::numeric / v_betfair_total) * 100, 1) ELSE 0 END
        )
      )
    ),
    'level_4_markets', jsonb_build_object(
      'total', v_total_markets,
      'canonical', v_canonical_markets,
      'pct', CASE WHEN v_total_markets > 0
        THEN round((v_canonical_markets::numeric / v_total_markets) * 100, 1)
        ELSE 0 END,
      'color', CASE
        WHEN v_total_markets = 0 THEN 'gray'
        WHEN (v_canonical_markets::numeric / v_total_markets) >= 0.9 THEN 'green'
        WHEN (v_canonical_markets::numeric / v_total_markets) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END
    ),
    'level_5_outcomes', jsonb_build_object(
      'total_distinct', v_total_outcomes,
      'canonical_seed', v_canonical_outcomes,
      'pct', CASE WHEN v_total_outcomes > 0
        THEN round((v_canonical_outcomes::numeric / v_total_outcomes) * 100, 1)
        ELSE 0 END,
      'color', CASE
        WHEN v_total_outcomes = 0 THEN 'gray'
        WHEN (v_canonical_outcomes::numeric / v_total_outcomes) >= 0.9 THEN 'green'
        WHEN (v_canonical_outcomes::numeric / v_total_outcomes) >= 0.6 THEN 'yellow'
        ELSE 'red'
      END
    )
  );

  RETURN v_result;
END;
$fn$;

GRANT EXECUTE ON FUNCTION canonicalization_overview() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- RPC 2: inspect_event(p_query text, p_limit int default 20)
-- ═══════════════════════════════════════════════════════════════════
--
-- Search events by team name / external_id / flashscore_id, group with cascading rules:
--   1. Same flashscore_id → group_type='flashscore'
--   2. Same sport + trigram(home_norm) ≥ 0.85 + trigram(away_norm) ≥ 0.85 + |starts_at delta| ≤ 60min → group_type='trigram'
--   3. Else isolated → group_type='isolated'
--
-- Returns array of groups with 1-3 events each (Kambi, 22bet, Betfair max).

CREATE OR REPLACE FUNCTION inspect_event(
  p_query text,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- CTE chain: filter → join → cluster → group
  WITH filtered AS (
    SELECT e.*,
      l.name AS league_name,
      l.country AS league_country,
      l.country_code AS league_country_code,
      l.tour_code AS league_tour_code,
      s.name AS sport_name,
      en.match_stage,
      en.confidence,
      en.verified,
      en.verified_by,
      en.llm_verify,
      CASE
        WHEN e.external_id LIKE 'kambi:%'   THEN 'kambi'
        WHEN e.external_id LIKE '22bet:%'   THEN '22bet'
        WHEN e.external_id LIKE 'betfair:%' THEN 'betfair'
        ELSE 'unknown'
      END AS source
    FROM events e
    LEFT JOIN leagues l ON l.id = e.league_id
    LEFT JOIN sports s ON s.id = e.sport_id
    LEFT JOIN event_normalization en ON en.event_id = e.id
    WHERE
      e.home_team ILIKE '%' || p_query || '%'
      OR e.away_team ILIKE '%' || p_query || '%'
      OR e.external_id = p_query
      OR e.flashscore_id = p_query
    ORDER BY e.starts_at DESC
    LIMIT 50
  ),
  -- Compute market/outcome counts per event
  enriched AS (
    SELECT
      f.*,
      (SELECT count(*) FROM markets m WHERE m.event_id = f.id AND m.is_active) AS markets_count,
      (SELECT count(*) FROM outcomes o JOIN markets m2 ON m2.id = o.market_id
        WHERE m2.event_id = f.id AND o.is_active) AS outcomes_count
    FROM filtered f
  ),
  -- Trigram cluster: find pairs with score ≥ 0.85 in same sport ±60min
  pairs AS (
    SELECT a.id AS a_id, b.id AS b_id
    FROM enriched a, enriched b
    WHERE a.id < b.id
      AND a.sport_id = b.sport_id
      AND a.flashscore_id IS NULL
      AND b.flashscore_id IS NULL
      AND abs(extract(epoch FROM (a.starts_at - b.starts_at))) <= 3600
      AND similarity(normalize_team_name(a.home_team), normalize_team_name(b.home_team)) >= 0.85
      AND similarity(normalize_team_name(a.away_team), normalize_team_name(b.away_team)) >= 0.85
  ),
  -- Connected components via recursive CTE on undirected pair graph.
  -- For each event, compute MIN(id) reachable through pairs → that's the cluster_id.
  -- Handles transitive merges (A-B + B-C → all 3 in one cluster).
  pairs_undir AS (
    SELECT a_id AS x, b_id AS y FROM pairs
    UNION ALL
    SELECT b_id, a_id FROM pairs
  ),
  reachable(start_id, reach_id) AS (
    SELECT id, id FROM enriched
    UNION
    SELECT r.start_id, p.y
    FROM reachable r
    JOIN pairs_undir p ON p.x = r.reach_id
  ),
  cluster_min AS (
    SELECT start_id AS id, MIN(reach_id) AS cluster_id
    FROM reachable
    GROUP BY start_id
  ),
  grouping AS (
    SELECT en.*,
      CASE
        WHEN en.flashscore_id IS NOT NULL THEN 'fs:' || en.flashscore_id
        WHEN EXISTS (SELECT 1 FROM pairs p WHERE p.a_id = en.id OR p.b_id = en.id)
          THEN 'trigram:' || cm.cluster_id::text
        ELSE 'iso:' || en.id::text
      END AS group_key
    FROM enriched en
    JOIN cluster_min cm ON cm.id = en.id
  ),
  agg AS (
    SELECT
      group_key,
      -- Derive group_type deterministically from group_key prefix (stable across rows)
      CASE
        WHEN group_key LIKE 'fs:%'      THEN 'flashscore'
        WHEN group_key LIKE 'trigram:%' THEN 'trigram'
        ELSE 'isolated'
      END AS group_type,
      MIN(starts_at) AS group_starts_at,
      -- Stable label: pick first by sort order (source then external_id) instead of MAX (non-deterministic)
      (array_agg(home_team || ' vs ' || away_team ORDER BY source, external_id))[1] AS group_label,
      (array_agg(sport_name ORDER BY source, external_id))[1] AS group_sport,
      jsonb_agg(
        jsonb_build_object(
          'source', source,
          'external_id', external_id,
          'home_team', home_team,
          'away_team', away_team,
          'sport', sport_name,
          'league_name', league_name,
          'league_id', league_id,
          'country', league_country,
          'country_code', league_country_code,
          'tour_code', league_tour_code,
          'starts_at', starts_at,
          'status', status,
          'flashscore_id', flashscore_id,
          'match_stage', match_stage,
          'confidence', confidence,
          'verified', verified,
          'verified_by', verified_by,
          'llm_verify', llm_verify,
          'canonical_id', NULL,            -- Task #2 placeholder
          'is_source_only', NULL,           -- Task #2 placeholder
          'markets_count', markets_count,
          'outcomes_count', outcomes_count,
          'field_signals', jsonb_build_object(
            'league_name', CASE
              WHEN league_name IS NULL THEN 'absent_problem'
              WHEN league_name = 'Unknown' OR league_name LIKE 'Unknown (%)' THEN 'variant'
              ELSE 'ok' END,
            'country',  CASE WHEN league_country IS NULL THEN 'absent_ok' ELSE 'ok' END,
            'tour_code', CASE WHEN league_tour_code IS NULL THEN 'absent_ok' ELSE 'ok' END,
            'flashscore_id', CASE
              WHEN flashscore_id IS NULL THEN 'absent_problem'
              WHEN verified = true THEN 'ok_verified'
              ELSE 'ok' END,
            'canonical_id',  'feature_pending',
            'is_source_only','feature_pending'
          )
        )
        ORDER BY source
      ) AS events
    FROM grouping
    GROUP BY group_key
    ORDER BY MIN(starts_at) DESC
    LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'group_key', group_key,
      'group_type', group_type,
      'real_world_label', group_label || ' · ' || to_char(group_starts_at, 'YYYY-MM-DD HH24:MI') || ' · ' || group_sport,
      'events', events
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM agg;

  RETURN v_result;
END;
$fn$;

GRANT EXECUTE ON FUNCTION inspect_event(text, int) TO authenticated;
```

- [ ] **Step 1.2: Apply migration to staging**

Run from repo root:
```bash
node scripts/db/apply-mig.mjs --target staging --file supabase/migrations/122_canonicalization_observability_rpcs.sql
```

Expected: "Applied 122_… on staging" or similar success line. If error mentions missing extension function → verify `unaccent` and `pg_trgm` extensions enabled (they already are per memory mig 118).

- [ ] **Step 1.3: Smoke-test RPCs from staging**

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SERVICE_ROLE_KEY);
(async () => {
  const o = await sb.rpc('canonicalization_overview');
  console.log('overview ok:', !o.error);
  console.log(JSON.stringify(o.data, null, 2).slice(0, 1500));
  const i = await sb.rpc('inspect_event', { p_query: 'Roma', p_limit: 5 });
  console.log('inspect ok:', !i.error);
  console.log(JSON.stringify(i.data, null, 2).slice(0, 1500));
})();
"
```

Expected:
- `overview ok: true` + a JSON with `level_1_sports.total > 0`, `level_3_events.total_active_7d > 0`.
- `inspect ok: true` + an array (possibly empty if no "Roma" events; try other team like "Inter" or "Milan" if empty).

If either RPC errors, fix migration SQL and re-apply.

- [ ] **Step 1.4: Commit migration**

```bash
git add supabase/migrations/122_canonicalization_observability_rpcs.sql
git commit -m "feat(mig 122): canonicalization observability RPCs

Add canonicalization_overview() and inspect_event(text, int).
Both read-only. No schema changes.

Spec: docs/superpowers/specs/2026-04-26-canonicalization-observability-page-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TypeScript types matching RPC outputs

**Files:**
- Create: `lib/admin/canonicalization-types.ts`

- [ ] **Step 2.1: Write the types file**

```typescript
// lib/admin/canonicalization-types.ts
// TypeScript types mirroring JSONB output of mig 122 RPCs.

export type SignalState =
  | 'ok'
  | 'ok_verified'
  | 'variant'
  | 'absent_ok'
  | 'absent_problem'
  | 'feature_pending';

export type LevelColor = 'green' | 'yellow' | 'red' | 'gray';

export interface SourceEventCard {
  source: 'kambi' | '22bet' | 'betfair' | 'unknown';
  external_id: string;
  home_team: string;
  away_team: string;
  sport: string | null;
  league_name: string | null;
  league_id: string | null;
  country: string | null;
  country_code: string | null;
  tour_code: string | null;
  starts_at: string;
  status: string;
  flashscore_id: string | null;
  match_stage: string | null;
  confidence: number | null;
  verified: boolean | null;
  verified_by: string | null;
  llm_verify: boolean | null;
  canonical_id: string | null;
  is_source_only: boolean | null;
  markets_count: number;
  outcomes_count: number;
  field_signals: Record<string, SignalState>;
}

export interface EventGroup {
  group_key: string;
  group_type: 'flashscore' | 'trigram' | 'isolated';
  real_world_label: string;
  events: SourceEventCard[];
}

export type InspectResponse = EventGroup[];

export interface LevelOverview {
  total: number;
  pct: number;
  color: LevelColor;
  // Level-specific extras
  [key: string]: unknown;
}

export interface OverviewResponse {
  generated_at: string;
  level_1_sports: LevelOverview;
  level_2_leagues: LevelOverview & {
    identified: number;
    unknown: number;
    per_source: {
      kambi: { unknown: number };
      '22bet': { unknown: number };
      betfair: { unknown: number };
    };
  };
  level_3_events: LevelOverview & {
    total_active_7d: number;
    flashscore_mapped: number;
    flashscore_pct: number;
    verified: number;
    verified_pct: number;
    per_stage: { auto: number; manual: number; llm_auto: number };
    cross_source_canonical: number;
    cross_source_pct: number;
    source_only_flagged: number;
    per_source: Record<'kambi' | '22bet' | 'betfair', { total: number; mapped: number; pct: number }>;
  };
  level_4_markets: LevelOverview & { canonical: number };
  level_5_outcomes: LevelOverview & { total_distinct: number; canonical_seed: number };
}
```

- [ ] **Step 2.2: Commit**

```bash
git add lib/admin/canonicalization-types.ts
git commit -m "feat: types for canonicalization observability RPCs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Signal helpers (TDD)

**Files:**
- Create: `tests/lib/admin/canonicalization-signals.test.ts`
- Create: `lib/admin/canonicalization-signals.ts`

- [ ] **Step 3.1: Write failing tests**

```typescript
// tests/lib/admin/canonicalization-signals.test.ts
import { describe, it, expect } from 'vitest';
import {
  signalToIcon,
  signalToTooltip,
  pctToColor,
  formatPct,
} from '@/lib/admin/canonicalization-signals';

describe('signalToIcon', () => {
  it('returns ✅ for ok / ok_verified', () => {
    expect(signalToIcon('ok')).toBe('✅');
    expect(signalToIcon('ok_verified')).toBe('✅');
  });
  it('returns ⚠️ for variant', () => {
    expect(signalToIcon('variant')).toBe('⚠️');
  });
  it('returns ❌ for absent_problem', () => {
    expect(signalToIcon('absent_problem')).toBe('❌');
  });
  it('returns ✓ for absent_ok', () => {
    expect(signalToIcon('absent_ok')).toBe('✓');
  });
  it('returns 🚧 for feature_pending', () => {
    expect(signalToIcon('feature_pending')).toBe('🚧');
  });
});

describe('signalToTooltip', () => {
  it('returns Italian descriptions', () => {
    expect(signalToTooltip('ok')).toContain('canonicalizzato');
    expect(signalToTooltip('variant')).toContain('variant');
    expect(signalToTooltip('feature_pending')).toContain('Task');
  });
});

describe('pctToColor', () => {
  it('green at >=90%', () => {
    expect(pctToColor(90)).toBe('green');
    expect(pctToColor(100)).toBe('green');
  });
  it('yellow 60-90%', () => {
    expect(pctToColor(60)).toBe('yellow');
    expect(pctToColor(89.9)).toBe('yellow');
  });
  it('red below 60%', () => {
    expect(pctToColor(0)).toBe('red');
    expect(pctToColor(59.9)).toBe('red');
  });
  it('gray for null/undefined', () => {
    expect(pctToColor(null as any)).toBe('gray');
  });
});

describe('formatPct', () => {
  it('1 decimal place with %', () => {
    expect(formatPct(54.0)).toBe('54.0%');
    expect(formatPct(99.95)).toBe('99.9%'); // truncate, not round
  });
  it('handles 0 and 100', () => {
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(100)).toBe('100.0%');
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/admin/canonicalization-signals.test.ts`
Expected: FAIL — module not found (`Cannot find module '@/lib/admin/canonicalization-signals'`).

- [ ] **Step 3.3: Implement helpers**

```typescript
// lib/admin/canonicalization-signals.ts
// Pure helpers for /admin/canonicalization page UI (color/icon/tooltip).

import type { SignalState, LevelColor } from './canonicalization-types';

export function signalToIcon(s: SignalState): string {
  switch (s) {
    case 'ok':
    case 'ok_verified':
      return '✅';
    case 'variant':
      return '⚠️';
    case 'absent_ok':
      return '✓';
    case 'absent_problem':
      return '❌';
    case 'feature_pending':
      return '🚧';
    default:
      return '?';
  }
}

export function signalToTooltip(s: SignalState): string {
  switch (s) {
    case 'ok':
      return 'Presente e canonicalizzato';
    case 'ok_verified':
      return 'Presente, canonicalizzato e verificato';
    case 'variant':
      return 'Presente ma con variant del valore (es. "Unknown" o nome non standard)';
    case 'absent_ok':
      return 'Campo opzionale non popolato (atteso)';
    case 'absent_problem':
      return 'Campo che il source dovrebbe popolare ma non lo fa';
    case 'feature_pending':
      return 'Feature non ancora attiva — vedi roadmap Task #2 / #3';
    default:
      return 'Stato sconosciuto';
  }
}

export function pctToColor(pct: number | null | undefined): LevelColor {
  if (pct === null || pct === undefined) return 'gray';
  if (pct >= 90) return 'green';
  if (pct >= 60) return 'yellow';
  return 'red';
}

export function formatPct(pct: number): string {
  // Truncate to 1 decimal (not round) to avoid 99.95 → "100.0%" off-by-one optics
  const truncated = Math.floor(pct * 10) / 10;
  return `${truncated.toFixed(1)}%`;
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/admin/canonicalization-signals.test.ts`
Expected: PASS — all 13 cases green.

- [ ] **Step 3.5: Commit**

```bash
git add lib/admin/canonicalization-signals.ts tests/lib/admin/canonicalization-signals.test.ts
git commit -m "feat: signal helpers for canonicalization page

Pure functions for icon/color/tooltip/pct mapping. 13 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: API routes

**Files:**
- Create: `app/api/admin/canonicalization/overview/route.ts`
- Create: `app/api/admin/canonicalization/inspect/route.ts`

- [ ] **Step 4.1: Write overview route**

```typescript
// app/api/admin/canonicalization/overview/route.ts
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { unstable_cache } from 'next/cache';

const getOverview = unstable_cache(
  async () => {
    const sb = createAdminClient();
    const { data, error } = await sb.rpc('canonicalization_overview');
    if (error) throw new Error(error.message);
    return data;
  },
  ['canonicalization-overview'],
  { revalidate: 60 } // 60s cache
);

export async function GET() {
  try {
    const data = await getOverview();
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 4.2: Write inspect route**

```typescript
// app/api/admin/canonicalization/inspect/route.ts
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));

  if (q.length < 2) {
    return NextResponse.json({ groups: [] });
  }

  const sb = createAdminClient();
  const { data, error } = await sb.rpc('inspect_event', {
    p_query: q,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ groups: data ?? [] });
}
```

- [ ] **Step 4.3: Commit**

```bash
git add app/api/admin/canonicalization/
git commit -m "feat: API routes for canonicalization observability

GET /api/admin/canonicalization/overview (60s cache)
GET /api/admin/canonicalization/inspect?q=...&limit=20

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Atomic UI component — StatusIcon

**Files:**
- Create: `app/admin/canonicalization/components/status-icon.tsx`

- [ ] **Step 5.1: Write component**

```tsx
// app/admin/canonicalization/components/status-icon.tsx
"use client";
import type { SignalState } from '@/lib/admin/canonicalization-types';
import { signalToIcon, signalToTooltip } from '@/lib/admin/canonicalization-signals';

export function StatusIcon({ state }: { state: SignalState }) {
  return (
    <span
      title={signalToTooltip(state)}
      className="inline-block w-5 text-center"
      aria-label={signalToTooltip(state)}
    >
      {signalToIcon(state)}
    </span>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add app/admin/canonicalization/components/status-icon.tsx
git commit -m "feat: StatusIcon atomic component"
```

---

## Task 6: Composite UI components — SourceCard, EventGroup, KpiStrip

**Files:**
- Create: `app/admin/canonicalization/components/source-card.tsx`
- Create: `app/admin/canonicalization/components/event-group.tsx`
- Create: `app/admin/canonicalization/components/kpi-strip.tsx`

- [ ] **Step 6.1: SourceCard**

```tsx
// app/admin/canonicalization/components/source-card.tsx
"use client";
import type { SourceEventCard } from '@/lib/admin/canonicalization-types';
import { StatusIcon } from './status-icon';

const SOURCE_LABELS: Record<string, string> = {
  kambi: 'KAMBI',
  '22bet': '22BET',
  betfair: 'BETFAIR',
  unknown: '?',
};

export function SourceCard({ event }: { event: SourceEventCard }) {
  const sig = event.field_signals;
  const rows: Array<[string, React.ReactNode, keyof typeof sig | null]> = [
    ['external_id', event.external_id, null],
    ['home_team', event.home_team, null],
    ['away_team', event.away_team, null],
    ['sport', event.sport ?? '—', null],
    ['league', event.league_name ?? '—', 'league_name'],
    ['country', event.country ?? event.country_code ?? '—', 'country'],
    ['tour_code', event.tour_code ?? '—', 'tour_code'],
    ['starts_at', new Date(event.starts_at).toLocaleString('it-IT'), null],
    ['status', event.status, null],
    [
      'flashscore_id',
      event.flashscore_id
        ? `${event.flashscore_id} (${event.match_stage ?? '?'} ${event.confidence?.toFixed(2) ?? ''})`
        : '—',
      'flashscore_id',
    ],
    ['canonical_id', event.canonical_id ?? '—', 'canonical_id'],
    ['markets · outcomes', `${event.markets_count} · ${event.outcomes_count}`, null],
  ];

  return (
    <div className="border rounded p-3 text-xs flex-1 min-w-[260px]" style={{ borderColor: 'var(--admin-border)' }}>
      <div className="font-bold mb-2">{SOURCE_LABELS[event.source] ?? event.source}</div>
      <table className="w-full">
        <tbody>
          {rows.map(([label, value, sigKey], idx) => (
            <tr key={idx}>
              <td className="font-medium pr-2 align-top opacity-70">{label}</td>
              <td className="break-all">{value}</td>
              <td className="pl-1 align-top">
                {sigKey && sig[sigKey] && <StatusIcon state={sig[sigKey]} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6.2: EventGroup**

```tsx
// app/admin/canonicalization/components/event-group.tsx
"use client";
import type { EventGroup as TGroup } from '@/lib/admin/canonicalization-types';
import { SourceCard } from './source-card';

export function EventGroup({ group }: { group: TGroup }) {
  const groupTypeBadge = {
    flashscore: '🟢 linked via flashscore_id',
    trigram: '🟡 linked via trigram (heuristic)',
    isolated: '🔵 isolated — possibly a missed cross-source match',
  }[group.group_type];

  const crossSourceMsg = (() => {
    const sources = new Set(group.events.map(e => e.source));
    if (sources.size === 3) return '✅ 3/3 source canonical';
    if (sources.size === 2) return '⚠️ 2/3 source linked, 1 missing';
    return '❌ Single source only — Task #2 will surface cross-source duplicates';
  })();

  return (
    <section className="border rounded p-4 mb-4" style={{ borderColor: 'var(--admin-border)' }}>
      <header className="flex justify-between items-start mb-3">
        <div>
          <div className="font-semibold">{group.real_world_label}</div>
          <div className="text-xs opacity-70">{groupTypeBadge}</div>
        </div>
      </header>
      <div className="flex flex-wrap gap-3">
        {group.events.map(e => (
          <SourceCard key={e.external_id} event={e} />
        ))}
      </div>
      <footer className="text-xs mt-3 opacity-80">{crossSourceMsg}</footer>
    </section>
  );
}
```

- [ ] **Step 6.3: KpiStrip**

```tsx
// app/admin/canonicalization/components/kpi-strip.tsx
"use client";
import type { LevelColor } from '@/lib/admin/canonicalization-types';
import { formatPct } from '@/lib/admin/canonicalization-signals';

const COLOR_BG: Record<LevelColor, string> = {
  green: 'bg-emerald-100 border-emerald-400',
  yellow: 'bg-amber-100 border-amber-400',
  red: 'bg-red-100 border-red-400',
  gray: 'bg-zinc-100 border-zinc-400',
};

const COLOR_DOT: Record<LevelColor, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  gray: '⚪',
};

export interface KpiStripProps {
  level: 1 | 2 | 3 | 4 | 5;
  title: string;
  total: number;
  pct: number;
  color: LevelColor;
  detail?: React.ReactNode;
  perSource?: React.ReactNode;
  drillDownHref?: string;
}

export function KpiStrip({ level, title, total, pct, color, detail, perSource, drillDownHref }: KpiStripProps) {
  return (
    <div className={`border-l-4 p-4 mb-3 rounded-r ${COLOR_BG[color]}`}>
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-sm">
          LEVEL {level}: {title.toUpperCase()} {COLOR_DOT[color]}
        </h3>
        {drillDownHref && (
          <a href={drillDownHref} className="text-xs underline opacity-80">
            drill-down →
          </a>
        )}
      </div>
      <div className="text-2xl font-mono mt-1">{formatPct(pct)}</div>
      <div className="text-xs opacity-80">total {total}</div>
      {detail && <div className="text-xs mt-2">{detail}</div>}
      {perSource && <div className="text-xs mt-2 opacity-80">{perSource}</div>}
    </div>
  );
}
```

- [ ] **Step 6.4: Commit**

```bash
git add app/admin/canonicalization/components/
git commit -m "feat: SourceCard, EventGroup, KpiStrip components"
```

---

## Task 7: Inspector tab client

**Files:**
- Create: `app/admin/canonicalization/inspector-tab.tsx`

- [ ] **Step 7.1: Write component**

```tsx
// app/admin/canonicalization/inspector-tab.tsx
"use client";
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { InspectResponse } from '@/lib/admin/canonicalization-types';
import { EventGroup } from './components/event-group';

export function InspectorTab() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params.get('q') ?? '';
  const [q, setQ] = useState(initialQ);
  const [groups, setGroups] = useState<InspectResponse>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced fetch
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setGroups([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/admin/canonicalization/inspect?q=${encodeURIComponent(trimmed)}&limit=20`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        setGroups(json.groups ?? []);
        // Update URL persistently
        const next = new URLSearchParams(params.toString());
        next.set('q', trimmed);
        router.replace(`?${next.toString()}`, { scroll: false });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Errore');
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <input
        type="search"
        placeholder="Cerca team / external_id / flashscore_id..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full max-w-md px-3 py-2 border rounded mb-4"
        style={{ borderColor: 'var(--admin-border)' }}
        autoFocus
      />
      {loading && <div className="text-sm opacity-70 mb-2">Caricamento...</div>}
      {error && <div className="text-sm text-red-600 mb-2">Errore: {error}</div>}
      {!loading && !error && q.trim().length >= 2 && groups.length === 0 && (
        <div className="text-sm opacity-70">Nessun risultato per "{q}".</div>
      )}
      {groups.map((g) => (
        <EventGroup key={g.group_key} group={g} />
      ))}
    </div>
  );
}
```

- [ ] **Step 7.2: Commit**

```bash
git add app/admin/canonicalization/inspector-tab.tsx
git commit -m "feat: Inspector tab — search + grouped results"
```

---

## Task 8: Overview tab client

**Files:**
- Create: `app/admin/canonicalization/overview-tab.tsx`

- [ ] **Step 8.1: Write component**

```tsx
// app/admin/canonicalization/overview-tab.tsx
"use client";
import { useEffect, useState } from 'react';
import type { OverviewResponse } from '@/lib/admin/canonicalization-types';
import { KpiStrip } from './components/kpi-strip';
import { formatPct } from '@/lib/admin/canonicalization-signals';

export function OverviewTab() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/canonicalization/overview');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  if (loading) return <div className="text-sm opacity-70">Caricamento KPI...</div>;
  if (error) return <div className="text-sm text-red-600">Errore: {error}</div>;
  if (!data) return null;

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-3 text-xs opacity-70">
        <span>Generato: {new Date(data.generated_at).toLocaleString('it-IT')}</span>
        <button onClick={reload} className="underline">↻ Aggiorna</button>
      </div>

      <KpiStrip
        level={1}
        title="Sports"
        total={data.level_1_sports.total as number}
        pct={data.level_1_sports.pct}
        color={data.level_1_sports.color}
      />

      <KpiStrip
        level={2}
        title="Leagues"
        total={data.level_2_leagues.total}
        pct={data.level_2_leagues.pct}
        color={data.level_2_leagues.color}
        detail={
          <>
            <span>Identified: {data.level_2_leagues.identified}</span>
            {' · '}
            <span>Unknown: {data.level_2_leagues.unknown}</span>
          </>
        }
        perSource={
          <>
            kambi: {data.level_2_leagues.per_source.kambi.unknown} unknown · 22bet: {data.level_2_leagues.per_source['22bet'].unknown} unknown · betfair: {data.level_2_leagues.per_source.betfair.unknown} unknown
          </>
        }
      />

      <KpiStrip
        level={3}
        title="Events (active 7d)"
        total={data.level_3_events.total_active_7d}
        pct={data.level_3_events.flashscore_pct}
        color={data.level_3_events.color}
        detail={
          <>
            <div>Flashscore mapped: {data.level_3_events.flashscore_mapped} ({formatPct(data.level_3_events.flashscore_pct)})</div>
            <div>Verified: {data.level_3_events.verified} ({formatPct(data.level_3_events.verified_pct)} dei mapped)</div>
            <div>Per stage: 🤖 auto {data.level_3_events.per_stage.auto} · 👤 manual {data.level_3_events.per_stage.manual} · 🤖 LLM auto {data.level_3_events.per_stage.llm_auto}</div>
            <div>🚧 Cross-source canonical: {data.level_3_events.cross_source_canonical} (Task #2 pending)</div>
            <div>🚧 Source-only flagged: {data.level_3_events.source_only_flagged} (Task #2 pending)</div>
          </>
        }
        perSource={
          <>
            kambi: {data.level_3_events.per_source.kambi.mapped}/{data.level_3_events.per_source.kambi.total} ({formatPct(data.level_3_events.per_source.kambi.pct)})
            {' · '}
            22bet: {data.level_3_events.per_source['22bet'].mapped}/{data.level_3_events.per_source['22bet'].total} ({formatPct(data.level_3_events.per_source['22bet'].pct)})
            {' · '}
            betfair: {data.level_3_events.per_source.betfair.mapped}/{data.level_3_events.per_source.betfair.total} ({formatPct(data.level_3_events.per_source.betfair.pct)})
          </>
        }
        drillDownHref="/admin/event-normalization"
      />

      <KpiStrip
        level={4}
        title="Markets"
        total={data.level_4_markets.total}
        pct={data.level_4_markets.pct}
        color={data.level_4_markets.color}
        detail={<>Canonicalized: {data.level_4_markets.canonical}</>}
        drillDownHref="/admin/market-normalization"
      />

      <KpiStrip
        level={5}
        title="Outcomes"
        total={data.level_5_outcomes.total_distinct}
        pct={data.level_5_outcomes.pct}
        color={data.level_5_outcomes.color}
        detail={<>Canonical seed: {data.level_5_outcomes.canonical_seed}</>}
        drillDownHref="/admin/outcome-normalization"
      />
    </div>
  );
}
```

- [ ] **Step 8.2: Commit**

```bash
git add app/admin/canonicalization/overview-tab.tsx
git commit -m "feat: Overview tab — 5-level KPI strips"
```

---

## Task 9: Page shell + sidebar nav

**Files:**
- Create: `app/admin/canonicalization/page.tsx`
- Modify: `app/admin/layout.tsx`

- [ ] **Step 9.1: Write page shell**

```tsx
// app/admin/canonicalization/page.tsx
"use client";
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { InspectorTab } from './inspector-tab';
import { OverviewTab } from './overview-tab';

export default function CanonicalizationPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'overview' ? 'overview' : 'inspector';

  const setTab = (t: 'inspector' | 'overview') => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', t);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="p-4">
      <header className="mb-4">
        <h1 className="text-xl font-bold">🔭 Canonicalizzazione</h1>
        <p className="text-xs opacity-70">
          Vista unica della pipeline: payload raw per source + gerarchia KPI 5-livelli.
        </p>
      </header>

      <div className="flex gap-2 border-b mb-4" style={{ borderColor: 'var(--admin-border)' }}>
        <button
          onClick={() => setTab('inspector')}
          className={`px-3 py-2 text-sm ${tab === 'inspector' ? 'border-b-2 font-semibold' : 'opacity-70'}`}
          style={tab === 'inspector' ? { borderColor: 'var(--admin-text)' } : undefined}
        >
          🔍 Inspector evento
        </button>
        <button
          onClick={() => setTab('overview')}
          className={`px-3 py-2 text-sm ${tab === 'overview' ? 'border-b-2 font-semibold' : 'opacity-70'}`}
          style={tab === 'overview' ? { borderColor: 'var(--admin-text)' } : undefined}
        >
          📊 Gerarchia & KPI
        </button>
      </div>

      <Suspense fallback={<div className="text-sm opacity-70">Caricamento...</div>}>
        {tab === 'inspector' ? <InspectorTab /> : <OverviewTab />}
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 9.2: Modify sidebar — add to NAVIGATION array**

In `app/admin/layout.tsx`, find the SISTEMA group items array. Insert the new item DIRECTLY ABOVE the existing line containing `id: "market-normalization"`:

```typescript
      { id: "canonicalization", icon: "🔭", label: "Canonicalizzazione" },
```

- [ ] **Step 9.3: Modify TITLES map**

In `app/admin/layout.tsx`, find the `TITLES` const (object). Insert ABOVE the existing line containing `"market-normalization": "Normalizzazione Mercati"`:

```typescript
  canonicalization: "Canonicalizzazione",
```

- [ ] **Step 9.4: Modify activeId map**

In `app/admin/layout.tsx`, find the `activeId` `useMemo`. Insert ABOVE the existing line containing `if (parts[1] === "market-normalization")`:

```typescript
    if (parts[1] === "canonicalization") return "canonicalization";
```

- [ ] **Step 9.5: Modify routeMap**

In `app/admin/layout.tsx`, find the `routeMap` object. Insert ABOVE the existing line containing `"market-normalization": "/admin/market-normalization"`:

```typescript
      canonicalization: "/admin/canonicalization",
```

> Use grep / file-scoped search for the anchor strings rather than line numbers — the file may have shifted between plan-write and execution.

- [ ] **Step 9.6: Commit**

```bash
git add app/admin/canonicalization/page.tsx app/admin/layout.tsx
git commit -m "feat: /admin/canonicalization page + sidebar nav

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Manual smoke test on dev server

- [ ] **Step 10.1: Start dev server**

```bash
npm run dev
```

Expected: `Ready - started server on 0.0.0.0:3000` (or similar).

- [ ] **Step 10.2: Open page in browser**

Navigate to `http://localhost:3000/admin/canonicalization`

Verify visually:
- Header "🔭 Canonicalizzazione" renders
- Two tabs visible: "🔍 Inspector evento" (active by default) + "📊 Gerarchia & KPI"
- Search box in Inspector renders, autofocused

- [ ] **Step 10.3: Test Inspector**

Type "Roma" (or another known team name like "Inter", "Milan"):
- After ~400ms debounce, results appear
- 1+ event group renders with 1-3 SourceCards side-by-side
- Each card shows external_id, home_team, away_team, league, country, flashscore_id, etc.
- Status icons render next to relevant fields (✅/⚠️/❌/✓/🚧)
- Cross-source footer shows "✅ 3/3 source canonical" or partial msg

- [ ] **Step 10.4: Test Overview**

Click "📊 Gerarchia & KPI" tab:
- 5 KPI strips render
- LEVEL 1 SPORTS: 🟢 100.0%
- LEVEL 2 LEAGUES: percentage with color coding
- LEVEL 3 EVENTS: percentage + per-source breakdown + per-stage detail
- LEVEL 4 MARKETS: percentage
- LEVEL 5 OUTCOMES: percentage
- "Generato:" timestamp + ↻ button refreshes data

- [ ] **Step 10.5: Test sidebar nav**

- "🔭 Canonicalizzazione" appears in SISTEMA group above "Normalizzazione Mercati"
- Clicking it navigates to `/admin/canonicalization?tab=canonicalization` (URL has trailing `?tab=...` from layout routeMap pattern — this is fine)
- Active state highlights correctly

- [ ] **Step 10.6: Test URL persistence**

Change tab to overview → URL shows `?tab=overview`. Reload page → tab is still overview ✓.

- [ ] **Step 10.7: If all OK, push to staging**

```bash
git push origin master  # auto-deploys staging via GH Actions per memory
```

Wait for staging admin run green. Then visit staging URL: `https://admin-staging.betssolution.com/admin/canonicalization`. Repeat smoke tests.

---

## Task 11: Apply migration to prod + final commit

- [ ] **Step 11.1: Apply mig 122 to prod**

```bash
node scripts/db/apply-mig.mjs --target prod --file supabase/migrations/122_canonicalization_observability_rpcs.sql
```

Expected: success line. If fail, do NOT proceed — debug first.

- [ ] **Step 11.2: Trigger prod deploy**

First confirm the actual workflow filename:
```bash
ls .github/workflows/ | grep -iE 'deploy|prod'
```

Then trigger via `gh workflow run <filename> -f confirm_branch=master` (or whichever inputs the workflow expects — `gh workflow view <filename>` shows the spec).

Wait for run green via `gh run watch` or `gh run list --limit 5`.

- [ ] **Step 11.3: Manual smoke prod**

Visit `https://admin.betssolution.com/admin/canonicalization` (or whatever prod URL is). Run same smoke tests as Step 10. Verify:
- Overview LEVEL 3 events `flashscore_pct` matches the expected baseline (~54% per memory snapshot 2026-04-25)
- Per-source `betfair.pct` matches (~76-88% post locale fix 2026-04-26)

- [ ] **Step 11.4: Update memory**

Add a session memory file documenting deploy + observed baseline values (commit hashes, prod URL, baseline KPI snapshots). Use the standard memory pattern.

---

## Acceptance criteria

- ✅ Migration 122 applied staging+prod, both RPCs callable.
- ✅ `/admin/canonicalization` accessible via sidebar.
- ✅ Inspector tab: search "Roma" returns ≥1 group with side-by-side source cards.
- ✅ Overview tab: 5 KPI strips render with non-zero data.
- ✅ Status icons render with tooltips on hover.
- ✅ URL persistence on tab change (?tab=inspector / ?tab=overview).
- ✅ Drill-down links from KPI strips navigate to existing pages.
- ✅ All vitest tests pass: `npx vitest run` shows green.
- ✅ No build errors: `npm run build` completes successfully.

## Rollback plan

If something breaks after deploy:
1. Revert UI commits via `git revert <sha>` or remove sidebar nav entry to hide page.
2. Drop RPCs: `DROP FUNCTION canonicalization_overview(); DROP FUNCTION inspect_event(text, int);` (idempotent, safe).

The page is read-only and additive — no data corruption risk.

## Out of scope (explicitly deferred)

- **Task #2** — cross-source synthetic canonical_id + is_source_only flag. Page already has 🚧 placeholders that will activate when Task #2 deploys.
- **Task #3** — Betfair league static map. Page will reflect `Unknown` count drop automatically once #3 deploys.
- E2E tests (Playwright). Manual smoke is the gate for this iteration.
- Admin write actions (verify, edit, propose). All pages remain in deep-dive locations.
