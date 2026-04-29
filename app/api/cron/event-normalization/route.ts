export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeEvent } from '@/lib/normalize/events/engine';

// Scheduled drainage endpoint, called every 15 min by scraper-vps cron.
// Batch-limited to keep request short-lived. Auth via x-scraper-key.

const BATCH = 100;

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-scraper-key');
  if (!process.env.SCRAPER_API_KEY || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = createAdminClient();

  const { data: events } = await sb.rpc('next_unmapped_events', { p_limit: BATCH, p_sport: null });
  if (!events || events.length === 0) {
    return NextResponse.json({ processed: 0, matched: 0 });
  }

  let matched = 0;
  for (const e of events as any[]) {
    try {
      const r = await normalizeEvent(sb, {
        id: e.id, source: e.source, sport: e.sport_name,
        league: e.league_name ?? null,
        country: e.country_name ?? null,
        home_team: e.home_team, away_team: e.away_team,
        starts_at: e.starts_at,
        flashscore_id: e.flashscore_id ?? null,
      });
      if (r.stage !== 'unmapped') matched++;
    } catch (err) {
      console.error('[cron/event-normalization]', e.id, err);
    }
  }

  return NextResponse.json({ processed: events.length, matched });
}
