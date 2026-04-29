#!/usr/bin/env node
// Strategia A: force retroactive cross-source classification on every active 7d
// Betfair event with league=Unknown and canonical_id NULL. Then re-apply mig 134
// propagation to copy league_id from any newly-formed clusters.
//
// RPC threshold is stricter than the probe (similarity 0.85 + 30min window vs
// probe's 0.7 + 12h), so expect <231 actual recoveries. Still cheap to try.
import pg from "pg";
const p = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com",
  port: 5432,
  user: `postgres.${p.projectRef}`,
  password: p.password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();
await c.query(`SET statement_timeout = '60s'`);

console.log("▶ Strategia A: classifier retroactive on Betfair Unknown active 7d");

const targets = await c.query(`
  SELECT e.id, e.home_team, e.away_team
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE e.external_id LIKE 'betfair:%'
    AND e.status IN ('prematch','live')
    AND e.starts_at > now() - interval '7 days'
    AND e.canonical_id IS NULL
    AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
  ORDER BY e.id
`);
console.log(`  candidates: ${targets.rowCount}`);
console.log("");

const stats = { reused: 0, new: 0, isolated: 0, skipped: 0, error: 0 };
const t0 = Date.now();
for (let i = 0; i < targets.rowCount; i++) {
  const t = targets.rows[i];
  try {
    const r = await c.query(`SELECT assign_event_cross_source_canonical_id($1::uuid) AS res`, [t.id]);
    const action = r.rows[0].res?.action ?? "unknown";
    if (action === "reused") stats.reused++;
    else if (action === "new") stats.new++;
    else if (action === "isolated") stats.isolated++;
    else stats.skipped++;
  } catch (err) {
    stats.error++;
  }
  if ((i + 1) % 200 === 0) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${i + 1}/${targets.rowCount} processed (${dt}s) — reused=${stats.reused} new=${stats.new} isolated=${stats.isolated} skipped=${stats.skipped} error=${stats.error}`);
  }
}
console.log("");
console.log(`✓ classifier loop done: reused=${stats.reused} new=${stats.new} isolated=${stats.isolated} skipped=${stats.skipped} error=${stats.error}`);

// Re-apply mig 134 propagation for any newly-clustered events
console.log("");
console.log("▶ propagating league_id to newly-clustered Betfair Unknown rows…");
const upd = await c.query(`
  WITH unknown_league_ids AS (
    SELECT id FROM leagues WHERE name = 'Unknown' OR name LIKE 'Unknown (%)'
  ),
  candidates AS (
    SELECT bf.id AS bf_event_id,
           (SELECT e2.league_id FROM events e2
              WHERE e2.canonical_id = bf.canonical_id
                AND e2.id <> bf.id
                AND e2.league_id NOT IN (SELECT id FROM unknown_league_ids)
              ORDER BY e2.id DESC LIMIT 1) AS sibling_league_id
    FROM events bf
    WHERE bf.external_id LIKE 'betfair:%'
      AND bf.status IN ('prematch','live')
      AND bf.starts_at > now() - interval '7 days'
      AND bf.canonical_id IS NOT NULL
      AND bf.league_id IN (SELECT id FROM unknown_league_ids)
  )
  UPDATE events e
  SET league_id = c.sibling_league_id
  FROM candidates c
  WHERE e.id = c.bf_event_id AND c.sibling_league_id IS NOT NULL
  RETURNING e.id
`);
console.log(`✓ league_id propagated to ${upd.rowCount} events`);

// Final count
const after = await c.query(`
  SELECT count(*) AS still_unknown
  FROM events e JOIN leagues l ON l.id = e.league_id
  WHERE e.external_id LIKE 'betfair:%'
    AND e.status IN ('prematch','live')
    AND e.starts_at > now() - interval '7 days'
    AND (l.name = 'Unknown' OR l.name LIKE 'Unknown (%)')
`);
console.log(`  final betfair Unknown active 7d: ${after.rows[0].still_unknown}`);

await c.end();
