#!/usr/bin/env node
// Verification script for mig 107 (Causa 2: line-aware consensus JOIN).
// Compares recent consensus_snapshots counts by sport to detect the
// line-collapse reduction. Runs against prod by default.
//
// Usage: node scripts/db/verify-consensus-line-fix.mjs [--target prod|staging]

import pg from "pg";

const args = process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a[x.replace(/^--/, "")] = arr[i + 1];
  return a;
}, {});
const target = args.target ?? "prod";

const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS[target];
if (!p) { console.error("invalid target"); process.exit(1); }

const hosts = [
  "aws-0-eu-west-1.pooler.supabase.com",
  "aws-1-eu-central-1.pooler.supabase.com",
];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({
    host, port: 5432, user: `postgres.${p.projectRef}`, password: p.password,
    database: "postgres", ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try { await c.connect(); client = c; console.error(`connected via ${host} (${target})`); break; }
  catch { /* try next */ }
}
if (!client) { console.error("no pooler host worked"); process.exit(1); }

// Recent snapshots by hour (last 24h)
const recent = await client.query(`
  SELECT
    date_trunc('hour', snapshot_at) AS hour,
    count(*) AS outliers,
    count(DISTINCT kambi_event_id) AS events,
    round(avg(abs(delta_pct)), 2) AS avg_abs_delta
  FROM consensus_snapshots
  WHERE snapshot_at > now() - interval '24 hours'
  GROUP BY 1
  ORDER BY 1 DESC
  LIMIT 24
`);
console.log("\n=== Consensus snapshots per hour (last 24h) ===");
console.log("hour                        outliers  events  avg|delta|");
for (const r of recent.rows) {
  console.log(
    `${new Date(r.hour).toISOString().slice(0, 16)}  ${String(r.outliers).padStart(8)}  ${String(r.events).padStart(6)}  ${String(r.avg_abs_delta ?? "—").padStart(10)}`
  );
}

// Top market_types currently flagged as outliers (potential collapse victims)
const byMarket = await client.query(`
  SELECT market_type, count(*) AS n, round(avg(abs(delta_pct)), 1) AS avg_delta
  FROM consensus_snapshots
  WHERE snapshot_at > now() - interval '2 hours'
  GROUP BY 1
  ORDER BY n DESC
  LIMIT 20
`);
console.log("\n=== Top outlier market_types (last 2h) ===");
console.log("count   avg|delta|   market_type");
for (const r of byMarket.rows) {
  console.log(`${String(r.n).padStart(5)}   ${String(r.avg_delta).padStart(10)}   ${r.market_type}`);
}

await client.end();
