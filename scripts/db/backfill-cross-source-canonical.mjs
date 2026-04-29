#!/usr/bin/env node
// scripts/db/backfill-cross-source-canonical.mjs
//
// Sprint 3 Phase A — one-shot backfill: walks every match_stage='unmapped'
// active event in the last 30 days, calls assign_event_cross_source_canonical_id()
// per row, aggregates {kept, reused, created, no_match, skipped_placeholder, errors}.
//
// Usage:
//   node scripts/db/backfill-cross-source-canonical.mjs --target {staging|prod}
//   node scripts/db/backfill-cross-source-canonical.mjs --target prod --batch 100
//
// Idempotent: safe to re-run. Already-canonical events return 'kept'.
//
// Expected prod numbers (2026-04-27 diagnosis):
//   Scope: ~3873 active unmapped events
//   Pair candidates with similarity 1.0: ~264
//   Real-world matches expected: ~50-90 clusters, ~140-220 events assigned
//   Cluster size > 4 → STOP, false positive likely.

import pg from "pg";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, x, i, a) => {
    if (x.startsWith("--")) acc.push([x.replace(/^--/, ""), a[i + 1]]);
    return acc;
  }, []).map(([k, v]) => [k, v])
);
const target = args.target;
const batchSize = Math.max(1, Number(args.batch ?? 100));
if (!target || !["staging", "prod"].includes(target)) {
  console.error("Usage: --target staging|prod [--batch N]");
  process.exit(1);
}

const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS[target];
const hosts = [
  "aws-0-eu-west-1.pooler.supabase.com",
  "aws-1-eu-central-1.pooler.supabase.com",
  "aws-0-eu-central-1.pooler.supabase.com",
];
let c = null;
let usedHost = null;
for (const host of hosts) {
  const t = new pg.Client({
    host, port: 5432,
    user: `postgres.${p.projectRef}`, password: p.password, database: "postgres",
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000,
  });
  try { await t.connect(); c = t; usedHost = host; break; }
  catch { await t.end().catch(() => {}); }
}
if (!c) { console.error("could not connect to any pooler host"); process.exit(1); }
console.log(`▶ backfill cross-source canonical_id (${target} via ${usedHost})`);
if (target === "prod") console.log("⚠️  PROD");

// 1) Pull scope
const t0 = Date.now();
const { rows: scope } = await c.query(`
  SELECT e.id
  FROM events e
  JOIN event_normalization en ON en.event_id = e.id
  WHERE en.match_stage = 'unmapped'
    AND e.starts_at > NOW() - INTERVAL '30 days'
    AND e.status IN ('prematch', 'live')
    AND e.home_team NOT IN ('Home', 'Home (Special bets)')
    AND e.home_team NOT LIKE '% +'
    AND e.canonical_id IS NULL
  ORDER BY e.starts_at
`);
console.log(`scope: ${scope.length} candidate events (${Date.now() - t0}ms)`);

// 2) Per-id call (sequential — RPC self-joins, parallel would amplify lock contention)
const stats = {
  kept: 0, reused: 0, created: 0, no_match: 0,
  skipped_placeholder: 0, event_not_found: 0, errors: 0,
};
const newCanonicalIds = new Set();
const reusedCanonicalIds = new Set();

let n = 0;
for (const { id } of scope) {
  n++;
  try {
    const r = await c.query(
      `SELECT assign_event_cross_source_canonical_id($1::uuid) AS payload`,
      [id]
    );
    const payload = r.rows[0].payload ?? {};
    const action = payload.action ?? 'errors';
    stats[action] = (stats[action] ?? 0) + 1;
    if (action === 'created' && payload.canonical_id) {
      newCanonicalIds.add(payload.canonical_id);
    } else if (action === 'reused' && payload.canonical_id) {
      reusedCanonicalIds.add(payload.canonical_id);
    }
  } catch (err) {
    stats.errors++;
    console.error(`  err on ${id}:`, err.message);
  }
  if (n % batchSize === 0) {
    process.stdout.write(`  ${n}/${scope.length}\r`);
  }
}
console.log(`\nprocessed: ${n}`);

// 3) Cluster size distribution sanity check
const { rows: clusterSizes } = await c.query(`
  SELECT cluster_size, count(*) AS clusters
  FROM (
    SELECT canonical_id, count(*) AS cluster_size
    FROM events
    WHERE canonical_id IS NOT NULL
    GROUP BY canonical_id
  ) z
  GROUP BY cluster_size
  ORDER BY cluster_size
`);
console.log("\ncluster size distribution (after backfill):");
for (const r of clusterSizes) console.log(`  size ${r.cluster_size}: ${r.clusters} clusters`);

const { rows: maxRow } = await c.query(`
  SELECT max(z.cluster_size) AS max_size
  FROM (
    SELECT canonical_id, count(*) AS cluster_size
    FROM events
    WHERE canonical_id IS NOT NULL
    GROUP BY canonical_id
  ) z
`);
const maxSize = maxRow[0].max_size ?? 0;

const { rows: assigned } = await c.query(
  `SELECT count(*)::int AS n FROM events WHERE canonical_id IS NOT NULL`
);
const totalAssigned = assigned[0].n;

const { rows: clusters } = await c.query(
  `SELECT count(DISTINCT canonical_id)::int AS n FROM events WHERE canonical_id IS NOT NULL`
);
const totalClusters = clusters[0].n;

const avgSize = totalClusters > 0 ? (totalAssigned / totalClusters).toFixed(2) : 'n/a';

const took = ((Date.now() - t0) / 1000).toFixed(1);
console.log("\n========================================");
console.log(`SUMMARY (${target})`);
console.log("========================================");
console.log(`  scanned:                 ${scope.length}`);
console.log(`  kept (already assigned): ${stats.kept}`);
console.log(`  reused (existing canonical): ${stats.reused}`);
console.log(`  created (new canonical): ${stats.created}`);
console.log(`  no_match:                ${stats.no_match}`);
console.log(`  skipped_placeholder:     ${stats.skipped_placeholder}`);
console.log(`  errors:                  ${stats.errors}`);
console.log(`  ─────────────────────`);
console.log(`  total clusters in DB:    ${totalClusters}`);
console.log(`  total events assigned:   ${totalAssigned}`);
console.log(`  avg cluster size:        ${avgSize}`);
console.log(`  max cluster size:        ${maxSize}`);
console.log(`  run time:                ${took}s`);

if (maxSize > 4) {
  console.error("\n⚠️  WARNING: cluster size > 4 detected — possible false positive.");
  console.error("   Inspect with:");
  console.error("   SELECT canonical_id, count(*), array_agg(home_team || ' vs ' || away_team)");
  console.error("   FROM events WHERE canonical_id IS NOT NULL");
  console.error("   GROUP BY canonical_id HAVING count(*) > 4 ORDER BY count(*) DESC;");
}

await c.end();
