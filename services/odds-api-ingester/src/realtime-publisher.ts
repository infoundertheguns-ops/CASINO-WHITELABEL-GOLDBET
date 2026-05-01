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
