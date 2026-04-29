export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizeEvent, fetchCandidates } from '@/lib/normalize/events/engine';
import { buildPrompt, parseResponse, toMatchResult } from '@/lib/normalize/events/llm-core';
import type { EventToNormalize } from '@/lib/normalize/events/types';

// E1.F2b — Event Normalization unified engine endpoint.
//
// Runs stages 1-4 (flashscore_native → regex → trigram → alias_dict → propagation)
// via normalizeEvent on up to `batch_size` unmapped events.
//
// Optionally runs stage 5 (LLM) in-process on the events that stages 1-4 left
// unmapped. Requires ANTHROPIC_API_KEY in env. If missing, LLM stage is skipped
// with a warning in the response.
//
// POST body: { batch_size?: number, sport?: string, use_llm?: boolean,
//              llm_budget?: number, llm_min_confidence?: number,
//              source?: 'auto'|'manual' (used for run logging, default 'manual') }
//
// Auth: either authenticated admin cookie (manual UI) OR `x-cron-key` header
// matching CRON_SECRET (auto cron). Cron calls should set source='auto'.

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
  const batch_size = Math.min(2000, Math.max(1, body.batch_size ?? 500));
  const sport = body.sport ?? null;
  const use_llm = !!body.use_llm;
  const llm_budget = Math.min(200, Math.max(1, body.llm_budget ?? 30));
  const llm_min_confidence = Math.max(0, Math.min(1, body.llm_min_confidence ?? 0.5));
  const model = (typeof body.model === 'string' && MODEL_WHITELIST[body.model]) ? body.model : DEFAULT_MODEL;
  // Review #4 P1-D: only x-cron-key callers can label themselves 'auto'.
  // Pre-fix, body.source='auto' from any authenticated caller would pollute
  // the SLA freshness monitor.
  const source = isCron ? 'auto' : 'manual';
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  const sb = createAdminClient();
  const t0 = Date.now();

  const { data: events, error } = await sb.rpc('next_unmapped_events', {
    p_limit: batch_size,
    p_sport: sport,
  });
  if (error) {
    await logRun(sb, source, 0, 0, 0, 0, 0, Date.now() - t0, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!events || events.length === 0) {
    await logRun(sb, source, 0, 0, 0, 0, 0, Date.now() - t0, null);
    return NextResponse.json({ processed: 0, took_ms: Date.now() - t0, use_llm, note: 'no unmapped events' });
  }

  const stats = {
    flashscore_native: 0, regex: 0, trigram: 0, alias_dict: 0,
    propagation: 0, llm: 0, manual: 0, unmapped: 0,
  };

  const leftoverForLlm: { ev: EventToNormalize; candidates: Awaited<ReturnType<typeof fetchCandidates>> }[] = [];

  for (const e of events as any[]) {
    const ev: EventToNormalize = {
      id: e.id, source: e.source, sport: e.sport_name,
      league: e.league_name ?? null,
      country: e.country_name ?? null,
      home_team: e.home_team, away_team: e.away_team,
      starts_at: e.starts_at,
      flashscore_id: e.flashscore_id ?? null,
    };
    try {
      const r = await normalizeEvent(sb, ev);
      (stats as any)[r.stage]++;
      if (use_llm && apiKey && r.stage === 'unmapped') {
        const candidates = await fetchCandidates(sb, ev);
        if (candidates.length > 0) leftoverForLlm.push({ ev, candidates });
      }
    } catch (err) {
      console.error('[run-engine] event', e.id, err);
    }
  }

  let llmSummary: any = undefined;
  let llmUsed = 0, llmInput = 0, llmOutput = 0;
  if (use_llm) {
    if (!apiKey) {
      llmSummary = { skipped: true, reason: 'ANTHROPIC_API_KEY missing in env' };
    } else if (leftoverForLlm.length === 0) {
      llmSummary = { skipped: true, reason: 'no events to LLM-match' };
    } else {
      const toProcess = leftoverForLlm.slice(0, llm_budget);
      let used = 0, matched = 0, errors = 0;
      let inputTok = 0, outputTok = 0, cacheTok = 0;

      for (const item of toProcess) {
        used++;
        try {
          const prompt = buildPrompt({ event: item.ev, candidates: item.candidates });
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
          const body: any = await res.json();
          inputTok += body?.usage?.input_tokens ?? 0;
          outputTok += body?.usage?.output_tokens ?? 0;
          cacheTok += body?.usage?.cache_read_input_tokens ?? 0;

          const content: string = body?.content?.[0]?.text ?? '';
          const parsed = parseResponse(content);

          // Mig 121 — alias proposal is independent from match success.
          // Insert as pending (verified=false) for operator triage. The
          // partial unique index allows multiple unverified rows for the
          // same (sport, alias) so duplicate proposals coexist until one
          // is approved. Operator-side dedup happens in the UI.
          if (parsed?.propose_alias && parsed.propose_alias.alias && parsed.propose_alias.canonical) {
            const sportLower = (item.ev.sport ?? '').toLowerCase().trim();
            await sb.from('team_aliases').insert({
              alias: parsed.propose_alias.alias,
              canonical: parsed.propose_alias.canonical,
              sport: sportLower || null,
              source: 'llm',
              verified: false,
              proposed_for_event_id: item.ev.id,
              llm_reason: parsed.reason ?? null,
            }).select().maybeSingle().then(() => {/* swallow duplicate-proposal errors */}, () => {/* unique-violation OK */});
          }

          const mr = toMatchResult(parsed);
          if (!mr) continue;
          if (mr.confidence < llm_min_confidence) continue;

          await sb.from('event_normalization').upsert(
            {
              event_id: item.ev.id,
              flashscore_id: mr.flashscore_id,
              match_stage: 'llm',
              confidence: mr.confidence,
              llm_reason: mr.llm_reason ?? null,
              llm_verify: mr.llm_verify ?? null,
            },
            { onConflict: 'event_id' },
          );
          if (mr.flashscore_id && mr.confidence >= 0.95) {
            await sb.from('events').update({ flashscore_id: mr.flashscore_id }).eq('id', item.ev.id);
            // Mig 121 — auto-verify gate: LLM dual gate enforced by engine
            // when run inline. Here in the API we replicate the rule: only
            // flip verified=true when llm_verify=true.
            if (mr.llm_verify === true) {
              await sb.from('event_normalization')
                .update({ verified: true, verified_at: new Date().toISOString(), verified_by: null })
                .eq('event_id', item.ev.id)
                .eq('verified', false);
            }
          }
          matched++;
          stats.llm++;
          stats.unmapped = Math.max(0, stats.unmapped - 1);
        } catch {
          errors++;
        }
      }

      llmUsed = used;
      llmInput = inputTok;
      llmOutput = outputTok;
      llmSummary = {
        skipped: false,
        batches_used: used,
        batches_budget: llm_budget,
        matched,
        errors,
        input_tokens: inputTok,
        output_tokens: outputTok,
        cache_read_tokens: cacheTok,
      };
    }
  }

  const matchedTotal = stats.flashscore_native + stats.regex + stats.trigram +
    stats.alias_dict + stats.propagation + stats.llm + stats.manual;

  await logRun(
    sb, source,
    events.length, matchedTotal, llmUsed, llmInput, llmOutput,
    Date.now() - t0, null,
    { ...stats, _meta: { model: use_llm ? model : null } },
  );

  return NextResponse.json({
    processed: events.length,
    stats,
    use_llm,
    model: use_llm ? model : null,
    llm: llmSummary,
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
  stats?: any,
) {
  try {
    await sb.from('event_normalization_runs').insert({
      source, processed, matched, llm_used,
      llm_input_tokens, llm_output_tokens, duration_ms,
      error, stats: stats ?? {},
    });
  } catch (e) {
    console.error('[run-engine] failed to log run', e);
  }
}
