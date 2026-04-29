#!/usr/bin/env node
import pg from "pg";
const p = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();

console.log("=== Q1: how many DISTINCT league rows match 'Serie A' (Italia)? ===");
const r1 = await c.query(`
  SELECT l.id, l.name, l.country, l.country_code, l.tour_code,
         (SELECT count(*) FROM events e WHERE e.league_id = l.id AND e.status IN ('prematch','live')) AS active_events
  FROM leagues l
  WHERE l.name ILIKE '%Serie A%'
  ORDER BY active_events DESC
`);
console.table(r1.rows);

console.log("\n=== Q2: AC Milan vs Atalanta — all sources ===");
const r2 = await c.query(`
  SELECT e.external_id, e.home_team, e.away_team,
         e.starts_at, e.flashscore_id, e.canonical_id,
         l.name AS league_name, l.id AS league_id
  FROM events e
  LEFT JOIN leagues l ON l.id = e.league_id
  WHERE (e.home_team ILIKE '%Milan%' OR e.home_team ILIKE '%AC Milan%')
    AND (e.away_team ILIKE '%Atalanta%')
    AND e.starts_at > now() - interval '1 day'
    AND e.starts_at < now() + interval '14 days'
  ORDER BY e.starts_at, e.external_id
`);
console.table(r2.rows);

console.log("\n=== Q3: how many cs: clusters span MULTIPLE league_id rows? ===");
const r3 = await c.query(`
  WITH cs_clusters AS (
    SELECT canonical_id,
           count(DISTINCT league_id) AS distinct_leagues,
           count(*) AS sources
    FROM events
    WHERE canonical_id IS NOT NULL
      AND status IN ('prematch','live')
      AND starts_at > now() - interval '7 days'
    GROUP BY canonical_id
  )
  SELECT
    distinct_leagues,
    count(*) AS cluster_count,
    sum(sources) AS total_events
  FROM cs_clusters
  GROUP BY distinct_leagues
  ORDER BY distinct_leagues
`);
console.table(r3.rows);

await c.end();
