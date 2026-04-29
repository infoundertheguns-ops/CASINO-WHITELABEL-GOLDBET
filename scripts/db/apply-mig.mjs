#!/usr/bin/env node
import pg from "pg";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const args = process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a[x.replace(/^--/, "")] = arr[i + 1];
  return a;
}, {});
const target = args.target;
const file = args.file;
if (!target || !file) { console.error("Usage: --target staging|prod --file path.sql"); process.exit(1); }

const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS[target];
if (!p) { console.error("invalid target"); process.exit(1); }

const sql = fs.readFileSync(file, "utf-8");
const name = path.basename(file);
const sha = crypto.createHash("sha256").update(sql).digest("hex");

// Try multiple pooler hosts — first successful connection wins.
// Supabase projects are hosted on aws-{0,1}-{region}.pooler.supabase.com;
// the suffix digit varies per-project and isn't known in advance.
const hosts = [
  "aws-0-eu-west-1.pooler.supabase.com",      // staging
  "aws-1-eu-central-1.pooler.supabase.com",   // prod
  "aws-0-eu-central-1.pooler.supabase.com",
  "aws-0-eu-west-2.pooler.supabase.com",
  "aws-0-us-east-1.pooler.supabase.com",
];
let client = null;
let usedHost = null;
for (const host of hosts) {
  const c = new pg.Client({
    host,
    port: 5432,  // session mode (needed for DDL)
    user: `postgres.${p.projectRef}`,
    password: p.password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });
  try {
    await c.connect();
    client = c;
    usedHost = host;
    break;
  } catch (err) {
    await c.end().catch(() => {});
  }
}
if (!client) { console.error("could not connect to any pooler host"); process.exit(1); }
console.log(`connected via ${usedHost} (${target})`);
if (target === "prod") console.log(`⚠️  PROD`);

await client.query(`CREATE TABLE IF NOT EXISTS public._migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sha256 TEXT,
  notes TEXT
);`);

const { rows } = await client.query("SELECT sha256 FROM public._migrations WHERE name=$1", [name]);
if (rows.length > 0) {
  if (rows[0].sha256 === sha) {
    console.log(`⏭  ${name} already applied, sha matches`);
    await client.end();
    process.exit(0);
  }
  console.error(`⚠️  ${name} already applied with DIFFERENT sha. local=${sha.slice(0, 8)} db=${rows[0].sha256?.slice(0, 8)}`);
  await client.end();
  process.exit(1);
}

console.log(`▶  applying ${name} (sha=${sha.slice(0, 8)})`);
try {
  await client.query(sql);
  await client.query("INSERT INTO public._migrations(name, sha256) VALUES ($1, $2)", [name, sha]);
  console.log(`✓  ${name} done`);
} catch (err) {
  console.error(`✗  ${name} failed:`, err.message);
  await client.end();
  process.exit(1);
}
await client.end();
