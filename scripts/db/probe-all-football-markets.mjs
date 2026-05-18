import pg from 'pg';
const p = { projectRef: 'xgnyqkmugnfzhdveeqom', password: '2MQhskawT3I6XVKW' };
const c = new pg.Client({ host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, user: 'postgres.' + p.projectRef, password: p.password, database: 'postgres', ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();
await c.query("SET statement_timeout = '5min'");
const r = await c.query(`
  SELECT m.market_name,
         COUNT(DISTINCT m.event_id || '|' || m.bookmaker) AS market_emits
  FROM markets_v2 m
  JOIN events_v2 e ON e.id = m.event_id
  WHERE e.sport_slug = 'football' AND e.starts_at > now() - interval '7 days'
  GROUP BY m.market_name
  ORDER BY market_emits DESC
`);
console.log('TOTAL_ROWS=' + r.rows.length);
for (const row of r.rows) console.log(row.market_emits + '\t' + row.market_name);
await c.end();
