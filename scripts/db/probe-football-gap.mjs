#!/usr/bin/env node
import pg from 'pg';
const p = { projectRef: 'xgnyqkmugnfzhdveeqom', password: '2MQhskawT3I6XVKW' };
const c = new pg.Client({ host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, user: `postgres.${p.projectRef}`, password: p.password, database: 'postgres', ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();
await c.query("SET statement_timeout = '5min'");

console.log('=== canonical_market_normalization table existence + coverage for football market_names ===');
const tbl = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='market_normalization' ORDER BY ordinal_position");
console.log('market_normalization cols:', tbl.rows.map(r => r.column_name).join(', '));

const tbl2 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='canonical_market_normalization' ORDER BY ordinal_position");
console.log('canonical_market_normalization cols:', tbl2.rows.map(r => r.column_name).join(', '));

console.log('\n=== football market_names + canonical key mapping (if any) ===');
const r = await c.query(`
  WITH football_markets AS (
    SELECT m.market_name, COUNT(DISTINCT m.event_id || '|' || m.bookmaker) AS emits
    FROM markets_v2 m
    JOIN events_v2 e ON e.id = m.event_id
    WHERE e.sport_slug = 'football' AND e.starts_at > now() - interval '7 days'
    GROUP BY m.market_name
  )
  SELECT fm.market_name, fm.emits, mn.canonical_key
  FROM football_markets fm
  LEFT JOIN market_normalization mn ON mn.source = 'odds-api' AND mn.source_market_type = fm.market_name
  ORDER BY fm.emits DESC
`);
console.table(r.rows);

await c.end();
