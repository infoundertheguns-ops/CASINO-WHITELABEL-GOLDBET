import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const now = new Date().toISOString();
const in18h = new Date(Date.now()+18*3600*1000).toISOString();
const { data: nba, error } = await supa.from('events_v2').select('id, league_name, home, away, starts_at, status, sofascore_id, flashscore_id').eq('sport_slug','basketball').or('league_name.ilike.%nba%,league_name.ilike.%playoff%').gte('starts_at', now).lte('starts_at', in18h).order('starts_at',{ascending:true});
if (error) { console.error(error); process.exit(1); }
const nbaOnly = (nba||[]).filter(e => /USA - NBA/i.test(e.league_name||'') || /^NBA/i.test(e.league_name||''));
console.log('=== NBA upcoming next 18h:', nbaOnly.length, '===');
let withSofa=0, withFs=0;
for (const e of nbaOnly) { if (e.sofascore_id) withSofa++; if (e.flashscore_id) withFs++; }
console.log(' with sofascore_id:', withSofa, ' / ', nbaOnly.length);
console.log(' with flashscore_id:', withFs, ' / ', nbaOnly.length);
for (const e of nbaOnly.slice(0,8)) console.log('  '+e.starts_at.slice(0,16)+'  '+e.home+' vs '+e.away+'  sofa='+(e.sofascore_id||'-')+' fs='+(e.flashscore_id||'-')+'  '+e.league_name);
const { data: live } = await supa.from('events_v2').select('id, league_name, home, away, status, sofascore_id, flashscore_id').eq('sport_slug','basketball').eq('status','live').limit(20);
console.log('\n=== ALL basketball live now:', live?.length || 0, '===');
for (const e of (live||[]).slice(0,15)) console.log('  '+(e.league_name||'-')+'  '+e.home+' vs '+e.away+'  sofa='+(e.sofascore_id||'-')+' fs='+(e.flashscore_id||'-'));
const { data: bk } = await supa.from('events_v2').select('league_name').eq('sport_slug','basketball').not('sofascore_id','is',null).gte('starts_at', new Date(Date.now()-24*3600*1000).toISOString()).limit(500);
const byLeague = {};
for (const e of bk ?? []) byLeague[e.league_name] = (byLeague[e.league_name]||0)+1;
console.log('\n=== Top basketball leagues 24h with sofa:', Object.keys(byLeague).length, '===');
for (const [l,c] of Object.entries(byLeague).sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log('  '+String(c).padStart(3)+' '+l);
