import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Pick the first MLB game upcoming
const { data: ev } = await supa.from('events_v2').select('*').eq('sport_slug','baseball').or('league_name.ilike.%mlb%').gte('starts_at', new Date().toISOString()).order('starts_at').limit(1).maybeSingle();

console.log('=== events_v2 row (OddsAPI ingestion + matched binding) ===');
console.log(JSON.stringify(ev, null, 2));

// Look for legacy 'events' row (oddsapi raw)
const { data: legacy } = await supa.from('events').select('*').eq('odds_api_id', ev?.odds_api_id).limit(1).maybeSingle();
console.log('\n=== legacy events row (OddsAPI raw, if exists) ===');
console.log(JSON.stringify(legacy, null, 2));

// event_enrichment for sofa
const { data: enr } = await supa.from('event_enrichment').select('*').eq('event_v2_id', ev?.id).maybeSingle();
console.log('\n=== event_enrichment (Sofa data attached) ===');
if (enr) {
  // Truncate large JSONB to keys+sample
  const summary = {};
  for (const [k,v] of Object.entries(enr)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      summary[k] = '[object with keys: ' + Object.keys(v).slice(0,15).join(',') + (Object.keys(v).length>15?'...':'') + ']';
    } else {
      summary[k] = v;
    }
  }
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('(no enrichment row yet — likely game is pending)');
}
