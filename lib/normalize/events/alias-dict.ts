// lib/normalize/events/alias-dict.ts
// Stage 3b: team_aliases dictionary lookup + candidate scan.
//
// PERF FIX: previous version did 2+N DB queries per event (one per alias
// lookup). For football matches with 30+ candidates, that was 60-100
// round-trips per event → 10-15s per event. Backfill of 500 events took
// 1h+ and often timed out. Rewritten to:
//   1. Fetch ALL aliases for the sport ONCE (module cache with 5min TTL).
//   2. Fetch candidates ONCE.
//   3. Resolve in memory.

import type { EventToNormalize, MatchResult } from './types';

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function aliasSport(sport: string): string {
  switch (sport.toLowerCase()) {
    case 'calcio': return 'football';
    case 'tennis': return 'tennis';
    case 'basket': return 'basketball';
    case 'pallamano': return 'handball';
    case 'volley': return 'volleyball';
    case 'hockey ghiaccio': return 'hockey';
    case 'tennis tavolo': return 'table_tennis';
    default: return sport.toLowerCase();
  }
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

// Module-level alias cache keyed by sport tag, TTL 5 minutes.
interface AliasCacheEntry {
  map: Map<string, string>; // alias → canonical (both normalized lowercase)
  expires: number;
}
const aliasCache: Map<string, AliasCacheEntry> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadAliases(supabase: any, aliasSportTag: string): Promise<Map<string, string>> {
  const cached = aliasCache.get(aliasSportTag);
  if (cached && cached.expires > Date.now()) return cached.map;

  const map = new Map<string, string>();
  // Fetch sport-specific + sport-null (shared) aliases.
  const { data } = await supabase.from('team_aliases')
    .select('alias, canonical, sport')
    .or(`sport.eq.${aliasSportTag},sport.is.null`);

  for (const row of (data ?? []) as any[]) {
    map.set(normalize(row.alias), normalize(row.canonical));
  }
  aliasCache.set(aliasSportTag, { map, expires: Date.now() + CACHE_TTL_MS });
  return map;
}

function resolveInMemory(name: string, aliasMap: Map<string, string>): string {
  const normed = normalize(name);
  return aliasMap.get(normed) ?? normed;
}

export async function matchByAliasDict(
  supabase: any,
  event: EventToNormalize,
): Promise<MatchResult | null> {
  const aSport = aliasSport(event.sport);
  const bSport = beSport(event.sport);

  const aliasMap = await loadAliases(supabase, aSport);

  const rh = resolveInMemory(event.home_team, aliasMap);
  const ra = resolveInMemory(event.away_team, aliasMap);

  const ts = new Date(event.starts_at).getTime();
  const win = 3 * 60 * 60 * 1000;
  const { data: candidates } = await supabase.from('be_fixtures')
    .select('be_match_id, home_team, away_team, match_date')
    .eq('sport', bSport)
    .gte('match_date', new Date(ts - win).toISOString())
    .lte('match_date', new Date(ts + win).toISOString())
    .limit(50);

  if (!candidates || candidates.length === 0) return null;

  for (const c of candidates) {
    const ch = resolveInMemory(c.home_team, aliasMap);
    const ca = resolveInMemory(c.away_team, aliasMap);
    if (rh === ch && ra === ca) {
      return {
        flashscore_id: c.be_match_id,
        stage: 'alias_dict',
        confidence: 0.9,
      };
    }
  }
  return null;
}

// Test-only helper to reset cache (not used in prod).
export function __resetAliasCache(): void {
  aliasCache.clear();
}
