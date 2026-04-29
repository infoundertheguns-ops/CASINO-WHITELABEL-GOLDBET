#!/usr/bin/env node
import pg from "pg";
const p = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false } });
await c.connect();

console.log("=== FK constraints referencing events ===");
const r1 = await c.query(`
  SELECT
    tc.table_name AS referencing_table,
    kcu.column_name AS referencing_column,
    rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu USING (constraint_name, constraint_schema)
  JOIN information_schema.referential_constraints rc USING (constraint_name, constraint_schema)
  JOIN information_schema.constraint_column_usage ccu USING (constraint_name, constraint_schema)
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'events'
  ORDER BY tc.table_name
`);
console.table(r1.rows);

console.log("\n=== current size of events + child tables ===");
const r2 = await c.query(`
  SELECT
    c.relname AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
    s.n_live_tup AS live_rows
  FROM pg_class c
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE c.relname IN ('events','markets','outcomes','event_normalization','bet_selections','settlement_log','odds_adjustments','consensus_snapshots')
    AND c.relkind = 'r'
  ORDER BY pg_total_relation_size(c.oid) DESC
`);
console.table(r2.rows);

await c.end();
