#!/usr/bin/env node
import pg from "pg";

const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};

const target = process.argv[2] ?? "staging";
const p = PROJECTS[target];
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
  try { await c.connect(); client = c; console.log("connected via", host); break; }
  catch { await c.end().catch(() => {}); }
}
if (!client) process.exit(1);

const r1 = await client.query(`SELECT extname, extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname IN ('unaccent','pg_trgm')`);
console.log("extensions:", r1.rows);

const r2 = await client.query(`SHOW search_path`);
console.log("search_path:", r2.rows[0].search_path);

const r3 = await client.query(`SELECT proname, pronamespace::regnamespace::text AS schema FROM pg_proc WHERE proname='unaccent' LIMIT 5`);
console.log("unaccent functions:", r3.rows);

await client.end();
