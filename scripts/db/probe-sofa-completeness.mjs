import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Mappa attesa per (basketball, live)
const expectedBasketLive = ['stats','lineups','incidents','momentum','shotmap','best_players','highlights','votes','featured_players'];

// Tutti i basketball live che hanno enrichment popolato
const { data: live } = await supa.from('events_v2').select('id, home, away, sport_slug, league_name').eq('status','live').eq('sport_slug','basketball').not('sofascore_id','is',null).limit(50);
console.log('Total basketball live with sofa_id:', live?.length || 0);
const ids = live?.map(e => e.id) ?? [];
const { data: enr } = await supa.from('event_enrichment').select('event_v2_id, last_endpoint_status, stats, lineups, incidents, momentum, shotmap, best_players, highlights, votes, featured_players, last_synced_at').in('event_v2_id', ids);
const byId = new Map(enr?.map(r => [r.event_v2_id, r]));

console.log('\n=== Per-evento — completezza enrichment per (basketball, live) ===');
const counters = {};
for (const k of expectedBasketLive) counters[k] = { populated: 0, status_ok: 0, status_fail: 0, missing_status: 0 };
let totalRows = 0;
for (const ev of live ?? []) {
  const e = byId.get(ev.id);
  if (!e) continue;
  totalRows++;
  for (const k of expectedBasketLive) {
    const colKey = k === 'momentum' ? 'momentum' : k;
    const colVal = e[colKey];
    if (colVal !== null) counters[k].populated++;
    const status = e.last_endpoint_status?.[k];
    if (!status) counters[k].missing_status++;
    else if (status.ok === true) counters[k].status_ok++;
    else counters[k].status_fail++;
  }
}
console.log('rows analyzed:', totalRows);
console.log('endpoint        | populated  | status_ok | status_fail | missing_status');
console.log('----------------+------------+-----------+-------------+----------------');
for (const k of expectedBasketLive) {
  const c = counters[k];
  console.log(' '+k.padEnd(15)+'|  '+String(c.populated).padStart(3)+'/'+totalRows+'    |    '+String(c.status_ok).padStart(3)+'   |     '+String(c.status_fail).padStart(3)+'    |     '+String(c.missing_status).padStart(3));
}

console.log('\n=== Sample 4 events (last_endpoint_status keys present) ===');
let i = 0;
for (const ev of live ?? []) {
  if (i++ >= 4) break;
  const e = byId.get(ev.id);
  if (!e) continue;
  const keys = Object.keys(e.last_endpoint_status ?? {});
  const populated = expectedBasketLive.filter(k => e[k]!==null);
  console.log('  '+ev.home+' vs '+ev.away+'  ['+ev.league_name+']');
  console.log('    last_synced_at:', e.last_synced_at);
  console.log('    last_endpoint_status keys:', keys.join(',') || '(empty)');
  console.log('    column populated:', populated.join(',') || '(none)');
}
