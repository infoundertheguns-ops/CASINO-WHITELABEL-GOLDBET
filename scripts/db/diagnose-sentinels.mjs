#!/usr/bin/env node
import pg from "pg";

const PROJECTS = {
  prod: { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS.prod;

const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: `postgres.${p.projectRef}`, password: p.password, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("=== SENTINEL BACKLOG (last 7d) ===");
const r = await c.query(`
  SELECT
    e.source,
    s.name AS sport,
    COUNT(*) as count
  FROM event_normalization en
  JOIN events e ON e.id = en.event_id
  JOIN sports s ON s.id = e.sport_id
  WHERE en.match_stage = 'unmapped'
    AND en.created_at >= now() - interval '7 days'
    AND e.status IN ('prematch', 'live')
    AND e.home_team NOT IN ('Home', 'Home (Special bets)')
    AND e.home_team NOT LIKE '% +'
  GROUP BY e.source, s.name
  ORDER BY count DESC
  LIMIT 30
`);
for (const row of r.rows) {
  console.log(`  ${row.source.padEnd(8)} ${row.sport.padEnd(20)} ${row.count}`);
}

console.log("\n=== CANDIDATES PER SENTINEL (sample 5) ===");
const samples = await c.query(`
  SELECT en.id, e.id AS event_id, e.source, s.name AS sport, e.home_team, e.away_team, e.starts_at
  FROM event_normalization en
  JOIN events e ON e.id = en.event_id
  JOIN sports s ON s.id = e.sport_id
  WHERE en.match_stage = 'unmapped'
    AND en.created_at >= now() - interval '7 days'
    AND e.status IN ('prematch', 'live')
    AND e.home_team NOT IN ('Home', 'Home (Special bets)')
    AND e.home_team NOT LIKE '% +'
  ORDER BY random()
  LIMIT 5
`);

for (const ev of samples.rows) {
  console.log(`\n  [${ev.source}/${ev.sport}] ${ev.home_team} vs ${ev.away_team} @ ${ev.starts_at.toISOString().slice(0,16)}`);
  // Try trigram fuzzy match
  const cand = await c.query(`
    SELECT * FROM next_flashscore_candidates($1::text, $2::text, $3::text, $4::timestamptz, 5)
  `, [ev.sport, ev.home_team, ev.away_team, ev.starts_at]).catch(e => ({rows: [], err: e.message}));
  if (cand.err) {
    console.log(`    candidate err: ${cand.err}`);
  } else if (cand.rows.length === 0) {
    console.log("    NO candidates");
  } else {
    for (const c of cand.rows.slice(0, 3)) {
      console.log(`    cand: ${c.home_team} vs ${c.away_team} @ ${(c.match_date || '').toString().slice(0,16)} sim=${c.score?.toFixed?.(3) ?? '?'}`);
    }
  }
}

await c.end();
