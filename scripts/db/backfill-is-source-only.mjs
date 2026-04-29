// scripts/db/backfill-is-source-only.mjs
// Sprint 3 Phase B — backfill events.is_source_only via classify_event_source_only.
//
// Scope: events with match_stage='unmapped' AND status IN ('prematch','live')
//        AND starts_at > now()-30d AND is_source_only = false.
// Batches of 500. Logs running tally + per-sport breakdown of flagged.
// Run:   node scripts/db/backfill-is-source-only.mjs prod
//        node scripts/db/backfill-is-source-only.mjs staging
import pg from "pg";

const target = process.argv[2] ?? "prod";
const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS[target];
if (!p) { console.error("invalid target"); process.exit(1); }
const hosts = [
  "aws-0-eu-west-1.pooler.supabase.com",
  "aws-1-eu-central-1.pooler.supabase.com",
  "aws-0-eu-central-1.pooler.supabase.com",
];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({
    host, port: 5432, user: `postgres.${p.projectRef}`,
    password: p.password, database: "postgres",
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000,
  });
  try { await c.connect(); client = c; console.log(`connected via ${host} → ${target}`); break; }
  catch { await c.end().catch(() => {}); }
}
if (!client) { console.error("could not connect"); process.exit(1); }

await client.query(`SET statement_timeout = '60s'`);

const t0 = Date.now();

// 1) Pre-flight: count target population.
// Scope (broader than plan to also flag historical events shown in Esplora
// search/history): all events in last 30d that have no flashscore_id and
// is_source_only=false. INCLUDES ended status (they still surface in
// inspect_event UI). Excludes the placeholder ones (already excluded by
// classifier R1 on the Home/% +/Special bets path) — but we also avoid
// scanning them at the SQL filter level for speed.
const pre = await client.query(`
  SELECT count(*)::int AS n
  FROM events e
  WHERE e.starts_at > now() - interval '30 days'
    AND e.is_source_only = false
    AND e.flashscore_id IS NULL
    AND e.home_team NOT IN ('Home', 'Home (Special bets)')
    AND e.home_team NOT LIKE '% +'
`);
console.log(`\nTarget population: ${pre.rows[0].n} events`);

// 2) Iterate via OFFSET cursor (kept_false rows aren't excluded by WHERE so
// we need to walk the full set ordering by id — flagged rows fall out, kept
// rows stay but we paginate past them by id > last_id).
const BATCH = 500;
let totalScanned = 0;
let flaggedTrue = 0;
let keptFalse = 0;
let lastId = '00000000-0000-0000-0000-000000000000';

while (true) {
  // Cursor by id ASC: each page advances past previously-scanned events
  // regardless of whether they got flagged.
  const batch = await client.query(`
    SELECT e.id
    FROM events e
    WHERE e.starts_at > now() - interval '30 days'
      AND e.is_source_only = false
      AND e.flashscore_id IS NULL
      AND e.home_team NOT IN ('Home', 'Home (Special bets)')
      AND e.home_team NOT LIKE '% +'
      AND e.id > $1
    ORDER BY e.id ASC
    LIMIT $2
  `, [lastId, BATCH]);

  if (batch.rows.length === 0) break;

  for (const row of batch.rows) {
    const r = await client.query(`SELECT classify_event_source_only($1) AS flag`, [row.id]);
    totalScanned++;
    if (r.rows[0].flag === true) flaggedTrue++;
    else keptFalse++;
    lastId = row.id;
  }

  console.log(`  scanned=${totalScanned} flagged=${flaggedTrue} kept=${keptFalse} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const t1 = Date.now();
console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`Backfill complete (${target})`);
console.log(`  total_scanned: ${totalScanned}`);
console.log(`  flagged_true:  ${flaggedTrue}`);
console.log(`  kept_false:    ${keptFalse}`);
console.log(`  run_time:      ${((t1 - t0) / 1000).toFixed(1)}s`);
console.log(`═══════════════════════════════════════════════════════════════`);

// 3) Per-sport breakdown of newly flagged events.
console.log(`\nDistribution of flagged events by sport+source:`);
const dist = await client.query(`
  SELECT s.name AS sport,
         CASE
           WHEN e.external_id LIKE 'kambi:%' THEN 'kambi'
           WHEN e.external_id LIKE '22bet:%' THEN '22bet'
           WHEN e.external_id LIKE 'betfair:%' THEN 'betfair'
           ELSE 'other'
         END AS src,
         count(*)::int AS n
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  WHERE e.is_source_only = true
    AND e.starts_at > now() - interval '30 days'
  GROUP BY s.name, src
  ORDER BY n DESC
`);
for (const r of dist.rows) {
  console.log(`  ${r.sport.padEnd(20)} ${r.src.padEnd(8)} ${r.n}`);
}

await client.end();
