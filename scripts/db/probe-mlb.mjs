import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const now = new Date().toISOString();
const in12h = new Date(Date.now()+12*3600*1000).toISOString();
const { data: mlb, error } = await supa.from('events_v2').select('id, sport_slug, league_name, league_slug, home, away, starts_at, status, sofascore_id, flashscore_id').eq('sport_slug','baseball').or('league_name.ilike.%mlb%,league_slug.ilike.%mlb%').gte('starts_at', now).lte('starts_at', in12h).order('starts_at',{ascending:true});
if (error) { console.error(error); process.exit(1); }
console.log('=== MLB upcoming next 12h:', mlb?.length || 0, '===');
let withSofa=0, withoutSofa=0, withFs=0;
for (const e of mlb ?? []) { if (e.sofascore_id) withSofa++; else withoutSofa++; if (e.flashscore_id) withFs++; }
console.log(' with sofascore_id:', withSofa, ' / ', (mlb?.length||0));
console.log(' with flashscore_id:', withFs, ' / ', (mlb?.length||0));
console.log('First 8:');
for (const e of (mlb??[]).slice(0,8)) console.log('  '+e.starts_at.slice(0,16)+'  '+e.home+' vs '+e.away+'  status='+e.status+'  sofa='+(e.sofascore_id||'-')+' fs='+(e.flashscore_id||'-')+'  league='+e.league_name);
const { data: live } = await supa.from('events_v2').select('id, league_name, home, away, status, sofascore_id, flashscore_id').eq('sport_slug','baseball').eq('status','live');
console.log('\n=== ALL baseball live now:', live?.length || 0, '===');
for (const e of live ?? []) console.log('  '+(e.league_name||'-')+'  '+e.home+' vs '+e.away+'  sofa='+(e.sofascore_id||'-')+' fs='+(e.flashscore_id||'-'));
const { data: bb } = await supa.from('events_v2').select('id, league_name, home, away, status, sofascore_id').eq('sport_slug','baseball').not('sofascore_id','is',null).gte('starts_at', new Date(Date.now()-24*3600*1000).toISOString()).order('starts_at',{ascending:false}).limit(200);
console.log('\n=== Last baseball-with-sofa (24h):', bb?.length || 0, '===');
const byLeague = {};
for (const e of bb ?? []) byLeague[e.league_name] = (byLeague[e.league_name]||0)+1;
for (const [l,c] of Object.entries(byLeague).sort((a,b)=>b[1]-a[1])) console.log('  '+String(c).padStart(3)+' '+l);
