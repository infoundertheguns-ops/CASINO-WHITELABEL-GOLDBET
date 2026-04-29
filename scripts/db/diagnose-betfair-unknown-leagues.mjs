#!/usr/bin/env node
// Phase C diagnostic: extract top Betfair "Unknown" league competitionIds.
// Strategy: Betfair external_id format is "betfair:<eventId>". The scraper
// stores league_id pointing to "Unknown (...)" rows when competitionName was
// null in the source feed. We can't recover competitionId from prod (it's
// not stored anywhere on events table — only league row carries the
// flattened name). What we CAN see is: distinct league names that contain
// 'Unknown', their event counts on Betfair, and sport+country breakdown.
// That tells us "how many Unknown leagues per sport" — actionable input
// for the static map building.
import pg from "pg";
const PROJECTS = { prod: { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" } };
const p = PROJECTS.prod;
const hosts = ["aws-1-eu-central-1.pooler.supabase.com", "aws-0-eu-central-1.pooler.supabase.com"];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({ host, port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await c.connect(); client = c; break; } catch { await c.end().catch(()=>{}); }
}
if (!client) { console.error("connect fail"); process.exit(1); }

console.log("=== Q1: betfair Unknown leagues — count per sport (active 7d) ===");
const r1 = await client.query(`
  SELECT s.name AS sport, count(DISTINCT e.id) AS events, count(DISTINCT l.id) AS leagues
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  LEFT JOIN sports s ON s.id = e.sport_id
  WHERE e.external_id LIKE 'betfair:%'
    AND e.status IN ('prematch','live')
    AND e.starts_at > now() - interval '7 days'
    AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  GROUP BY s.name
  ORDER BY events DESC
`);
console.table(r1.rows);

console.log("\n=== Q2: distinct Unknown league rows that betfair touches (active 7d) ===");
const r2 = await client.query(`
  SELECT l.id, l.name, l.country, l.country_code, s.name AS sport, count(DISTINCT e.id) AS event_count
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  LEFT JOIN sports s ON s.id = e.sport_id
  WHERE e.external_id LIKE 'betfair:%'
    AND e.status IN ('prematch','live')
    AND e.starts_at > now() - interval '7 days'
    AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  GROUP BY l.id, l.name, l.country, l.country_code, s.name
  ORDER BY event_count DESC
  LIMIT 30
`);
console.table(r2.rows);

console.log("\n=== Q3: sample team names per Unknown league (top 5 leagues, 5 events each) ===");
const r3 = await client.query(`
  WITH top_unknown AS (
    SELECT l.id
    FROM events e
    JOIN leagues l ON l.id = e.league_id
    WHERE e.external_id LIKE 'betfair:%'
      AND e.status IN ('prematch','live')
      AND e.starts_at > now() - interval '7 days'
      AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
    GROUP BY l.id
    ORDER BY count(*) DESC
    LIMIT 5
  )
  SELECT l.name AS league, l.country, e.home_team, e.away_team, e.external_id, e.starts_at
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.id IN (SELECT id FROM top_unknown)
    AND e.external_id LIKE 'betfair:%'
    AND e.status IN ('prematch','live')
  ORDER BY l.name, e.starts_at DESC
  LIMIT 25
`);
console.table(r3.rows);

await client.end();
