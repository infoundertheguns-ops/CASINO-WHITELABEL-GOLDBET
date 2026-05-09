import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// Sample any 3 markets
const { data: m } = await supa.from('markets').select('*').limit(3);
console.log('=== sample 3 markets ===');
for (const r of m ?? []) console.log('id='+r.id+' event_id='+r.event_id+' name='+r.name+' market_type='+r.market_type+' line='+r.line+' active='+r.is_active+' updated_at='+r.updated_at);

// Trace event_id
if (m?.[0]) {
  console.log('\n=== events_v2 lookup for market.event_id =', m[0].event_id, '===');
  const { data: ev } = await supa.from('events_v2').select('id, home, away, sport_slug').eq('id', m[0].event_id).maybeSingle();
  console.log(' found?', !!ev);
  if (ev) console.log(' event:', ev.home, 'vs', ev.away, '('+ev.sport_slug+')');
  
  // Also try legacy events
  const { data: ev2 } = await supa.from('events').select('id, home_team, away_team, sport_slug').eq('id', m[0].event_id).maybeSingle();
  console.log(' legacy events.id match?', !!ev2);
  if (ev2) console.log(' legacy:', ev2.home_team, 'vs', ev2.away_team);
}

// Sample 3 outcomes
const { data: o } = await supa.from('outcomes').select('*').limit(3);
console.log('\n=== sample 3 outcomes ===');
for (const x of o ?? []) console.log('id='+x.id+' market_id='+x.market_id+' name='+x.name+' odds='+x.odds+' previous='+x.previous_odds+' prob='+x.probability+' active='+x.is_active);
