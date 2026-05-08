import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Tighter window: post-flip events
const since = '2026-05-08T14:47:46Z';
const until = new Date(Date.now()+12*3600*1000).toISOString();

const { data: all, error } = await supa.from('events_v2').select('id, sport_slug, league_name, home, away, starts_at, status, sofascore_id, flashscore_id').gte('starts_at', since).lte('starts_at', until).order('starts_at', {ascending:false}).limit(5000);
if (error) { console.error(error); process.exit(1); }

const total = all.length;
const both = all.filter(e => e.sofascore_id && e.flashscore_id).length;
const fsOnly = all.filter(e => e.flashscore_id && !e.sofascore_id);
const sofaOnly = all.filter(e => e.sofascore_id && !e.flashscore_id);
const neither = all.filter(e => !e.sofascore_id && !e.flashscore_id).length;

console.log('=== Coverage POST-FLIP window:', since, '..', until.slice(0,16), '===');
console.log(' total:', total);
console.log(' both:', both, '('+(100*both/total).toFixed(1)+'%)');
console.log(' fs-only:', fsOnly.length, '('+(100*fsOnly.length/total).toFixed(1)+'%)');
console.log(' sofa-only:', sofaOnly.length, '('+(100*sofaOnly.length/total).toFixed(1)+'%)');
console.log(' neither:', neither, '('+(100*neither/total).toFixed(1)+'%)');

console.log('\n=== FS-only by sport ===');
const fsBySport = {};
for (const e of fsOnly) fsBySport[e.sport_slug] = (fsBySport[e.sport_slug]||0)+1;
for (const [s,c] of Object.entries(fsBySport).sort((a,b)=>b[1]-a[1])) console.log('  '+String(c).padStart(4)+' '+s);

console.log('\n=== Sofa-only by sport ===');
const sofaBySport = {};
for (const e of sofaOnly) sofaBySport[e.sport_slug] = (sofaBySport[e.sport_slug]||0)+1;
for (const [s,c] of Object.entries(sofaBySport).sort((a,b)=>b[1]-a[1])) console.log('  '+String(c).padStart(4)+' '+s);

console.log('\n=== NEITHER by sport ===');
const ntBySport = {};
for (const e of all.filter(e=>!e.sofascore_id && !e.flashscore_id)) ntBySport[e.sport_slug] = (ntBySport[e.sport_slug]||0)+1;
for (const [s,c] of Object.entries(ntBySport).sort((a,b)=>b[1]-a[1])) console.log('  '+String(c).padStart(4)+' '+s);

function sample(arr, n) { const c=[...arr]; const out=[]; while(c.length && out.length<n){ out.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); } return out; }

console.log('\n=== Sample 25 FS-only (focus on boxing/mma + var) ===');
const fsBM = fsOnly.filter(e => /(boxing|mma)/i.test(e.sport_slug));
const fsOther = fsOnly.filter(e => !/(boxing|mma)/i.test(e.sport_slug));
const fsSample = [...fsBM.slice(0,12), ...sample(fsOther, 13)].slice(0,25);
for (const e of fsSample) console.log('  ['+e.sport_slug+'] '+e.home+' vs '+e.away+'  fs='+e.flashscore_id+'  ('+ (e.league_name||'').slice(0,30)+')');

console.log('\n=== Sample 25 Sofa-only ===');
const sofaSample = sample(sofaOnly, 25);
for (const e of sofaSample) console.log('  ['+e.sport_slug+'] '+e.home+' vs '+e.away+'  sofa='+e.sofascore_id+'  ('+ (e.league_name||'').slice(0,30)+')');
