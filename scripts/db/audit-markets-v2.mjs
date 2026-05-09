import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const odds_api_id = 63303345;  // MLB Cincinnati-Houston

// legacy events table
console.log('=== legacy events row by external_id ===');
const { data: leg } = await supa.from('events').select('*').eq('external_id', 'odds-api:'+odds_api_id).maybeSingle();
if (leg) {
  console.log(' columns:', Object.keys(leg).join(', '));
  console.log(' data:', JSON.stringify({id:leg.id, external_id:leg.external_id, sport_slug:leg.sport_slug, home_team:leg.home_team, away_team:leg.away_team, starts_at:leg.starts_at, status:leg.status, flashscore_id:leg.flashscore_id, sofascore_id:leg.sofascore_id, canonical_id: leg.canonical_id}));
} else {
  console.log(' (no legacy row)');
}

// markets using events.id
if (leg) {
  console.log('\n=== markets for this event (legacy events.id) ===');
  const { data: markets, count } = await supa.from('markets').select('id, name, slug, market_type, line, is_active', {count:'exact'}).eq('event_id', leg.id);
  console.log(' total:', count);
  for (const m of (markets ?? []).slice(0,20)) console.log('  '+m.name+' / type='+m.market_type+(m.line!=null?' line='+m.line:'')+' active='+m.is_active);
  
  if (markets?.length) {
    console.log('\n=== outcomes for first market (' + markets[0].name + ') ===');
    const { data: outs } = await supa.from('outcomes').select('*').eq('market_id', markets[0].id).limit(10);
    for (const o of outs ?? []) console.log('  '+o.name+' odds='+o.odds+' prev='+o.previous_odds+' prob='+o.probability+' active='+o.is_active);
  }
}

// Also check basketball live event
console.log('\n\n=== Markets count for basketball live event Cividale-Rieti ===');
const { data: leg2 } = await supa.from('events').select('id, external_id').eq('flashscore_id', 'fXiVN4Ii').maybeSingle();
if (leg2) {
  const { count } = await supa.from('markets').select('*',{count:'exact', head:true}).eq('event_id', leg2.id);
  console.log(' legacy event id:', leg2.id, 'external_id:', leg2.external_id, 'markets:', count);
} else console.log(' (no legacy row by FS id)');
