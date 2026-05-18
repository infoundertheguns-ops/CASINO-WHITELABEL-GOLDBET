#!/usr/bin/env node
import pg from 'pg';
const p = { projectRef: 'xgnyqkmugnfzhdveeqom', password: '2MQhskawT3I6XVKW' };
const c = new pg.Client({ host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: 'postgres', ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();
await c.query("SET statement_timeout = '5min'");

const r = await c.query(`
  SELECT m.market_name,
         COUNT(DISTINCT m.event_id || '|' || m.bookmaker) AS market_emits,
         COUNT(o.id) AS outcomes
  FROM markets_v2 m
  JOIN events_v2 e ON e.id = m.event_id
  LEFT JOIN outcomes_v2 o ON o.market_id = m.id
  WHERE e.sport_slug = 'football' AND e.starts_at > now() - interval '7 days'
  GROUP BY m.market_name
  ORDER BY market_emits DESC
`);
console.table(r.rows.slice(80));

await c.end();
