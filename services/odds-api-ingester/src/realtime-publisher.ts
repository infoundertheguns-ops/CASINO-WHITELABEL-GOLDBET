// Plan D #3a — realtime publisher.
// See docs/superpowers/specs/2026-05-01-realtime-producer-design.md

import type {
  ApiEvent,
  CachedEvent,
  CachedEventMarket,
  LiveOddsMessage,
} from './types.js';
import type { RedisClient } from './redis-client.js';

export interface NewOddsEntry {
  market_type: string;
  outcome_name: string;
  odds: number;
}

export interface DiffEntry extends NewOddsEntry {
  previous_odds: number | null;
}

const stateKey = (e: { market_type: string; outcome_name: string }): string =>
  `${e.market_type}|${e.outcome_name}`;

export function computeDiff(
  priorOutcomes: Map<string, number>,
  next: NewOddsEntry[],
): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const entry of next) {
    const k = stateKey(entry);
    const prev = priorOutcomes.get(k);
    if (prev === undefined) {
      out.push({ ...entry, previous_odds: null });
    } else if (prev !== entry.odds) {
      out.push({ ...entry, previous_odds: prev });
    }
  }
  return out;
}

export type StatusRoute = 'live' | 'settled' | 'skip';

export function statusRoute(status: ApiEvent['status']): StatusRoute {
  switch (status) {
    case 'live':
      return 'live';
    case 'settled':
      return 'settled';
    case 'pending':
    case 'cancelled':
    case 'postponed':
      return 'skip';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'skip';
    }
  }
}

export type BuildCachedEventInput = Pick<
  ApiEvent,
  'id' | 'home' | 'away' | 'sport' | 'league' | 'scores'
> & {
  minute?: number;
  period?: string;
};

export function buildCachedEvent(
  ev: BuildCachedEventInput,
  newOdds: NewOddsEntry[],
): CachedEvent {
  const grouped = new Map<string, CachedEventMarket>();
  for (const o of newOdds) {
    let m = grouped.get(o.market_type);
    if (!m) {
      m = { type: o.market_type, outcomes: [] };
      grouped.set(o.market_type, m);
    }
    m.outcomes.push({ name: o.outcome_name, odds: o.odds });
  }

  const cached: CachedEvent = {
    external_id: String(ev.id),
    home_team: ev.home,
    away_team: ev.away,
    sport: ev.sport.slug,
    league: ev.league.slug,
    markets: [...grouped.values()],
    updated_at: Date.now(),
  };

  if (ev.scores && typeof ev.scores.home === 'number' && typeof ev.scores.away === 'number') {
    cached.scores = { home: ev.scores.home, away: ev.scores.away };
  }
  if (typeof ev.minute === 'number') cached.minute = ev.minute;
  if (typeof ev.period === 'string') cached.period = ev.period;

  return cached;
}
