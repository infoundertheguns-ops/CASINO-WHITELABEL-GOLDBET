#!/usr/bin/env node
import pg from "pg";

const PROJECTS = {
  prod: { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS.prod;

const hosts = [
  "aws-1-eu-central-1.pooler.supabase.com",
];

async function connect() {
  for (const host of hosts) {
    const c = new pg.Client({
      host, port: 5432, user: `postgres.${p.projectRef}`,
      password: p.password, database: "postgres", ssl: { rejectUnauthorized: false },
    });
    try { await c.connect(); return c; } catch { try { await c.end(); } catch {} }
  }
  throw new Error("no host");
}

const c = await connect();

console.log("=== ACTIVE ONLY (default) ===");
const r1 = await c.query("SELECT * FROM event_normalization_coverage_pct(7, false)");
for (const row of r1.rows) {
  const lbl = row.source ?? "OVERALL";
  console.log(`  ${lbl.padEnd(10)} ${row.coverage_pct}% (${row.mapped_events}/${row.total_events})`);
}

console.log("\n=== INCLUDE ENDED ===");
const r2 = await c.query("SELECT * FROM event_normalization_coverage_pct(7, true)");
for (const row of r2.rows) {
  const lbl = row.source ?? "OVERALL";
  console.log(`  ${lbl.padEnd(10)} ${row.coverage_pct}% (${row.mapped_events}/${row.total_events})`);
}

await c.end();
