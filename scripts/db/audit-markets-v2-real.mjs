import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Recency markets_v2 + outcomes_v2
const { count: mv2c } = await supa.from('markets_v2').select('*', {count:'exact', head:true});
console.log('=== markets_v2 total rows:', mv2c);
const { data: mv2 } = await supa.from('markets_v2').select('*').order('updated_at',{ascending:false}).limit(2);
console.log(' most-recent:');
for (const r of mv2 ?? []) console.log('  '+JSON.stringify(r).slice(0,250));

const { count: ov2c } = await supa.from('outcomes_v2').select('*', {count:'exact', head:true});
console.log('\n=== outcomes_v2 total rows:', ov2c);
const { data: ov2 } = await supa.from('outcomes_v2').select('*').order('updated_at',{ascending:false}).limit(2);
console.log(' most-recent:');
for (const r of ov2 ?? []) console.log('  '+JSON.stringify(r).slice(0,250));

// Markets for our basketball event
const event_v2_id = '4c5889fc-cf27-4558-9238-3fd0cd87d6ef';
const { data: mEv, count: mEvC } = await supa.from('markets_v2').select('id, bookmaker, market_name, line, last_update', {count:'exact'}).eq('event_id', event_v2_id);
console.log('\n=== markets_v2 for Cividale-Rieti basketball ===');
console.log(' total:', mEvC);
const byBook = {};
for (const m of mEv ?? []) { byBook[m.bookmaker] = (byBook[m.bookmaker]||0)+1; }
console.log(' by bookmaker:', JSON.stringify(byBook));
console.log(' first 5:');
for (const m of (mEv ?? []).slice(0,5)) console.log('  '+m.bookmaker+' / '+m.market_name+(m.line!=null?' line='+m.line:'')+' updated='+m.last_update);

// Outcomes count for first market
if (mEv?.[0]) {
  const { data: outs, count: outsC } = await supa.from('outcomes_v2').select('outcome_key, outcome_name, price, line_norm, updated_at', {count:'exact'}).eq('market_id', mEv[0].id);
  console.log('\n=== outcomes_v2 for first market ('+mEv[0].market_name+') ===');
  console.log(' count:', outsC);
  for (const o of (outs ?? []).slice(0,5)) console.log('  '+o.outcome_name+' price='+o.price+' line='+o.line_norm+' updated='+o.updated_at);
}
