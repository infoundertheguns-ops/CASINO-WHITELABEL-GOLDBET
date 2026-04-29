// lib/normalize/events/engine.ts
// 5-stage event-normalization dispatcher.
//
// Order: flashscore_native → regex → trigram → alias_dict → propagation → (stage 5 LLM offline).
// Auto-applies a stage if confidence >= AUTO_APPLY_THRESHOLDS[stage], else
// collects partial results and persists the best one >= 0.5 for manual review.
// Stage 5 (LLM) is NOT auto-triggered here — invoked by run-subagent or Haiku path.

import type {
  EventToNormalize,
  FlashscoreCandidate,
  MatchResult,
} from './types';
import { AUTO_APPLY_THRESHOLDS, PENDING_REVIEW_MIN, shouldAutoVerify } from './types';
import { matchByRegex } from './regex';
import { matchByTrigram } from './trigram';
import { matchByAliasDict } from './alias-dict';
import { matchByPropagation } from './propagation';

// fetchCandidates v2 (Sprint 2 Autopilot): drives candidate selection through
// match_event_by_trigram_v2 instead of pulling 50 random fixtures in ±3h. The
// RPC normalises names, applies league/country boost and gender/reserves
// penalty, and returns the top 10 ranked candidates inside a 12h window.
//
// Rationale: regex/alias_dict/LLM stages all need *plausible* candidates as
// input. The previous random sample missed ~50% of true matches whenever the
// fixture density in ±3h exceeded 50 events.
export async function fetchCandidates(
  supabase: any,
  event: EventToNormalize,
): Promise<FlashscoreCandidate[]> {
  const { data, error } = await supabase.rpc('match_event_by_trigram_v2', {
    p_sport: event.sport,
    p_home: event.home_team,
    p_away: event.away_team,
    p_starts_at: event.starts_at,
    p_league: event.league ?? null,
    p_country: event.country ?? null,
    p_window_hours: 12,
    p_limit: 10,
  });
  if (error || !data || !Array.isArray(data)) return [];
  return (data as any[]).map((r) => ({
    flashscore_id: r.flashscore_id,
    home_team: r.home_team,
    away_team: r.away_team,
    starts_at: r.starts_at,
    sport: event.sport, // RPC filtered by sport already; we keep the input for downstream consistency
    league: r.league ?? null,
    country: r.country ?? null,
    score: typeof r.score === 'number' ? r.score : Number(r.score ?? r.similarity ?? 0),
  })) as FlashscoreCandidate[];
}

async function persistMatch(
  supabase: any,
  event: EventToNormalize,
  r: MatchResult,
): Promise<void> {
  // Persist ALL outcomes including 'unmapped' (as negative cache).
  // The DB constraint allows NULL flashscore_id when stage='unmapped'.
  //
  // NOTE: `verified` is intentionally NOT in this upsert payload — that would
  // overwrite operator confirmations on rerun (regression caught in wave-33
  // night session). Auto-verify is applied via a separate UPDATE below that
  // only flips false→true (never true→false).
  await supabase.from('event_normalization').upsert(
    {
      event_id: event.id,
      flashscore_id: r.flashscore_id,
      match_stage: r.stage,
      confidence: r.confidence,
      llm_reason: r.llm_reason ?? null,
      llm_verify: r.llm_verify ?? null,
    },
    { onConflict: 'event_id' },
  );
  // Propagate high-confidence match to events.flashscore_id
  if (r.flashscore_id && r.confidence >= 0.95) {
    await supabase.from('events')
      .update({ flashscore_id: r.flashscore_id })
      .eq('id', event.id);
  }
  // Auto-verify gate (combines AUTO_VERIFY_THRESHOLDS + LLM dual gate).
  // Separate UPDATE preserves operator confirmations: we only flip rows
  // currently at verified=false → true. verified_by=NULL marks "system".
  if (shouldAutoVerify(r)) {
    await supabase.from('event_normalization')
      .update({
        verified: true,
        verified_at: new Date().toISOString(),
        verified_by: null,
      })
      .eq('event_id', event.id)
      .eq('verified', false);
  }
}

