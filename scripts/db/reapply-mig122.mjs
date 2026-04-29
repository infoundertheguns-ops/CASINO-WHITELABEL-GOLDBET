#!/usr/bin/env node
// Re-applies mig 122 (CREATE OR REPLACE FUNCTION bodies are idempotent).
// Splits the file into 3 sections so the heavy MV creation doesn't time out
// the function CREATEs. Updates the _migrations row sha after success.
import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const target = process.argv[2] ?? "staging";
const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS[target];
if (!p) { console.error("invalid target"); process.exit(1); }

const file = path.resolve("supabase/migrations/122_canonicalization_observability_rpcs.sql");
const sql = fs.readFileSync(file, "utf-8");
const name = path.basename(file);
const sha = crypto.createHash("sha256").update(sql).digest("hex");

const hosts = [
  "aws-0-eu-west-1.pooler.supabase.com",
  "aws-1-eu-central-1.pooler.supabase.com",
  "aws-0-eu-central-1.pooler.supabase.com",
];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({
    host, port: 5432,
    user: `postgres.${p.projectRef}`,
    password: p.password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  try { await c.connect(); client = c; console.log("connected via", host, "→", target); break; }
  catch { await c.end().catch(() => {}); }
}
if (!client) { console.error("could not connect"); process.exit(1); }

console.log(`▶  re-applying ${name} (new sha=${sha.slice(0, 8)}) — split mode`);

// Bump session statement_timeout for the heavy MV create.
await client.query(`SET statement_timeout = '600s'`);

// Section 1: MV + refresh function. The MV creation does the heavy join, so
// we run it on its own to avoid blocking the function rebuilds.
const section1 = `
DROP MATERIALIZED VIEW IF EXISTS mv_outcomes_canon_coverage;

CREATE MATERIALIZED VIEW mv_outcomes_canon_coverage AS
SELECT
  count(*)                                                          AS total_outcomes,
  count(*) FILTER (WHERE onz.canonical_outcome_key IS NOT NULL)     AS canonical_outcomes,
  now()                                                             AS computed_at
FROM (
  SELECT id, source FROM events
  WHERE source IN ('kambi', '22bet', 'betfair')
    AND status IN ('prematch', 'live')
    AND starts_at BETWEEN now() - interval '2 hours' AND now() + interval '12 hours'
) ev
JOIN markets m ON m.event_id = ev.id AND m.is_active = true
JOIN outcomes o ON o.market_id = m.id AND o.is_active = true
LEFT JOIN outcome_normalization onz
  ON onz.source = ev.source
 AND onz.source_market_type = m.market_type
 AND onz.source_outcome_name = o.name;

CREATE UNIQUE INDEX idx_mv_oc_coverage_pk ON mv_outcomes_canon_coverage ((1));

GRANT SELECT ON mv_outcomes_canon_coverage TO authenticated, service_role;

CREATE OR REPLACE FUNCTION refresh_mv_outcomes_canon_coverage()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '300s'
AS $fn$
DECLARE
  v_total bigint;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_outcomes_canon_coverage;
  SELECT total_outcomes INTO v_total FROM mv_outcomes_canon_coverage LIMIT 1;
  RETURN v_total;
END;
$fn$;

GRANT EXECUTE ON FUNCTION refresh_mv_outcomes_canon_coverage() TO authenticated, service_role;
`;

// Section 2 + 3: parse the file and pull out the two CREATE OR REPLACE FUNCTION
// statements + their ALTER FUNCTION + GRANT lines. We do this by simply running
// the original file *without* the MV section (it's already done).
//
// Strategy: split by "-- RPC" markers and run RPC1 + RPC2 + ALTER block separately.
const idxRpc1 = sql.indexOf("-- RPC 1:");
const idxRpc2 = sql.indexOf("-- RPC 2:");
const tail    = sql.indexOf("ALTER FUNCTION canonicalization_overview");

if (idxRpc1 < 0 || idxRpc2 < 0 || tail < 0) {
  console.error("could not parse mig 122 sections");
  process.exit(1);
}

const rpc1Sql = sql.substring(idxRpc1, idxRpc2);
const rpc2Sql = sql.substring(idxRpc2, tail);
const tailSql = sql.substring(tail);

try {
  console.log("  [1/4] MV + refresh fn …");
  await client.query(section1);
  console.log("  [1/4] ok");

  console.log("  [2/4] canonicalization_overview() …");
  await client.query(rpc1Sql);
  console.log("  [2/4] ok");

  console.log("  [3/4] inspect_event() …");
  await client.query(rpc2Sql);
  console.log("  [3/4] ok");

  console.log("  [4/4] ALTER FUNCTION timeouts …");
  await client.query(tailSql);
  console.log("  [4/4] ok");

  await client.query(
    `INSERT INTO public._migrations(name, sha256) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = NOW()`,
    [name, sha]
  );
  console.log(`✓  ${name} re-applied (sha updated to ${sha.slice(0, 8)})`);
} catch (err) {
  console.error(`✗  failed:`, err.message);
  await client.end();
  process.exit(1);
}

// Smoke test
console.log("\n=== Smoke: canonicalization_overview() ===");
const r = await client.query(`SELECT canonicalization_overview() AS payload`);
const payload = r.rows[0].payload;
console.log("level_2_leagues.per_source:", JSON.stringify(payload.level_2_leagues.per_source));
console.log("level_4_markets:", JSON.stringify(payload.level_4_markets));
console.log("level_5_outcomes:", JSON.stringify(payload.level_5_outcomes));

await client.end();
