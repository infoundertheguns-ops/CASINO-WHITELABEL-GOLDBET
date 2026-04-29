// lib/normalize/events/propagation.ts
// Stage 4: team_mapping propagation cache.
//
// ADAPTATION from plan: be_fixtures has no team IDs, only team names.
// team_mapping maps (sport, source, raw_name) → canonical_name (lowercase).
// We resolve both raw team names to canonical, then find be_fixtures
// where lowercased home_team/away_team equal our canonicals (in the
// expected time window).

import type { EventToNormalize, MatchResult } from './types';

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function beSport(sport: string): string {
  switch (sport.toLowerCase()) {
    case 'calcio': return 'calcio';
    case 'tennis': return 'tennis';
    case 'basket': return 'basket';
    case 'pallamano': return 'pallamano';
    case 'volley': return 'volley';
    case 'hockey ghiaccio': return 'hockey';
    case 'tennis tavolo': return 'tennis_tavolo';
    case 'baseball': return 'baseball';
    case 'rugby': return 'rugby';
    case 'esports': return 'esports';
    case 'cricket': return 'cricket';
    default: return sport.toLowerCase();
  }
}

export async function matchByPropagation(
  supabase: any,
  event: EventToNormalize,
): Promise<MatchResult | null> {
  const { data: mappings } = await supabase.from('team_mapping')
    .select('raw_name, canonical_name')
    .eq('sport', event.sport)
    .eq('source', event.source)
    .in('raw_name', [event.home_team, event.away_team]);

  if (!mappings || mappings.length < 2) return null;

  const homeMap = mappings.find((m: any) => m.raw_name === event.home_team);
  const awayMap = mappings.find((m: any) => m.raw_name === event.away_team);
  if (!homeMap?.canonical_name || !awayMap?.canonical_name) return null;

  const hc = normalize(homeMap.canonical_name);
  const ac = normalize(awayMap.canonical_name);

  const ts = new Date(event.starts_at).getTime();
  const win = 3 * 60 * 60 * 1000;
  const { data: fixtures } = await supabase.from('be_fixtures')
    .select('be_match_id, home_team, away_team, match_date')
    .eq('sport', beSport(event.sport))
    .gte('match_date', new Date(ts - win).toISOString())
    .lte('match_date', new Date(ts + win).toISOString())
    .limit(50);

  if (!fixtures || fixtures.length === 0) return null;

  const match = fixtures.find((f: any) =>
    normalize(f.home_team) === hc && normalize(f.away_team) === ac
  );
  if (!match) return null;

  return {
    flashscore_id: match.be_match_id,
    stage: 'propagation',
    confidence: 1.0,
  };
}
