#!/usr/bin/env node
// Batched orphan-outcome deactivation. Avoids the whole-table JOIN timeout
// by using EXISTS + LIMIT 1000 per statement, committing each batch, then
// sleeping 500ms so autovacuum + MV refresh + scraper writes can proceed.
//
// Usage:
//   node scripts/db/cleanup-orphan-outcomes.mjs --target prod [--batches 600]
//
// Each batch sets statement_timeout=30000 so a lock contention never hangs
// the whole run; instead the batch retries on the next iteration.
//
// Stops when a batch touches 0 rows (backlog empty) OR max batches reached.

import pg from "pg";

const args = process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a[x.replace(/^--/, "")] = arr[i + 1];
  return a;
}, {});
const target = args.target ?? "prod";
const maxBatches = Number(args.batches ?? 600);
const batchSize = Number(args.batch ?? 1000);
const sleepMs = Number(args.sleep ?? 500);

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
    host,
    port: 5432,
    user: `postgres.${p.projectRef}`,
    password: p.password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try { await c.connect(); client = c; console.error(`connected via ${host} (${target})`); break; }
  catch { /* try next */ }
}
if (!client) { console.error("no pooler host worked"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let totalDeactivated = 0;
let batchesRun = 0;
let emptyBatches = 0;

for (let i = 0; i < maxBatches; i++) {
  batchesRun++;
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const res = await client.query(
      `UPDATE outcomes
          SET is_active = false
        WHERE id IN (
          SELECT o.id FROM outcomes o
           WHERE o.is_active = true
             AND EXISTS (
               SELECT 1
                 FROM markets m
                 JOIN events e ON e.id = m.event_id
                WHERE m.id = o.market_id
                  AND e.status = 'ended'
             )
           LIMIT $1
        )`,
      [batchSize]
    );
    const n = res.rowCount ?? 0;
    totalDeactivated += n;

    if (batchesRun % 10 === 0 || n === 0) {
      console.log(
        `batch=${batchesRun} rows=${n} cumulative=${totalDeactivated} empty_streak=${emptyBatches}`
      );
    }

    if (n === 0) {
      emptyBatches++;
      // Two consecutive empty batches → done.
      if (emptyBatches >= 2) {
        console.log(`No more orphans found after 2 empty batches. Stopping.`);
        break;
      }
      // Otherwise wait a bit in case the first empty was a transient lock.
      await sleep(2000);
      continue;
    } else {
      emptyBatches = 0;
    }

    await sleep(sleepMs);
  } catch (e) {
    console.error(`batch=${batchesRun} ERROR: ${e.message}`);
    await sleep(5000); // back off on error
  }
}

console.log(`\n=== DONE ===`);
console.log(`batches_run=${batchesRun} total_deactivated=${totalDeactivated}`);
await client.end();
