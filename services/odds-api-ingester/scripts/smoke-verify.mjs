import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } },
);

async function main() {
  console.log('=== events_v2 (italy-serie-a) ===');
  const { data: events, error: e1 } = await sb
    .from('events_v2')
    .select('id, odds_api_id, home, away, starts_at, status')
    .eq('league_slug', 'italy-serie-a')
    .order('starts_at', { ascending: true });
  if (e1) throw e1;
  console.log(`  count: ${events.length}`);
  events.slice(0, 5).forEach(e =>
    console.log(`    ${e.odds_api_id}  ${e.starts_at}  ${e.home} v ${e.away}`)
  );

  if (events.length === 0) {
    console.log('No events ingested yet — run `npm run poc:serie-a` first');
    process.exit(1);
  }

  console.log('');
  console.log('=== markets_v2 distribution ===');
  const eventIds = events.map(e => e.id);
  // Paginate: Supabase default cap is 1000 rows. With 15 bookmakers × ~30 markets/event
  // a single event can have 100+ market rows, so 40 events produce >1000 total.
  const markets = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error: e2 } = await sb
      .from('markets_v2')
      .select('event_id, bookmaker, market_name')
      .in('event_id', eventIds)
      .range(from, from + PAGE - 1);
    if (e2) throw e2;
    markets.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const byEvent = new Map();
  markets.forEach(m => {
    if (!byEvent.has(m.event_id)) byEvent.set(m.event_id, []);
    byEvent.get(m.event_id).push(m.market_name);
  });
  let with3plus = 0;
  let with10plus = 0;
  let totalMarkets = 0;
  for (const e of events) {
    const m = byEvent.get(e.id) || [];
    totalMarkets += m.length;
    if (m.length >= 3) with3plus++;
    if (m.length >= 10) with10plus++;
  }
  console.log(`  total markets across ${events.length} events: ${totalMarkets}`);
  console.log(`  median markets/event: ~${(totalMarkets / events.length).toFixed(1)}`);
  console.log(`  events with >=3 markets:  ${with3plus}/${events.length} (${(100 * with3plus / events.length).toFixed(1)}%)`);
  console.log(`  events with >=10 markets: ${with10plus}/${events.length} (${(100 * with10plus / events.length).toFixed(1)}%)`);

  console.log('');
  console.log('=== outcomes_v2 totals ===');
  const marketIds = markets.map(m => m.event_id); // not market id but ok for count below
  const { count: outcomeCount, error: e3 } = await sb
    .from('outcomes_v2')
    .select('*', { count: 'exact', head: true });
  if (e3) throw e3;
  console.log(`  total outcome rows: ${outcomeCount}`);
  if (markets.length > 0) {
    console.log(`  median outcomes/market: ~${(outcomeCount / markets.length).toFixed(1)}`);
  }

  console.log('');
  console.log('=== sample outcomes from first event ===');
  const firstEvent = events[0];
  const eventMarkets = markets.filter(m => m.event_id === firstEvent.id).slice(0, 5);
  const eventMarketIds = eventMarkets.map(m => m.event_id); // wrong, need market id
  const { data: firstEventMarkets } = await sb
    .from('markets_v2')
    .select('id, market_name')
    .eq('event_id', firstEvent.id);
  if (firstEventMarkets && firstEventMarkets.length > 0) {
    const sampleMids = firstEventMarkets.slice(0, 3).map(m => m.id);
    const { data: outs } = await sb
      .from('outcomes_v2')
      .select('market_id, outcome_key, line, odds')
      .in('market_id', sampleMids)
      .limit(15);
    const mNameById = new Map(firstEventMarkets.map(m => [m.id, m.market_name]));
    (outs ?? []).forEach(o => {
      const mName = mNameById.get(o.market_id);
      console.log(`    [${mName}] ${o.outcome_key}  line=${o.line ?? 'null'}  odds=${o.odds}`);
    });
  }

  // Bet365 (and other major bookmakers) open markets progressively, typically
  // 5-7 days before kickoff. Acceptance is windowed accordingly.
  const sevenDaysMs = 7 * 24 * 3600 * 1000;
  const now = Date.now();
  const imminent = events.filter(e => new Date(e.starts_at).getTime() - now < sevenDaysMs);
  let immRich3 = 0;
  let immRich10 = 0;
  for (const e of imminent) {
    const m = byEvent.get(e.id) || [];
    if (m.length >= 3) immRich3++;
    if (m.length >= 10) immRich10++;
  }

  console.log('');
  console.log(`=== ACCEPTANCE (events <7 days only — n=${imminent.length}) ===`);
  const pass3 = imminent.length === 0 ? false : immRich3 / imminent.length >= 0.95;
  const pass10 = imminent.length === 0 ? false : immRich10 / imminent.length >= 0.50;
  console.log(`  events <7d with >=3 markets:  ${immRich3}/${imminent.length} (${(100 * immRich3 / Math.max(imminent.length, 1)).toFixed(1)}%) ${pass3 ? 'PASS' : 'FAIL'}`);
  console.log(`  events <7d with >=10 markets: ${immRich10}/${imminent.length} (${(100 * immRich10 / Math.max(imminent.length, 1)).toFixed(1)}%) ${pass10 ? 'PASS' : 'FAIL'}`);
  process.exit(pass3 && pass10 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(2); });
