#!/usr/bin/env node
import pg from "pg";

const PROJ = { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" };
const hosts = [
  "aws-1-eu-central-1.pooler.supabase.com",
  "aws-0-eu-central-1.pooler.supabase.com",
];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({ host, port: 5432, user: `postgres.${PROJ.projectRef}`, password: PROJ.password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await c.connect(); client = c; console.log(`connected via ${host}`); break; } catch { await c.end().catch(() => {}); }
}
if (!client) { console.error("no pool host"); process.exit(1); }

async function q(sql) { return (await client.query(sql)).rows; }

console.log("\n=== 1. Top 40 UNMAPPED 22bet market_types by active-market volume ===");
const rows = await q(`
  SELECT m.market_type, COUNT(*) AS markets, COUNT(DISTINCT m.event_id) AS events,
         (array_agg(DISTINCT s.name ORDER BY s.name))[1:5] AS sports
  FROM markets m
  JOIN events e ON e.id = m.event_id
  LEFT JOIN sports s ON s.id = e.sport_id
  LEFT JOIN market_normalization mn
    ON mn.source = e.source AND mn.source_market_type = m.market_type
  WHERE e.source = '22bet' AND m.is_active = true AND m.is_suspended = false
    AND (mn.canonical_key IS NULL OR NOT (mn.verified OR mn.confidence >= 90))
  GROUP BY m.market_type
  ORDER BY markets DESC
  LIMIT 40
`);
console.table(rows);

console.log("\n=== 2. Sample outcomes for each top-10 unmapped ===");
const top10 = rows.slice(0, 10);
for (const r of top10) {
  const outcomes = await q(`
    SELECT DISTINCT o.name
    FROM markets m
    JOIN outcomes o ON o.market_id = m.id
    JOIN events e ON e.id = m.event_id
    WHERE e.source = '22bet' AND m.market_type = '${r.market_type.replace(/'/g, "''")}'
      AND o.is_active = true
    LIMIT 6
  `);
  console.log(`\n  [${r.markets}] ${r.market_type}`);
  console.log(`    outcomes: ${outcomes.map(o => `"${o.name}"`).join(", ")}`);
}

await client.end();
