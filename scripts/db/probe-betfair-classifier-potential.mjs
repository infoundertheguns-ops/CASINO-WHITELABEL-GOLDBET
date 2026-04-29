#!/usr/bin/env node
import pg from "pg";
const p = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();

await c.query(`SET statement_timeout = '5min'`);

console.log("=== Q: dei 2807 Betfair single-source Unknown, quanti hanno team-similar sibling NOT yet clustered? ===");
const r = await c.query(`
  WITH bf_unknown_solo AS (
    SELECT e.id, e.sport_id, e.home_team, e.away_team, e.starts_at
    FROM events e
    JOIN leagues l ON l.id = e.league_id
    WHERE e.external_id LIKE 'betfair:%'
      AND e.status IN ('prematch','live')
      AND e.starts_at > now() - interval '7 days'
      AND e.canonical_id IS NULL
      AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  )
  SELECT
    'bf_unknown_solo (population)' AS bucket, count(*) AS n FROM bf_unknown_solo
  UNION ALL
  SELECT
    'with team-similar non-betfair sibling (Strategia A target)' AS bucket,
    count(*)
  FROM bf_unknown_solo bf
  WHERE EXISTS (
    SELECT 1 FROM events e2
    WHERE e2.sport_id = bf.sport_id
      AND e2.external_id NOT LIKE 'betfair:%'
      AND e2.status IN ('prematch','live')
      AND abs(extract(epoch FROM (e2.starts_at - bf.starts_at))) < 43200
      AND similarity(normalize_team_name(e2.home_team), normalize_team_name(bf.home_team)) > 0.7
      AND similarity(normalize_team_name(e2.away_team), normalize_team_name(bf.away_team)) > 0.7
  )
`);
console.table(r.rows);

await c.end();
