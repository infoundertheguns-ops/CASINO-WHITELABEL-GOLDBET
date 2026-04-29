export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { buildPrompt } from '@/lib/normalize/events/llm-core';
import { fetchCandidates } from '@/lib/normalize/events/engine';

// Returns a batch of prompts for an operator to paste into Claude Code / Task
// subagent. Operator collects JSON responses, then POSTs back to
// /api/admin/event-normalization with action=llm-submit.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const batch_size = Math.min(50, Math.max(1, body.batch_size ?? 20));
  const sport = body.sport ?? null;

  const sb = createAdminClient();

  // Server-side anti-join via RPC — but we want events that have no row at all
  // OR have an 'unmapped' stage row (to retry after catalog growth).
  const { data: events, error } = await sb.rpc('next_unmapped_events', {
    p_limit: batch_size,
    p_sport: sport,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events || events.length === 0) {
    return NextResponse.json({ count: 0, prompts: [], message: 'no unmapped events' });
  }

  const prompts = await Promise.all((events as any[]).map(async (e) => {
    const eventShape = {
      id: e.id, source: e.source as any, sport: e.sport_name, league: null,
      home_team: e.home_team, away_team: e.away_team,
      starts_at: e.starts_at, flashscore_id: null,
    };
    const candidates = await fetchCandidates(sb, eventShape);
    return {
      event_id: e.id,
      event_label: `${e.home_team} vs ${e.away_team} (${e.sports.name}, ${e.starts_at})`,
      candidate_count: candidates.length,
      prompt: buildPrompt({ event: eventShape, candidates: candidates.slice(0, 5) }),
    };
  }));

  return NextResponse.json({
    count: prompts.length,
    prompts,
    instructions:
      'For each prompt, dispatch a Claude Code Task subagent (subagent_type=general-purpose). ' +
      'Collect the JSON responses (flashscore_id, confidence, reason). ' +
      'POST the aggregated batch to /api/admin/event-normalization with action=llm-submit and results=[{event_id, flashscore_id, confidence, reason}, ...].',
  });
}
