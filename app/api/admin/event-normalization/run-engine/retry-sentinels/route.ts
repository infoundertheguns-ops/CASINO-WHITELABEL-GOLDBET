export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchCandidates } from '@/lib/normalize/events/engine';
import { buildPrompt, parseResponse, toMatchResult } from '@/lib/normalize/events/llm-core';
import type { EventToNormalize } from '@/lib/normalize/events/types';

// Event Normalization — retry LLM on sentinel rows (match_stage='unmapped').
//
// The regular run-engine relies on `next_unmapped_events` which excludes rows
// already in event_normalization (to prevent pointless retries). That's good
// for stages 1-4, but it means once a row is stamped 'unmapped' it can never
// get a second LLM pass even if LLM was previously unavailable or the prompt
// has since improved.
//
// This endpoint targets exactly those rows, with safety filters to avoid
// burning tokens on unmappable placeholders:
//   - only rows created within the last `max_age_days` (default 7)
//   - skip home_team IN ('Home', 'Home (Special bets)') — 22bet placeholder
//   - skip home_team ending in ' +' — 22bet combined-team synthetic events
//
// Auth: x-cron-key header OR any admin-cookie GET caller via same pattern as
// run-engine (source='sentinel_retry_auto' or 'sentinel_retry_manual').

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MODEL_WHITELIST: Record<string, true> = {
  'claude-haiku-4-5-20251001': true,
  'claude-sonnet-4-6': true,
  'claude-opus-4-7': true,
};

export async function POST(req: NextRequest) {
  const cronKey = req.headers.get('x-cron-key');
  const isCron = cronKey && cronKey === process.env.CRON_SECRET;

  const body = await req.json().catch(() => ({}));
  const batch_size = Math.min(500, Math.max(1, body.batch_size ?? 100));
  const llm_budget = Math.min(200, Math.max(1, body.llm_budget ?? 50));
  const llm_min_confidence = Math.max(0, Math.min(1, body.llm_min_confidence ?? 0.5));
  const max_age_days = Math.min(90, Math.max(1, body.max_age_days ?? 7));
  const sport = body.sport ?? null;
  const model = (typeof body.model === 'string' && MODEL_WHITELIST[body.model]) ? body.model : DEFAULT_MODEL;
  const source = isCron ? 'sentinel_retry_auto' : 'sentinel_retry_manual';
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  const sb = createAdminClient();
  const t0 = Date.now();

  if (!apiKey) {
    await logRun(sb, source, 0, 0, 0, 0, 0, Date.now() - t0, 'ANTHROPIC_API_KEY missing');
    return NextResponse.json({
      error: 'ANTHROPIC_API_KEY missing in env',
      skipped: true,
    }, { status: 503 });
  }

  // Fetch sentinel rows — those stamped 'unmapped' stage still eligible for retry.
  // We join through events to get the fields needed by fetchCandidates/buildPrompt.
  const sinceIso = new Date(Date.now() - max_age_days * 24 * 3600 * 1000).toISOString();

  let q = sb
    .from('event_normalization')
    .select(
      'id, event_id, created_at, events!inner(id, source, home_team, away_team, starts_at, sport_id, league_id, flashscore_id, status, sports!inner(name))'
    )
    .eq('match_stage', 'unmapped')
    .gte('created_at', sinceIso)
    .in('events.status', ['prematch', 'live'])
    .order('created_at', { ascending: false })
    .limit(batch_size);

  if (sport) q = q.eq('events.sports.name', sport);

  const { data: rows, error } = await q;
  if (error) {
    await logRun(sb, source, 0, 0, 0, 0, 0, Date.now() - t0, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Apply placeholder filters client-side (simpler than Postgres regex).
  // Supabase typed-select infers `events!inner` as an array in TS even though
  // at runtime it's a single object — cast through `any` to use the fields.
  const candidates = ((rows ?? []) as any[]).filter((r: any) => {
    const h = r.events?.home_team ?? '';
    if (h === 'Home' || h === 'Home (Special bets)') return false;
    if (h.endsWith(' +')) return false;
    return true;
  });

  if (candidates.length === 0) {
    await logRun(sb, source, rows?.length ?? 0, 0, 0, 0, 0, Date.now() - t0, null);
    return NextResponse.json({
      processed: rows?.length ?? 0,
      eligible: 0,
      matched: 0,
      note: 'no eligible sentinel rows (all filtered as placeholder or none in window)',
      took_ms: Date.now() - t0,
    });
  }

  const toProcess = candidates.slice(0, llm_budget);
  let used = 0, matched = 0, errors = 0;
  let inputTok = 0, outputTok = 0, cacheTok = 0;

  for (const rawRow of toProcess) {
    used++;
    const row = rawRow as any;
    const ev: EventToNormalize = {
      id: row.events.id,
      source: row.events.source,
      sport: row.events.sports?.name ?? '',
      league: null,
      country: null,
      home_team: row.events.home_team,
      away_team: row.events.away_team,
      starts_at: row.events.starts_at,
      flashscore_id: row.events.flashscore_id ?? null,
    };
    try {
      const cand = await fetchCandidates(sb, ev);
      if (cand.length === 0) continue;
      const prompt = buildPrompt({ event: ev, candidates: cand });
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) { errors++; continue; }
      const resp: any = await res.json();
      inputTok += resp?.usage?.input_tokens ?? 0;
      outputTok += resp?.usage?.output_tokens ?? 0;
      cacheTok += resp?.usage?.cache_read_input_tokens ?? 0;

      const content: string = resp?.content?.[0]?.text ?? '';
      const parsed = parseResponse(content);
      const mr = toMatchResult(parsed);
      if (!mr) continue;
      if (mr.confidence < llm_min_confidence) continue;

      // Upsert — replaces the 'unmapped' stage with 'llm'.
      await sb.from('event_normalization').upsert(
        {
          event_id: ev.id,
          flashscore_id: mr.flashscore_id,
          match_stage: 'llm',
          confidence: mr.confidence,
          llm_reason: mr.llm_reason ?? null,
        },
        { onConflict: 'event_id' },
      );
      if (mr.flashscore_id && mr.confidence >= 0.95) {
        await sb.from('events').update({ flashscore_id: mr.flashscore_id }).eq('id', ev.id);
      }
      matched++;
    } catch {
      errors++;
    }
  }

  await logRun(
    sb, source,
    candidates.length, matched, used, inputTok, outputTok,
    Date.now() - t0, null,
  );

  return NextResponse.json({
    processed: rows?.length ?? 0,
    eligible: candidates.length,
    attempted: used,
    matched,
    errors,
    model,
    input_tokens: inputTok,
    output_tokens: outputTok,
    cache_read_tokens: cacheTok,
    took_ms: Date.now() - t0,
  });
}

async function logRun(
  sb: any,
  source: string,
  processed: number,
  matched: number,
  llm_used: number,
  llm_input_tokens: number,
  llm_output_tokens: number,
  duration_ms: number,
  error: string | null,
) {
  try {
    await sb.from('event_normalization_runs').insert({
      source, processed, matched, llm_used,
      llm_input_tokens, llm_output_tokens, duration_ms,
      error, stats: {},
    });
  } catch (e) {
    console.error('[retry-sentinels] failed to log run', e);
  }
}
