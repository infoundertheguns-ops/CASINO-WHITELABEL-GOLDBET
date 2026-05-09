import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

console.log('=== markets schema (1 row sample) ===');
const { data: m1 } = await supa.from('markets').select('*').limit(1);
if (m1?.[0]) console.log(Object.keys(m1[0]).join(', '));

console.log('\n=== outcomes schema (1 row sample) ===');
const { data: o1 } = await supa.from('outcomes').select('*').limit(1);
if (o1?.[0]) console.log(Object.keys(o1[0]).join(', '));

console.log('\n=== consensus_snapshots schema (1 row sample) ===');
const { data: c1 } = await supa.from('consensus_snapshots').select('*').limit(1);
if (c1?.[0]) console.log(Object.keys(c1[0]).join(', '));

// Markets per nostra evento basketball live
const event_v2_id = '4c5889fc-cf27-4558-9238-3fd0cd87d6ef';
console.log('\n=== markets for live event Cividale-Rieti ===');
const { data: markets, count } = await supa.from('markets').select('id, market_key, market_period, last_update, is_active', {count:'exact'}).eq('event_v2_id', event_v2_id).limit(20);
console.log('total markets:', count);
if (markets?.length) {
  for (const m of markets) console.log('  '+m.market_key+' / '+(m.market_period||'(no period)')+' active='+m.is_active+' updated='+m.last_update);
}

// Outcomes for top 3 markets
if (markets?.length) {
  console.log('\n=== outcomes for first market ===');
  const { data: outs } = await supa.from('outcomes').select('*').eq('market_id', markets[0].id).limit(15);
  for (const o of outs ?? []) console.log('  ', JSON.stringify(o));
}
