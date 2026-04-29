#!/usr/bin/env node
import pg from "pg";

const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};

const target = process.argv[2] ?? "prod";
const p = PROJECTS[target];
const hosts = ["aws-0-eu-west-1.pooler.supabase.com", "aws-1-eu-central-1.pooler.supabase.com", "aws-0-eu-central-1.pooler.supabase.com"];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({ host, port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await c.connect(); client = c; console.log("connected via", host, "→", target); break; } catch { await c.end().catch(()=>{}); }
}
if (!client) process.exit(1);

console.log("\n=== llm_verify column exists ===");
const col = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='event_normalization' AND column_name IN ('llm_verify','verified','verified_by') ORDER BY column_name`);
col.rows.forEach(r => console.log(`  ${r.column_name.padEnd(15)} ${r.data_type}`));

console.log("\n=== retroactive_auto_verify_event_norm DRY RUN at 0.97 ===");
const dry = await client.query(`SELECT * FROM retroactive_auto_verify_event_norm(0.97, true)`);
console.log("  total_affected:", dry.rows[0]?.total_affected);
console.log("  by_stage:", dry.rows[0]?.by_stage);

console.log("\n=== event_norm_verified_breakdown ===");
const bd = await client.query(`SELECT * FROM event_norm_verified_breakdown()`);
bd.rows.forEach(r => console.log(`  ${r.match_stage.padEnd(20)} mapped=${String(r.total_mapped).padStart(6)} auto=${String(r.auto_verified).padStart(5)} human=${String(r.human_verified).padStart(4)} unverified=${String(r.unverified).padStart(6)} avg_conf=${r.avg_confidence}`));

await client.end();
