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


export interface PublishContext {
  event: BuildCachedEventInput & {
    id: number;
    status: ApiEvent['status'];
  };
  newOdds: NewOddsEntry[];
}

export type PublishReason =
  | 'not_live'
  | 'no_changes'
  | 'redis_unavailable'
  | 'finished'
  | 'skipped';

export interface PublishResult {
  published: boolean;
  reason?: PublishReason;
  changesCount: number;
}

export interface RealtimePublisher {
  publish(ctx: PublishContext): Promise<PublishResult>;
  getStateSize(): number;
  evictEvent(eventId: number): void;
  dispose(): void;
}

interface OddsState {
  outcomes: Map<string, number>;
  lastTouched: number;
}

const CHANNEL = 'odds:live';
const CACHE_HASH = 'odds:cache';

export function createRealtimePublisher(redis: RedisClient): RealtimePublisher {
  const stateByEvent = new Map<number, OddsState>();

  async function publish(ctx: PublishContext): Promise<PublishResult> {
    if (process.env.REALTIME_PUBLISHER_ENABLED === 'false') {
      return { published: false, reason: 'skipped', changesCount: 0 };
    }

    const route = statusRoute(ctx.event.status);
    if (route === 'skip') {
      return { published: false, reason: 'not_live', changesCount: 0 };
    }

    const eventId = ctx.event.id;
    const eventIdStr = String(eventId);

    if (route === 'settled') {
      try {
        const msg: LiveOddsMessage = {
          event_id: eventIdStr,
          ts: Date.now(),
          type: 'finished',
          changes: [],
        };
        await redis.publish(CHANNEL, JSON.stringify(msg));
        await redis.hDel(CACHE_HASH, eventIdStr);
        stateByEvent.delete(eventId);
        return { published: true, reason: 'finished', changesCount: 0 };
      } catch (err) {
        console.error(`[realtime] settled-path redis op failed for ${eventId}:`, (err as Error).message);
        return { published: false, reason: 'redis_unavailable', changesCount: 0 };
      }
    }

    // route === 'live'
    try {
      const cached = buildCachedEvent(ctx.event, ctx.newOdds);
      await redis.hSet(CACHE_HASH, eventIdStr, JSON.stringify(cached));

      const prior = stateByEvent.get(eventId)?.outcomes ?? new Map<string, number>();
      const diff = computeDiff(prior, ctx.newOdds);

      if (diff.length === 0) {
        // refresh lastTouched only
        const existing = stateByEvent.get(eventId);
        if (existing) existing.lastTouched = Date.now();
        return { published: false, reason: 'no_changes', changesCount: 0 };
      }

      // update state with new odds
      const nextOutcomes = new Map<string, number>(prior);
      for (const o of ctx.newOdds) {
        nextOutcomes.set(`${o.market_type}|${o.outcome_name}`, o.odds);
      }
      stateByEvent.set(eventId, { outcomes: nextOutcomes, lastTouched: Date.now() });

      const msg: LiveOddsMessage = {
        event_id: eventIdStr,
        ts: Date.now(),
        type: 'update',
        changes: diff,
        ...(cached.scores ? { scores: cached.scores } : {}),
        ...(cached.minute !== undefined ? { minute: cached.minute } : {}),
        ...(cached.period !== undefined ? { period: cached.period } : {}),
      };
      await redis.publish(CHANNEL, JSON.stringify(msg));
      console.log(`[realtime] published ${eventId} changes=${diff.length}`);
      return { published: true, changesCount: diff.length };
    } catch (err) {
      console.error(`[realtime] live-path redis op failed for ${eventId}:`, (err as Error).message);
      return { published: false, reason: 'redis_unavailable', changesCount: 0 };
    }
  }

  function getStateSize(): number {
    return stateByEvent.size;
  }

  function evictEvent(eventId: number): void {
    stateByEvent.delete(eventId);
  }

  // GC pass: drop entries older than 30min, runs every 5min.
  // Belt-and-suspenders: handles events that disappear from odds-api before reaching 'settled'.
  const STALE_MS = 30 * 60_000;
  const gcInterval = setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const [id, state] of stateByEvent.entries()) {
      if (state.lastTouched < cutoff) stateByEvent.delete(id);
    }
  }, 5 * 60_000);
  // Don't keep process alive just for GC.
  if (typeof gcInterval.unref === 'function') gcInterval.unref();

  function dispose(): void {
    clearInterval(gcInterval);
  }

  return { publish, getStateSize, evictEvent, dispose };
}
