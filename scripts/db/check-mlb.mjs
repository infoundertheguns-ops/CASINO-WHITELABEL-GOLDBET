import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data } = await supa.from('events_v2').select('id, league_name, home, away, sofa_inverse_orientation, sofascore_id').or('league_name.ilike.%mlb%').gte('starts_at', new Date().toISOString()).limit(8);
console.log(' MLB upcoming:');
for (const e of data ?? []) console.log('  '+e.home+' vs '+e.away+' inverse='+e.sofa_inverse_orientation+' sofa='+e.sofascore_id+' league='+e.league_name);
