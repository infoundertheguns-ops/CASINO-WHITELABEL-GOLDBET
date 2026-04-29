#!/usr/bin/env node
// HARD DELETE 95k stale ended sentinels and all dependents.
// Sentinel = events with status='ended' AND flashscore_id IS NULL
//          AND canonical_id IS NULL AND is_source_only = false.
//
// Q4 already proved 0 bet references on this set.
// FK NO ACTION on markets / settlement_log / odds_adjustments / bet_selections,
// so we explicitly delete dependents in correct order, then events (CASCADE
// handles event_normalization + consensus_snapshots).
//
// Usage:  node scripts/db/cleanup-stale-sentinels.mjs --batches N
//   N defaults to 30 (= up to 300k events at batch=10000, more than enough).
//   Stops early when 0 sentinels remain.
import pg from "pg";
const args = process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a[x.replace(/^--/, "")] = arr[i + 1];
  return a;
}, {});
const MAX_BATCHES = Number(args.batches ?? 30);
const BATCH_SIZE  = Number(args["batch-size"] ?? 10000);

const p = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com",
  port: 5432,
  user: `postgres.${p.projectRef}`,
  password: p.password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,    // disable per-statement timeout
  query_timeout: 0,
});
await c.connect();
console.log(`▶ HARD DELETE up to ${MAX_BATCHES} batches of ${BATCH_SIZE} sentinel events on PROD`);
console.log(`  start: ${new Date().toISOString()}`);
console.log("");

await c.query(`SET statement_timeout = '15min'`);

// Initial count
const cBefore = await c.query(`
  SELECT count(*) AS n FROM events
  WHERE status = 'ended' AND flashscore_id IS NULL
    AND canonical_id IS NULL AND is_source_only = false
`);
const total0 = Number(cBefore.rows[0].n);
console.log(`  baseline sentinels: ${total0.toLocaleString()}`);
console.log("");

let totalDeleted = 0;
const t0 = Date.now();
for (let i = 1; i <= MAX_BATCHES; i++) {
  const tBatch = Date.now();
  // Pick a batch
  const sel = await c.query(`
    SELECT id FROM events
    WHERE status = 'ended' AND flashscore_id IS NULL
      AND canonical_id IS NULL AND is_source_only = false
    ORDER BY id
    LIMIT $1
  `, [BATCH_SIZE]);
  const ids = sel.rows.map(r => r.id);
  if (ids.length === 0) {
    console.log(`✓ batch ${i}: 0 candidates left, stopping.`);
    break;
  }

  // Children in FK-safe order
  await c.query("BEGIN");
  try {
    const dOut = await c.query(`
      DELETE FROM outcomes WHERE market_id IN (SELECT id FROM markets WHERE event_id = ANY($1::uuid[]))
    `, [ids]);
    const dMkt = await c.query(`DELETE FROM markets WHERE event_id = ANY($1::uuid[])`, [ids]);
    const dOdd = await c.query(`DELETE FROM odds_adjustments WHERE event_id = ANY($1::uuid[])`, [ids]);
    const dSet = await c.query(`DELETE FROM settlement_log WHERE event_id = ANY($1::uuid[])`, [ids]);
    const dEvt = await c.query(`DELETE FROM events WHERE id = ANY($1::uuid[])`, [ids]);
    await c.query("COMMIT");
    totalDeleted += dEvt.rowCount;
    const ms = Date.now() - tBatch;
    console.log(
      `  batch ${String(i).padStart(2,"0")}: events=${dEvt.rowCount.toLocaleString().padStart(6)} ` +
      `markets=${dMkt.rowCount.toLocaleString().padStart(7)} ` +
      `outcomes=${dOut.rowCount.toLocaleString().padStart(8)} ` +
      `t=${(ms/1000).toFixed(1)}s ` +
      `running_total=${totalDeleted.toLocaleString()}/${total0.toLocaleString()}`
    );
  } catch (err) {
    await c.query("ROLLBACK");
    console.error(`✗ batch ${i} failed:`, err.message);
    break;
  }
}

const cAfter = await c.query(`
  SELECT count(*) AS n FROM events
  WHERE status = 'ended' AND flashscore_id IS NULL
    AND canonical_id IS NULL AND is_source_only = false
`);
console.log("");
console.log(`✓ DONE in ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log(`  events deleted: ${totalDeleted.toLocaleString()}`);
console.log(`  sentinels remaining: ${Number(cAfter.rows[0].n).toLocaleString()}`);
await c.end();
