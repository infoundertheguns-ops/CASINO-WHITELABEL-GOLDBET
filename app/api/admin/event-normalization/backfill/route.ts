export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeEvent } from '@/lib/normalize/events/engine';

// One-shot batch processor for admin or ad-hoc use.
// Iterates unmapped events and runs the full engine on each.
// Returns per-stage stats. Call repeatedly until processed === 0.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const batch_size = Math.min(2000, Math.max(1, body.batch_size ?? 500));
  const sport = body.sport ?? null;

  const sb = createAdminClient();

  // Server-side anti-join via RPC — avoids PostgREST URL-too-long on NOT IN
  const { data: events, error } = await sb.rpc('next_unmapped_events', {
    p_limit: batch_size,
    p_sport: sport,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events || events.length === 0) return NextResponse.json({ processed: 0 });

  const stats = {
    flashscore_native: 0, regex: 0, trigram: 0, alias_dict: 0,
    propagation: 0, llm: 0, manual: 0, unmapped: 0,
  };

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
      (stats as any)[r.stage]++;
    } catch (err) {
      console.error('[backfill] event', e.id, err);
    }
  }

  return NextResponse.json({ processed: events.length, stats });
}
