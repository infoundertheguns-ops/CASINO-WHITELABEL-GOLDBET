// lib/normalize/events/trigram.ts
// Stage 3a: pg_trgm similarity via match_event_by_trigram_v2 RPC.
//
// v2 (mig 118) feeds the same RPC league + country, normalizes team names
// (lower + unaccent + strip gender/reserves suffix), and returns a composite
// `score` instead of raw similarity. We read `score` and fall back to
// `similarity` for backward compat.

import type { EventToNormalize, MatchResult } from './types';

const TRIGRAM_THRESHOLD = 0.7;

export async function matchByTrigram(
  supabase: any,
  event: EventToNormalize,
): Promise<MatchResult | null> {
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
  if (error || !data || !Array.isArray(data) || data.length === 0) return null;
  const top = data[0];
  const raw = top.score ?? top.similarity;
  const sim = Number(raw);
  if (!Number.isFinite(sim) || sim < TRIGRAM_THRESHOLD) return null;
  return {
    flashscore_id: top.flashscore_id,
    stage: 'trigram',
    confidence: Math.min(1, sim),
  };
}
