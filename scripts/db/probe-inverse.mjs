import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const { count: tot } = await supa.from('events_v2').select('*', {count:'exact', head:true}).not('sofa_inverse_orientation','is',null);
console.log('events_v2 with sofa_inverse_orientation set:', tot);

const { data: trueVal } = await supa.from('events_v2').select('id, sport_slug, league_name, home, away').eq('sofa_inverse_orientation', true).limit(8);
console.log('\n=== sofa_inverse_orientation = TRUE ===');
for (const e of trueVal ?? []) console.log('  ['+e.sport_slug+'/'+e.league_name+'] '+e.home+' vs '+e.away);

const { count: falseCount } = await supa.from('events_v2').select('*', {count:'exact', head:true}).eq('sofa_inverse_orientation', false);
console.log('\nfalse count:', falseCount);
