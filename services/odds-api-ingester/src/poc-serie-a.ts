import 'dotenv/config';
import { OddsApiClient } from './api-client.js';
import { transformEvent } from './transformer.js';
import { Upserter } from './upsert.js';
import type { TransformResult } from './types.js';

const apiKey = requireEnv('ODDS_API_KEY');
const baseUrl = process.env.ODDS_API_BASE ?? 'https://api.odds-api.io/v3';
const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRole = requireEnv('SUPABASE_SERVICE_ROLE');
const bookmakers = (process.env.POC_BOOKMAKERS ?? 'Bet365').split(',').map(s => s.trim()).filter(Boolean);

const client = new OddsApiClient({ apiKey, baseUrl });
const upserter = new Upserter({ supabaseUrl, serviceRoleKey: serviceRole });

async function main() {
  const t0 = Date.now();
  console.log('[poc-serie-a] start, bookmakers:', bookmakers);

  // 1) List Serie A pending events
  const events = await client.fetchEvents({
    sport: 'football',
    league: 'italy-serie-a',
    status: 'pending',
  });
  console.log(`[poc-serie-a] /events returned ${events.length} pending`);
  logRateLimit();

  if (events.length === 0) {
    console.log('[poc-serie-a] no events, nothing to do');
    return;
  }

  // 2) For each event, fetch odds (sequential to track rate-limit budget cleanly)
  const results: TransformResult[] = [];
  let i = 0;
  let failed = 0;
  for (const e of events) {
    i++;
    try {
      const enriched = await client.fetchOdds({
        eventId: e.id,
        bookmakers,
      });
      results.push(transformEvent(enriched));
      if (i % 5 === 0) console.log(`  [${i}/${events.length}] fetched`);
    } catch (err) {
      failed++;
      console.warn(`  [${i}/${events.length}] event ${e.id} failed:`, (err as Error).message);
    }
  }
  logRateLimit();
  console.log(`[poc-serie-a] fetched ${results.length}/${events.length} successfully (${failed} failed)`);

  // 3) Upsert in batch
  const summary = await upserter.upsertBatch(results);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[poc-serie-a] done in ${dt}s`, summary);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function logRateLimit() {
  const rl = client.lastRateLimit();
  if (rl) {
    console.log(`  [rate-limit] limit=${rl.limit} remaining=${rl.remaining} reset=${rl.reset}`);
  }
}

void main().catch(err => {
  console.error('[poc-serie-a] FATAL', err);
  process.exit(1);
});
