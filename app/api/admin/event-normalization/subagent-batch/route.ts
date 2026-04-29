export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchCandidates } from '@/lib/normalize/events/engine';
import { buildPrompt } from '@/lib/normalize/events/llm-core';
import type { EventToNormalize } from '@/lib/normalize/events/types';

// POST /api/admin/event-normalization/subagent-batch
//
// Prepares a batch of unmapped events with their Flashscore candidates, ready
// to be fed to a Claude Code subagent in the operator's session. The subagent
// responds with an array of { event_id, flashscore_id, confidence, reason }
// that the operator POSTs back via the main route's `llm-submit` action.
//
// This path avoids the metered Anthropic API entirely — we exploit the
// Claude Code session the operator is already paying for.
//
// Scope options (body):
//   - source: 'unmapped'   → events not yet in event_normalization (default)
//   - source: 'sentinels'  → rows with match_stage='unmapped' (retry path)
//   - batch_size: 1..200 (default 30)
//   - sport: optional filter
//   - max_age_days: for sentinels, default 7
//
// Returns: { prompts: [{ event_id, prompt, candidates_count }], summary }

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mode = body.source === 'sentinels' ? 'sentinels' : 'unmapped';
  const batch_size = Math.min(200, Math.max(1, body.batch_size ?? 30));
  const sport = body.sport ?? null;
  const max_age_days = Math.min(90, Math.max(1, body.max_age_days ?? 7));

  const sb = createAdminClient();

  let events: EventToNormalize[] = [];

  if (mode === 'unmapped') {
    const { data, error } = await sb.rpc('next_unmapped_events', {
      p_limit: batch_size,
      p_sport: sport,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    events = (data ?? []).map((e: any) => ({
      id: e.id,
      source: e.source,
      sport: e.sport_name,
      league: e.league_name ?? null,
      country: e.country_name ?? null,
      home_team: e.home_team,
      away_team: e.away_team,
      starts_at: e.starts_at,
      flashscore_id: e.flashscore_id ?? null,
    }));
  } else {
    const sinceIso = new Date(Date.now() - max_age_days * 24 * 3600 * 1000).toISOString();
    let q = sb
      .from('event_normalization')
      .select(
        'event_id, events!inner(id, source, home_team, away_team, starts_at, flashscore_id, status, sports!inner(name))'
      )
      .eq('match_stage', 'unmapped')
      .gte('created_at', sinceIso)
      .in('events.status', ['prematch', 'live'])
      .order('created_at', { ascending: false })
      .limit(batch_size);
    if (sport) q = q.eq('events.sports.name', sport);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    events = ((data ?? []) as any[])
      .filter((r: any) => {
        const h = r.events?.home_team ?? '';
        if (h === 'Home' || h === 'Home (Special bets)') return false;
        if (h.endsWith(' +')) return false;
        return true;
      })
      .map((r: any) => ({
        id: r.events.id,
        source: r.events.source,
        sport: r.events.sports?.name ?? '',
        league: null,
        country: null,
        home_team: r.events.home_team,
        away_team: r.events.away_team,
        starts_at: r.events.starts_at,
        flashscore_id: r.events.flashscore_id ?? null,
      }));
  }

  if (events.length === 0) {
    return NextResponse.json({ prompts: [], summary: { mode, count: 0 } });
  }

  // Build prompts in parallel (candidate fetches hit trigram RPC — cheap enough).
  const prompts = await Promise.all(events.map(async (ev) => {
    try {
      const cand = await fetchCandidates(sb, ev);
      return {
        event_id: ev.id,
        event_label: `${ev.home_team} vs ${ev.away_team} (${ev.sport}, ${ev.starts_at})`,
        candidates_count: cand.length,
        prompt: cand.length ? buildPrompt({ event: ev, candidates: cand }) : null,
      };
    } catch (e: any) {
      return {
        event_id: ev.id,
        event_label: `${ev.home_team} vs ${ev.away_team}`,
        candidates_count: 0,
        prompt: null,
        error: e.message,
      };
    }
  }));

  const withCands = prompts.filter((p) => p.prompt).length;
  return NextResponse.json({
    prompts,
    summary: {
      mode,
      requested: batch_size,
      returned: events.length,
      with_candidates: withCands,
      without_candidates: events.length - withCands,
    },
    instructions: [
      'Each item has a standalone LLM prompt ready to be matched.',
      'Feed each prompt to a subagent; the subagent should return JSON: { flashscore_id, confidence, reason }.',
      'Collect results and POST to /api/admin/event-normalization with body:',
      '  { action: "llm-submit", results: [{ event_id, flashscore_id, confidence, reason }, ...] }',
      'confidence >= 0.95 auto-verifies and writes events.flashscore_id.',
    ],
  });
}