export async function normalizeEvent(
  supabase: any,
  event: EventToNormalize,
): Promise<MatchResult> {
  if (event.flashscore_id) {
    const r: MatchResult = {
      flashscore_id: event.flashscore_id,
      stage: 'flashscore_native',
      confidence: 1.0,
    };
    await persistMatch(supabase, event, r);
    return r;
  }

  const candidates = await fetchCandidates(supabase, event);

  const r2 = await matchByRegex(event, candidates);
  if (r2 && r2.confidence >= AUTO_APPLY_THRESHOLDS.regex) {
    await persistMatch(supabase, event, r2);
    return r2;
  }

  const r3a = await matchByTrigram(supabase, event);
  if (r3a && r3a.confidence >= AUTO_APPLY_THRESHOLDS.trigram) {
    await persistMatch(supabase, event, r3a);
    return r3a;
  }

  const r3b = await matchByAliasDict(supabase, event);
  if (r3b && r3b.confidence >= AUTO_APPLY_THRESHOLDS.alias_dict) {
    await persistMatch(supabase, event, r3b);
    return r3b;
  }

  const r4 = await matchByPropagation(supabase, event);
  if (r4 && r4.confidence >= AUTO_APPLY_THRESHOLDS.propagation) {
    await persistMatch(supabase, event, r4);
    return r4;
  }

  // Best partial result for pending review (>= PENDING_REVIEW_MIN)
  const partials = [r2, r3a, r3b, r4].filter(
    (r): r is MatchResult => !!r && r.confidence >= PENDING_REVIEW_MIN,
  );
  if (partials.length) {
    const best = partials.sort((a, b) => b.confidence - a.confidence)[0];
    await persistMatch(supabase, event, best);
    return best;
  }

  const unmapped: MatchResult = { flashscore_id: null, stage: 'unmapped', confidence: 0 };
  await persistMatch(supabase, event, unmapped);

  // Stage 6 (Sprint 3 Phase A): cross-source synthetic canonical_id.
  // For events that exited the pipeline as 'unmapped' (no flashscore match),
  // try linking them to existing cross-source siblings via team-name + time
  // similarity. Does NOT change match_stage (still 'unmapped' for Flashscore)
  // but populates events.canonical_id so the consensus + canonicalization UI
  // surface them as 🟣 cross_source instead of "Single source only".
  //
  // Errors are intentionally swallowed: this is an opportunistic enrichment,
  // not a load-bearing step in the normalization pipeline.
  //
  // TODO: integrate to scraper push pipeline (kambi-scraper /
  // 22bet-scraper / betfair-scraper) so freshly-ingested events get linked
  // before the next engine run.
  try {
    await supabase.rpc('assign_event_cross_source_canonical_id', {
      p_event_id: event.id,
    });
  } catch (err) {
    // Swallow — Stage 6 is best-effort.
    console.error('[normalize] stage6 cross-source assign failed', event.id, err);
  }

  // Stage 7 (Sprint 3 Phase B): structural source-only classifier.
  // For events that exited as 'unmapped' AND were not rescued by Stage 6
  // (still no canonical_id), apply rule-based classifier to flag those
  // structurally not-in-Flashscore (Setka Cup, Esports Battle, Alternative
  // Matches, Combatsport, etc.). Updates events.is_source_only=true.
  // Excludes them from the L3 "coverage tra mappabili" denominator.
  //
  // Best-effort like Stage 6 — errors swallowed. Idempotent.
  try {
    await supabase.rpc('classify_event_source_only', {
      p_event_id: event.id,
    });
  } catch (err) {
    console.error('[normalize] stage7 source-only classify failed', event.id, err);
  }

  return unmapped;
}
