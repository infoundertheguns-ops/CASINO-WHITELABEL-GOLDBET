-- Migration 116: fixtures_overview() + fixtures_leagues() RPCs.
--
-- Pre-fix the /admin/fixtures route ran 3 separate full-scan loops on
-- be_fixtures (paginated 1000 at a time): one for stats, one for sports,
-- one for leagues. With ~10-15k rows that's 30-45 round-trips per pageload.
-- Each RPC below replaces a loop with a single GROUP BY query.

-- ═══ Overview: total + per-sport count + last_updated ═══
CREATE OR REPLACE FUNCTION fixtures_overview()
RETURNS TABLE(
  sport text,
  count bigint,
  last_updated timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    sport,
    COUNT(*)::bigint AS count,
    MAX(updated_at) AS last_updated
  FROM be_fixtures
  GROUP BY ROLLUP(sport)
  ORDER BY sport NULLS FIRST;
$$;

GRANT EXECUTE ON FUNCTION fixtures_overview() TO authenticated, service_role, anon;

COMMENT ON FUNCTION fixtures_overview IS
  'Single-shot stats for /admin/fixtures KPI bar. ROLLUP gives a NULL-sport row representing the overall total + max(updated_at). Replaces full-table scan loop in app/api/admin/fixtures/route.ts.';

-- ═══ Leagues for a given sport ═══
CREATE OR REPLACE FUNCTION fixtures_leagues(p_sport text)
RETURNS TABLE(
  league text,
  country text,
  count bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(league, 'Unknown') AS league,
    -- Country is a property of the league; pick the most common one to
    -- avoid duplicates when scrapers occasionally drift on country naming.
    (
      SELECT country
      FROM be_fixtures f2
      WHERE f2.sport = f.sport
        AND COALESCE(f2.league, 'Unknown') = COALESCE(f.league, 'Unknown')
      GROUP BY country
      ORDER BY COUNT(*) DESC NULLS LAST
      LIMIT 1
    ) AS country,
    COUNT(*)::bigint AS count
  FROM be_fixtures f
  WHERE f.sport = p_sport
  GROUP BY f.sport, f.league
  ORDER BY count DESC;
$$;

GRANT EXECUTE ON FUNCTION fixtures_leagues(text) TO authenticated, service_role, anon;

COMMENT ON FUNCTION fixtures_leagues IS
  'League breakdown for a given sport with the dominant country per league. Replaces full-scan loop in /admin/fixtures.';
