import pg from "pg";
const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: "postgres.xgnyqkmugnfzhdveeqom", password: "2MQhskawT3I6XVKW", database: "postgres", ssl: { rejectUnauthorized: false }});
await c.connect();

// Mimic fetchCandidates exactly
async function fetchCandidates(sport, eventStartsAt) {
  const beSportMap = { 'Calcio': 'calcio', 'Tennis': 'tennis', 'Basket': 'basket', 'Pallamano': 'pallamano', 'Volley': 'volley', 'Hockey Ghiaccio': 'hockey', 'Tennis Tavolo': 'tennis_tavolo', 'Baseball': 'baseball', 'Rugby': 'rugby', 'Esports': 'esports', 'Cricket': 'cricket' };
  const beSport = beSportMap[sport] ?? sport.toLowerCase();
  const ts = new Date(eventStartsAt).getTime();
  const win = 3 * 60 * 60 * 1000;
  const r = await c.query(`
    SELECT be_match_id, home_team, away_team, match_date, sport, league
    FROM be_fixtures
    WHERE sport = $1
      AND match_date >= $2
      AND match_date <= $3
    LIMIT 50
  `, [beSport, new Date(ts - win).toISOString(), new Date(ts + win).toISOString()]);
  return r.rows;
}

// Sample sentinel events
const samples = await c.query(`
  SELECT en.id, e.id AS event_id, e.source, s.name AS sport, e.home_team, e.away_team, e.starts_at
  FROM event_normalization en
  JOIN events e ON e.id = en.event_id
  JOIN sports s ON s.id = e.sport_id
  WHERE en.match_stage = 'unmapped'
    AND s.name = 'Calcio'
    AND e.source = '22bet'
    AND e.status IN ('prematch', 'live')
    AND e.home_team NOT IN ('Home', 'Home (Special bets)')
    AND e.home_team NOT LIKE '% +'
    AND e.starts_at > now()
  ORDER BY random()
  LIMIT 5
`);

for (const ev of samples.rows) {
  console.log(`\n[${ev.source}/${ev.sport}] "${ev.home_team}" vs "${ev.away_team}" @ ${ev.starts_at.toISOString().slice(0,16)}`);
  const cands = await fetchCandidates(ev.sport, ev.starts_at);
  console.log(`  ${cands.length} candidate(s):`);
  for (const c of cands.slice(0, 5)) {
    const dt = new Date(c.match_date).toISOString().slice(0,16);
    console.log(`   "${c.home_team}" vs "${c.away_team}" @ ${dt} [${c.league}]`);
  }
}

await c.end();
