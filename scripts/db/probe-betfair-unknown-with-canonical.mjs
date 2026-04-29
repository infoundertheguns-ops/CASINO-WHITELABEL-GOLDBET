#!/usr/bin/env node
import pg from "pg";
const p = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("=== Q: betfair Unknown breakdown by canonical_id presence (active 7d) ===");
const r = await c.query(`
  SELECT
    CASE WHEN e.canonical_id IS NOT NULL THEN 'HAS canonical_id (recoverable)'
         ELSE 'no canonical_id (single-source)' END AS bucket,
    count(*) AS event_count,
    count(DISTINCT e.canonical_id) AS distinct_clusters
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE e.external_id LIKE 'betfair:%'
    AND e.status IN ('prematch','live')
    AND e.starts_at > now() - interval '7 days'
    AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  GROUP BY bucket
  ORDER BY event_count DESC
`);
console.table(r.rows);

console.log("\n=== Q2: of the recoverable ones, do other cluster members have a non-Unknown league? ===");
const r2 = await c.query(`
  WITH bf_unknown AS (
    SELECT e.id, e.canonical_id, e.home_team, e.away_team
    FROM events e
    JOIN leagues l ON l.id = e.league_id
    WHERE e.external_id LIKE 'betfair:%'
      AND e.status IN ('prematch','live')
      AND e.starts_at > now() - interval '7 days'
      AND e.canonical_id IS NOT NULL
      AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  ),
  cluster_other AS (
    SELECT bu.id AS bf_id,
           bu.home_team || ' vs ' || bu.away_team AS sample_match,
           e2.external_id AS sibling_external_id,
           l2.name AS sibling_league
    FROM bf_unknown bu
    JOIN events e2 ON e2.canonical_id = bu.canonical_id AND e2.id <> bu.id
    JOIN leagues l2 ON l2.id = e2.league_id
    WHERE l2.name <> 'Unknown' AND l2.name NOT LIKE 'Unknown (%)'
  )
  SELECT
    'with sibling-league recovery' AS bucket,
    count(DISTINCT bf_id) AS recoverable_bf_events,
    count(DISTINCT sibling_league) AS distinct_target_leagues
  FROM cluster_other
`);
console.table(r2.rows);

console.log("\n=== Q3: sample of recoveries (top 8 mappings) ===");
const r3 = await c.query(`
  WITH bf_unknown AS (
    SELECT e.id, e.canonical_id, e.home_team, e.away_team, e.external_id
    FROM events e
    JOIN leagues l ON l.id = e.league_id
    WHERE e.external_id LIKE 'betfair:%'
      AND e.status IN ('prematch','live')
      AND e.starts_at > now() - interval '7 days'
      AND e.canonical_id IS NOT NULL
      AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  )
  SELECT bu.home_team || ' vs ' || bu.away_team AS match_label,
         bu.external_id AS bf_event,
         l2.name AS target_league,
         l2.country_code AS target_country
  FROM bf_unknown bu
  JOIN events e2 ON e2.canonical_id = bu.canonical_id AND e2.id <> bu.id
  JOIN leagues l2 ON l2.id = e2.league_id
  WHERE l2.name <> 'Unknown' AND l2.name NOT LIKE 'Unknown (%)'
  ORDER BY bu.id
  LIMIT 8
`);
console.table(r3.rows);

await c.end();
