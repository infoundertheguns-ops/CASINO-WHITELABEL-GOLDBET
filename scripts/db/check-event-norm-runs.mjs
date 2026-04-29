#!/usr/bin/env node
import pg from "pg";

const PROJECTS = {
  prod: { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};

const p = PROJECTS.prod;
const hosts = ["aws-1-eu-central-1.pooler.supabase.com", "aws-0-eu-central-1.pooler.supabase.com"];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({ host, port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try { await c.connect(); client = c; break; } catch { await c.end().catch(()=>{}); }
}
if (!client) process.exit(1);

console.log("=== last 12 event_normalization_runs (≈last 2h auto runs) ===");
const r = await client.query(`
  SELECT
    to_char(created_at, 'YYYY-MM-DD HH24:MI') AS ts,
    source,
    processed,
    matched,
    llm_used,
    duration_ms,
    stats->>'regex' AS regex,
    stats->>'trigram' AS trig,
    stats->>'alias_dict' AS alias,
    stats->>'propagation' AS prop,
    stats->>'llm' AS llm_m,
    stats->>'unmapped' AS unmap
  FROM event_normalization_runs
  ORDER BY created_at DESC
  LIMIT 12
`);
r.rows.forEach(x => {
  console.log(`  ${x.ts} ${x.source.padEnd(20)} proc=${String(x.processed).padStart(4)} match=${String(x.matched).padStart(3)} llm_used=${String(x.llm_used).padStart(2)} | regex=${x.regex||0} trig=${x.trig||0} alias=${x.alias||0} prop=${x.prop||0} llm=${x.llm_m||0} unmap=${x.unmap||0}  ${x.duration_ms}ms`);
});

console.log("\n=== sample 5 unmapped events queued NOW (next_unmapped_events) ===");
const next = await client.query(`SELECT * FROM next_unmapped_events(5, NULL)`);
next.rows.forEach(e => console.log(`  ${e.home_team.padEnd(35)} vs ${e.away_team.padEnd(25)} | ${e.sport_name} | league=${e.league_name ?? '-'} country=${e.country_name ?? '-'}`));

console.log("\n=== for each sample, how many candidates does v2 RPC find? ===");
for (const e of next.rows) {
  const cand = await client.query(`SELECT COUNT(*)::int AS n, MAX(score) AS best FROM match_event_by_trigram_v2($1,$2,$3,$4,$5,$6,12,10)`,
    [e.sport_name, e.home_team, e.away_team, e.starts_at, e.league_name, e.country_name]);
  console.log(`  ${e.home_team.slice(0,30).padEnd(30)} vs ${e.away_team.slice(0,20).padEnd(20)} → candidates=${cand.rows[0].n} best_score=${cand.rows[0].best ?? 'null'}`);
}

await client.end();
