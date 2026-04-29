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
  try { await c.connect(); client = c; console.log("connected via", host, "→", target); break; }
  catch { await c.end().catch(() => {}); }
}
if (!client) process.exit(1);

console.log("\n=== normalize_team_name() ===");
const norm = await client.query(`
  SELECT input, normalize_team_name(input) AS out FROM (VALUES
    ('Šeško United'),
    ('Atletico Alagoinhas (Women)'),
    ('Smorgon II'),
    ('PSG'),
    ('Paris Saint-Germain'),
    ('FC Bayern München'),
    ('Real Madrid B'),
    ('Inter Milan U23')
  ) AS t(input)
`);
norm.rows.forEach(r => console.log(`  ${r.input.padEnd(35)} → "${r.out}"`));

console.log("\n=== has_women_suffix / has_reserves_suffix ===");
const flags = await client.query(`
  SELECT input,
    has_women_suffix(input) AS women,
    has_reserves_suffix(input) AS reserves
  FROM (VALUES
    ('Atletico Alagoinhas (Women)'),
    ('Atletico Alagoinhas'),
    ('Smorgon II'),
    ('Smorgon'),
    ('Inter U23')
  ) AS t(input)
`);
flags.rows.forEach(r => console.log(`  ${r.input.padEnd(35)} women=${r.women} reserves=${r.reserves}`));

console.log("\n=== match_event_by_trigram_v2 — pull a real unmapped event and try ===");
const evRes = await client.query(`
  SELECT e.id, e.home_team, e.away_team, e.starts_at, s.name AS sport_name, l.name AS league_name, l.country
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  LEFT JOIN leagues l ON l.id = e.league_id
  WHERE e.flashscore_id IS NULL
    AND e.status IN ('prematch','live')
    AND s.name = 'Calcio'
    AND e.starts_at > NOW()
  ORDER BY e.starts_at ASC
  LIMIT 1
`);
if (evRes.rows.length === 0) {
  console.log("  (no unmapped Calcio events to test)");
} else {
  const ev = evRes.rows[0];
  console.log(`  Event: ${ev.home_team} vs ${ev.away_team} | ${ev.league_name ?? '(no league)'} ${ev.country ?? ''}`);
  const r = await client.query(`
    SELECT * FROM match_event_by_trigram_v2($1, $2, $3, $4, $5, $6, 12, 5)
  `, [ev.sport_name, ev.home_team, ev.away_team, ev.starts_at, ev.league_name, ev.country]);
  if (r.rows.length === 0) {
    console.log("  → 0 candidates (no fixture in 12h window)");
  } else {
    r.rows.forEach((c, i) => {
      console.log(`  #${i+1} score=${Number(c.score).toFixed(3)} | ${c.home_team} vs ${c.away_team} | trig=${Number(c.trigram_home).toFixed(2)}/${Number(c.trigram_away).toFixed(2)} l+=${Number(c.league_boost).toFixed(2)} c+=${Number(c.country_boost).toFixed(2)} t+=${Number(c.time_bonus).toFixed(2)} g=${Number(c.gender_penalty).toFixed(2)} r=${Number(c.reserves_penalty).toFixed(2)}`);
    });
  }
}

console.log("\n=== next_unmapped_events new shape ===");
const nu = await client.query(`SELECT * FROM next_unmapped_events(2, NULL)`);
console.log("  columns:", Object.keys(nu.rows[0] ?? {}).join(", "));
nu.rows.forEach(r => console.log(`  ${r.home_team} vs ${r.away_team} | sport=${r.sport_name} league=${r.league_name ?? '-'} country=${r.country_name ?? '-'}`));

await client.end();
