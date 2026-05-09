import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local','utf8');
for (const line of env.split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); }
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

const event_v2_id = '4c5889fc-cf27-4558-9238-3fd0cd87d6ef';  // basket Cividale-Rieti live
const knownTables = ['markets','odds','event_markets','event_odds','market_lines','market_outcomes','market_quotes','outcomes','quotes','consensus_snapshots','v_consensus_latest'];

console.log('=== Table existence + rows for our live event ===');
for (const t of knownTables) {
  const { error, count } = await supa.from(t).select('*',{count:'exact', head:true});
  if (error) {
    if (error.code === 'PGRST205') continue; // table not in schema
    console.log(' '+t+' :', error.message);
  } else {
    console.log(' '+t+' EXISTS, total rows:', count);
    // try filter by event_v2_id if column exists
    const { count: c2, error: e2 } = await supa.from(t).select('*',{count:'exact', head:true}).eq('event_v2_id', event_v2_id);
    if (!e2) console.log('     for our event:', c2);
  }
}
