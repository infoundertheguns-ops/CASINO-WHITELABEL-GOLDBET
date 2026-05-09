import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// markets latest record
const { data: m } = await supa.from('markets').select('updated_at, created_at').order('updated_at', {ascending:false}).limit(1);
console.log('=== markets most-recent updated_at:', m?.[0]?.updated_at);
console.log('=== markets most-recent created_at:', m?.[0]?.created_at);
const { data: mc } = await supa.from('markets').select('created_at').order('created_at', {ascending:false}).limit(1);
console.log('=== markets max created_at:', mc?.[0]?.created_at);

// outcomes latest
const { data: o } = await supa.from('outcomes').select('updated_at').order('updated_at', {ascending:false}).limit(1);
console.log('=== outcomes most-recent updated_at:', o?.[0]?.updated_at);

// consensus_snapshots latest
const { data: c } = await supa.from('consensus_snapshots').select('snapshot_at').order('snapshot_at', {ascending:false}).limit(1);
console.log('=== consensus_snapshots most-recent:', c?.[0]?.snapshot_at);

// events_v2 latest update
const { data: ev } = await supa.from('events_v2').select('updated_at').order('updated_at', {ascending:false}).limit(1);
console.log('=== events_v2 most-recent updated_at:', ev?.[0]?.updated_at);

// event_enrichment latest
const { data: enr } = await supa.from('event_enrichment').select('last_synced_at').order('last_synced_at', {ascending:false}).limit(1);
console.log('=== event_enrichment most-recent last_synced_at:', enr?.[0]?.last_synced_at);

// system_config last_run keys
const { data: sc } = await supa.from('system_config').select('key, value').like('key', 'last_run_%');
console.log('\n=== system_config last_run_* ===');
for (const r of sc ?? []) console.log('  '+r.key+' = '+(r.value||'').slice(0,50));
