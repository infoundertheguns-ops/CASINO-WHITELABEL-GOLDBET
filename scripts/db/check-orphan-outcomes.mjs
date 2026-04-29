#!/usr/bin/env node
// Single SELECT to check how many orphan outcomes remain.
// Usage: node scripts/db/check-orphan-outcomes.mjs --target prod|staging

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
    host,
    port: 5432,
    user: `postgres.${p.projectRef}`,
    password: p.password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try { await c.connect(); client = c; console.error(`connected via ${host} (${target})`); break; }
  catch (e) { /* try next */ }
}
if (!client) { console.error("no pooler host worked"); process.exit(1); }

// Count orphans: outcomes still is_active=true on events that are ended+settled for >6h.
const res = await client.query(`
  SELECT COUNT(*)::bigint AS n
  FROM outcomes o
  JOIN markets m ON m.id = o.market_id
  JOIN events  e ON e.id = m.event_id
  WHERE o.is_active = true
    AND e.status = 'ended'
    AND e.settled_at IS NOT NULL
    AND e.settled_at < NOW() - INTERVAL '6 hours'
`);
console.log(`orphan_outcomes=${res.rows[0].n}`);

await client.end();
