#!/usr/bin/env node
import pg from "pg";
const p = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("=== Q1: total events by status ===");
const r1 = await c.query(`SELECT status, count(*) FROM events GROUP BY status ORDER BY 2 DESC`);
console.table(r1.rows);

console.log("\n=== Q2: ended events breakdown by FS+canonical+source_only (the 'sentinel' candidates) ===");
const r2 = await c.query(`
  SELECT
    CASE
      WHEN flashscore_id IS NOT NULL THEN 'has_fs (mapped)'
      WHEN canonical_id  IS NOT NULL THEN 'has_canonical (clustered)'
      WHEN is_source_only = true THEN 'source_only_flagged'
      ELSE 'orphan (sentinel candidate)'
    END AS bucket,
    count(*) AS event_count,
    min(starts_at) AS oldest,
    max(starts_at) AS newest
  FROM events
  WHERE status = 'ended'
  GROUP BY bucket
  ORDER BY event_count DESC
`);
console.table(r2.rows);

console.log("\n=== Q3: orphan sentinels — by source ===");
const r3 = await c.query(`
  SELECT
    src AS source,
    count(*) AS sentinels
  FROM (
    SELECT CASE
      WHEN external_id LIKE 'kambi:%'   THEN 'kambi'
      WHEN external_id LIKE '22bet:%'   THEN '22bet'
      WHEN external_id LIKE 'betfair:%' THEN 'betfair'
      ELSE 'other'
    END AS src
    FROM events
    WHERE status = 'ended'
      AND flashscore_id IS NULL
      AND canonical_id IS NULL
      AND is_source_only = false
  ) t
  GROUP BY src
  ORDER BY sentinels DESC
`);
console.table(r3.rows);

console.log("\n=== Q4: are these sentinels referenced by bets? (safety check before delete) ===");
const r4 = await c.query(`
  WITH sentinels AS (
    SELECT id FROM events
    WHERE status = 'ended'
      AND flashscore_id IS NULL
      AND canonical_id IS NULL
      AND is_source_only = false
  )
  SELECT
    'bets referencing sentinels' AS metric,
    count(DISTINCT b.id) AS bet_count,
    count(DISTINCT bs.event_id) AS distinct_events_referenced
  FROM bet_selections bs
  JOIN bets b ON b.id = bs.bet_id
  WHERE bs.event_id IN (SELECT id FROM sentinels)
`);
console.table(r4.rows);

console.log("\n=== Q5: are these sentinels referenced by markets/outcomes? ===");
const r5 = await c.query(`
  WITH sentinels AS (
    SELECT id FROM events
    WHERE status = 'ended'
      AND flashscore_id IS NULL
      AND canonical_id IS NULL
      AND is_source_only = false
  )
  SELECT
    (SELECT count(*) FROM markets m  WHERE m.event_id IN (SELECT id FROM sentinels)) AS markets_count,
    (SELECT count(o.id) FROM outcomes o JOIN markets m ON m.id = o.market_id WHERE m.event_id IN (SELECT id FROM sentinels)) AS outcomes_count
`);
console.table(r5.rows);

console.log("\n=== Q6: age distribution ===");
const r6 = await c.query(`
  SELECT
    CASE
      WHEN starts_at > now() - interval '7 days'  THEN '0-7d'
      WHEN starts_at > now() - interval '30 days' THEN '7-30d'
      WHEN starts_at > now() - interval '90 days' THEN '30-90d'
      ELSE 'older than 90d'
    END AS age_bucket,
    count(*) AS sentinels
  FROM events
  WHERE status = 'ended'
    AND flashscore_id IS NULL
    AND canonical_id IS NULL
    AND is_source_only = false
  GROUP BY age_bucket
  ORDER BY age_bucket
`);
console.table(r6.rows);

await c.end();
