import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Take a LIVE event that has data populated (not pending)
const { data: live } = await supa.from('events_v2').select('*').eq('status','live').not('flashscore_id','is',null).not('sofascore_id','is',null).limit(1);
const ev = live?.[0];
if (!ev) { console.log('no live event found with both fs+sofa'); process.exit(1); }

console.log('=== LIVE event being analyzed:', ev.home, 'vs', ev.away, '('+ev.sport_slug+', '+ev.league_name+') ===');
console.log('events_v2.id =', ev.id);
console.log('flashscore_id =', ev.flashscore_id);
console.log('sofascore_id =', ev.sofascore_id);
console.log();

// events_v2 — popolated keys
console.log('=== events_v2 columns: populated vs null ===');
const populated = [], nulls = [];
for (const [k,v] of Object.entries(ev)) {
  if (v == null || (typeof v === 'object' && Object.keys(v).length === 0)) nulls.push(k);
  else populated.push(k);
}
console.log(' POPULATED:', populated.join(', '));
console.log(' NULL/EMPTY:', nulls.join(', '));

// live_data structure
console.log('\n=== events_v2.live_data structure (FS-populated) ===');
if (ev.live_data) {
  for (const [k,v] of Object.entries(ev.live_data)) {
    if (Array.isArray(v)) console.log('  '+k+' = Array[' + v.length + '] — sample[0]:', JSON.stringify(v[0])?.slice(0,150));
    else if (v && typeof v === 'object') console.log('  '+k+' = Object{'+Object.keys(v).join(',')+'}');
    else console.log('  '+k+' =', v);
  }
} else console.log(' (null)');

// event_enrichment
console.log('\n=== event_enrichment row (Sofa-populated) ===');
const { data: enr } = await supa.from('event_enrichment').select('*').eq('event_v2_id', ev.id).maybeSingle();
if (enr) {
  for (const [k,v] of Object.entries(enr)) {
    if (v == null) console.log('  '+k+' = NULL');
    else if (typeof v === 'object' && !Array.isArray(v)) console.log('  '+k+' = Object{'+Object.keys(v).join(',')+'}');
    else if (Array.isArray(v)) console.log('  '+k+' = Array[' + v.length + ']');
    else console.log('  '+k+' =', String(v).slice(0,80));
  }
} else console.log(' (no enrichment row)');

// Markets/odds — separato?
console.log('\n=== Tables in DB containing odds/markets:');
const { data: tables } = await supa.rpc('information_schema_tables_list', {}).catch(() => ({data:null}));
// Fallback list known tables
const knownTables = ['markets','odds','event_markets','event_odds','market_lines','market_outcomes'];
for (const t of knownTables) {
  const { error, count } = await supa.from(t).select('*',{count:'exact', head:true}).eq('event_v2_id', ev.id).catch(e => ({error:e}));
  if (!error) console.log('  '+t+' rows for this event:', count);
}
// fallback: just check if these tables exist
for (const t of knownTables) {
  const { error } = await supa.from(t).select('id').limit(1);
  if (!error) console.log('  table '+t+' EXISTS');
}
