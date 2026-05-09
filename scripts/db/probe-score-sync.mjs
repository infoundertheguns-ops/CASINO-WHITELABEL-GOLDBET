import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const { data: live } = await supa.from('events_v2').select('id, sport_slug, home, away, score_home, score_away, live_data').eq('status','live').not('flashscore_id','is',null).limit(100);

console.log('=== Live events check (top-level score vs live_data) ===');
const buckets = { bothNull_arrEmpty:0, bothNull_arrPopulated:0, syncNeeded:0, alreadySynced:0, syncedDiff:0, totalLive: live?.length||0 };

const samples = { bothNull_arrPopulated: [], syncedDiff: [] };
for (const ev of live ?? []) {
  const arr = ev.live_data?.halfScoreHome;
  const hasArr = Array.isArray(arr) && arr.length > 0;
  const arrSum = hasArr ? arr.reduce((s,n)=>s+(n||0),0) : null;
  const topNull = ev.score_home == null;
  
  if (topNull && !hasArr) buckets.bothNull_arrEmpty++;
  else if (topNull && hasArr) {
    buckets.bothNull_arrPopulated++;
    if (samples.bothNull_arrPopulated.length < 8) samples.bothNull_arrPopulated.push({sport:ev.sport_slug, home:ev.home, away:ev.away, arrH:arr, arrA:ev.live_data.halfScoreAway, sum:arrSum});
  }
  else if (!topNull && hasArr) {
    if (ev.score_home === arrSum) buckets.alreadySynced++;
    else {
      buckets.syncedDiff++;
      if (samples.syncedDiff.length < 5) samples.syncedDiff.push({sport:ev.sport_slug, home:ev.home, top:[ev.score_home,ev.score_away], arr:[arr, ev.live_data.halfScoreAway], sum:[arrSum]});
    }
  }
  else if (!topNull && !hasArr) {/* fine, score-only sport */}
}

console.log(JSON.stringify(buckets, null, 2));
console.log('\n=== Sample bothNull_arrPopulated ===');
for (const s of samples.bothNull_arrPopulated) console.log('  ['+s.sport+'] '+s.home+' arrH='+JSON.stringify(s.arrH)+' arrA='+JSON.stringify(s.arrA)+'  sum='+s.sum);
console.log('\n=== Sample syncedDiff (top != sum) ===');
for (const s of samples.syncedDiff) console.log('  ['+s.sport+'] '+s.home+' top='+JSON.stringify(s.top)+' arr='+JSON.stringify(s.arr));

// per-sport breakdown
const bySport = {};
for (const ev of live ?? []) {
  const sp = ev.sport_slug;
  bySport[sp] = bySport[sp] || { total:0, topNull:0, arrPopulated:0, syncedSum:0 };
  bySport[sp].total++;
  const arr = ev.live_data?.halfScoreHome;
  const hasArr = Array.isArray(arr) && arr.length > 0;
  if (ev.score_home == null) bySport[sp].topNull++;
  if (hasArr) bySport[sp].arrPopulated++;
  if (hasArr && ev.score_home === arr.reduce((s,n)=>s+(n||0),0)) bySport[sp].syncedSum++;
}
console.log('\n=== Per-sport breakdown ===');
for (const [s, b] of Object.entries(bySport).sort((a,b)=>b[1].total-a[1].total)) console.log('  '+s.padEnd(15)+' total='+b.total+' topNull='+b.topNull+' arrPopulated='+b.arrPopulated+' syncedAsSum='+b.syncedSum);
