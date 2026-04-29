// Smoke test for mig 129: classify_event_source_only RPC.
// Picks a random unmapped event and runs classify on it.
import pg from "pg";

const target = process.argv[2] ?? "staging";
const PROJECTS = {
  staging: { projectRef: "bnabvfalytivjsrwqydo", password: "Veronihina2020@" },
  prod:    { projectRef: "xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW" },
};
const p = PROJECTS[target];
const hosts = [
  "aws-0-eu-west-1.pooler.supabase.com",
  "aws-1-eu-central-1.pooler.supabase.com",
  "aws-0-eu-central-1.pooler.supabase.com",
];
let client = null;
for (const host of hosts) {
  const c = new pg.Client({
    host, port: 5432, user: `postgres.${p.projectRef}`,
    password: p.password, database: "postgres",
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000,
  });
  try { await c.connect(); client = c; console.log("connected via", host, "→", target); break; }
  catch { await c.end().catch(() => {}); }
}
if (!client) { console.error("could not connect"); process.exit(1); }

await client.query(`SET statement_timeout = '60s'`);

// 1) Sample an event likely to be source_only (Setka Cup) and one likely mappable.
const setka = await client.query(`
  SELECT e.id, e.home_team, e.away_team, l.name AS league, s.name AS sport
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  LEFT JOIN leagues l ON l.id = e.league_id
  JOIN event_normalization en ON en.event_id = e.id
  WHERE en.match_stage = 'unmapped'
    AND e.is_source_only = false
    AND e.starts_at > now() - interval '30 days'
    AND s.name = 'Tennis Tavolo'
    AND (l.name = 'Setka Cup' OR l.name LIKE 'Setka Cup.%')
  LIMIT 1
`);
console.log("\nQ1 Setka sample:", setka.rows);

if (setka.rows.length > 0) {
  const r = await client.query(`SELECT classify_event_source_only($1) AS flag`, [setka.rows[0].id]);
  console.log("classify result:", r.rows[0]);
  // verify update
  const v = await client.query(`SELECT is_source_only FROM events WHERE id = $1`, [setka.rows[0].id]);
  console.log("events.is_source_only after:", v.rows[0]);
  // idempotent re-call
  const r2 = await client.query(`SELECT classify_event_source_only($1) AS flag`, [setka.rows[0].id]);
  console.log("re-call (idempotent):", r2.rows[0]);
}

// 2) Mainstream football should NOT be flagged.
const calcio = await client.query(`
  SELECT e.id, e.home_team, e.away_team, l.name AS league, s.name AS sport
  FROM events e
  JOIN sports s ON s.id = e.sport_id
  LEFT JOIN leagues l ON l.id = e.league_id
  JOIN event_normalization en ON en.event_id = e.id
  WHERE en.match_stage = 'unmapped'
    AND e.is_source_only = false
    AND s.name = 'Calcio'
    AND l.name = 'Unknown'
    AND e.external_id LIKE 'betfair:%'
    AND e.starts_at > now() - interval '7 days'
  LIMIT 1
`);
console.log("\nQ2 Calcio betfair Unknown sample (should NOT flag):", calcio.rows);
if (calcio.rows.length > 0) {
  const r = await client.query(`SELECT classify_event_source_only($1) AS flag`, [calcio.rows[0].id]);
  console.log("classify result:", r.rows[0]);
}

await client.end();
