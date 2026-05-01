import { describe, it, expect, vi } from 'vitest';
import { computeDiff } from '../realtime-publisher.js';

describe('computeDiff', () => {
  it('returns all outcomes with previous_odds=null on first sight (empty prior state)', () => {
    const prior = new Map<string, number>();
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
    ];
    const diff = computeDiff(prior, next);
    expect(diff).toEqual([
      { market_type: '1X2', outcome_name: 'home', odds: 2.10, previous_odds: null },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30, previous_odds: null },
    ]);
  });

  it('returns empty array when nothing changed', () => {
    const prior = new Map([['1X2|home', 2.10], ['1X2|draw', 3.30]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
    ];
    expect(computeDiff(prior, next)).toEqual([]);
  });

  it('returns only the changed outcome', () => {
    const prior = new Map([['1X2|home', 2.10], ['1X2|draw', 3.30]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.05 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
    ];
    expect(computeDiff(prior, next)).toEqual([
      { market_type: '1X2', outcome_name: 'home', odds: 2.05, previous_odds: 2.10 },
    ]);
  });

  it('treats new outcome (key not in prior) as previous_odds=null', () => {
    const prior = new Map([['1X2|home', 2.10]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: 'OU', outcome_name: 'over_2.5', odds: 1.85 },
    ];
    expect(computeDiff(prior, next)).toEqual([
      { market_type: 'OU', outcome_name: 'over_2.5', odds: 1.85, previous_odds: null },
    ]);
  });

  it('does not emit a delete entry for outcome that disappeared from payload', () => {
    const prior = new Map([['1X2|home', 2.10], ['1X2|draw', 3.30]]);
    const next = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
    ];
    expect(computeDiff(prior, next)).toEqual([]);
  });

  it('uses literal numeric equality (small float diffs do count as change)', () => {
    const prior = new Map([['1X2|home', 2.10]]);
    const next = [{ market_type: '1X2', outcome_name: 'home', odds: 2.1000001 }];
    const diff = computeDiff(prior, next);
    expect(diff).toHaveLength(1);
    expect(diff[0].previous_odds).toBe(2.10);
  });
});

import { statusRoute } from '../realtime-publisher.js';
import type { ApiEvent } from '../types.js';

describe('statusRoute', () => {
  it('routes live to "live"', () => {
    expect(statusRoute('live')).toBe('live');
  });
  it('routes settled to "settled"', () => {
    expect(statusRoute('settled')).toBe('settled');
  });
  it('routes pending to "skip"', () => {
    expect(statusRoute('pending')).toBe('skip');
  });
  it('routes cancelled to "skip"', () => {
    expect(statusRoute('cancelled')).toBe('skip');
  });
  it('routes postponed to "skip"', () => {
    expect(statusRoute('postponed')).toBe('skip');
  });
  it('is exhaustive on ApiEvent["status"]', () => {
    // type-level check: this test exists to assert compile-time exhaustiveness.
    // If a new variant is added to ApiEvent['status'], the switch in
    // realtime-publisher.ts will fail to compile. This test documents intent.
    const all: Array<ApiEvent['status']> = ['pending', 'live', 'settled', 'cancelled', 'postponed'];
    for (const s of all) {
      expect(['live', 'settled', 'skip']).toContain(statusRoute(s));
    }
  });
});

import { buildCachedEvent } from '../realtime-publisher.js';
import type { CachedEvent } from '../types.js';

const baseApiEvent = {
  id: 12345,
  home: 'Inter',
  away: 'Milan',
  date: '2026-05-01T20:00:00Z',
  status: 'live' as const,
  sport: { name: 'Football', slug: 'football' },
  league: { name: 'Serie A', slug: 'italy-serie-a' },
};

describe('buildCachedEvent', () => {
  it('produces required fields with empty markets when no odds', () => {
    const c = buildCachedEvent(baseApiEvent, []);
    expect(c.external_id).toBe('12345');
    expect(c.home_team).toBe('Inter');
    expect(c.away_team).toBe('Milan');
    expect(c.sport).toBe('football');
    expect(c.league).toBe('italy-serie-a');
    expect(c.markets).toEqual([]);
    expect(typeof c.updated_at).toBe('number');
    expect(c.scores).toBeUndefined();
    expect(c.minute).toBeUndefined();
    expect(c.period).toBeUndefined();
  });

  it('includes scores when present', () => {
    const ev = { ...baseApiEvent, scores: { home: 1, away: 0 } };
    const c = buildCachedEvent(ev, []);
    expect(c.scores).toEqual({ home: 1, away: 0 });
  });

  it('omits scores when home/away missing', () => {
    const ev = { ...baseApiEvent, scores: { periods: { '1H': { home: 0, away: 0 } } } };
    const c = buildCachedEvent(ev, []);
    expect(c.scores).toBeUndefined();
  });

  it('groups outcomes by market_type', () => {
    const odds = [
      { market_type: '1X2', outcome_name: 'home', odds: 2.10 },
      { market_type: '1X2', outcome_name: 'draw', odds: 3.30 },
      { market_type: '1X2', outcome_name: 'away', odds: 3.50 },
      { market_type: 'OU 2.5', outcome_name: 'over', odds: 1.85 },
      { market_type: 'OU 2.5', outcome_name: 'under', odds: 1.95 },
    ];
    const c = buildCachedEvent(baseApiEvent, odds);
    expect(c.markets).toEqual<CachedEvent['markets']>([
      { type: '1X2', outcomes: [
        { name: 'home', odds: 2.10 },
        { name: 'draw', odds: 3.30 },
        { name: 'away', odds: 3.50 },
      ]},
      { type: 'OU 2.5', outcomes: [
        { name: 'over', odds: 1.85 },
        { name: 'under', odds: 1.95 },
      ]},
    ]);
  });

  it('preserves outcome insertion order within a market', () => {
    const odds = [
      { market_type: 'OU 0.5', outcome_name: 'over', odds: 1.05 },
      { market_type: 'OU 0.5', outcome_name: 'under', odds: 8.00 },
    ];
    const c = buildCachedEvent(baseApiEvent, odds);
    expect(c.markets[0].outcomes.map(o => o.name)).toEqual(['over', 'under']);
  });
});

import { createRealtimePublisher } from '../realtime-publisher.js';

function makeRedisMock() {
  return {
    hSet: vi.fn().mockResolvedValue(1),
    hDel: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(1),
    isOpen: true,
  };
}

const liveBase = {
  id: 999,
  status: 'live' as const,
  home: 'A',
  away: 'B',
  sport: { name: 'Football', slug: 'football' },
  league: { name: 'L', slug: 'l' },
};

describe('publish — live path', () => {
  it('writes HSET odds:cache and PUBLISH on first sight (full diff)', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({
      event: liveBase,
      newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }],
    });
    expect(r).toEqual({ published: true, changesCount: 1 });
    expect(redis.hSet).toHaveBeenCalledWith('odds:cache', '999', expect.any(String));
    expect(redis.publish).toHaveBeenCalledWith('odds:live', expect.any(String));
    const msg = JSON.parse(redis.publish.mock.calls[0][1] as string);
    expect(msg.event_id).toBe('999');
    expect(msg.type).toBe('update');
    expect(msg.changes).toEqual([
      { market_type: '1X2', outcome_name: 'home', odds: 2.10, previous_odds: null },
    ]);
    expect(typeof msg.ts).toBe('number');
  });

  it('refreshes HSET but does NOT PUBLISH when diff is empty', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    redis.hSet.mockClear();
    redis.publish.mockClear();
    const r = await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(r).toEqual({ published: false, reason: 'no_changes', changesCount: 0 });
    expect(redis.hSet).toHaveBeenCalledTimes(1);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('updates state map after a successful publish', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);
  });
});

describe('publish — non-live skip path', () => {
  it.each([['pending'], ['cancelled'], ['postponed']] as const)('skips %s without any redis op', async (status) => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({
      event: { ...liveBase, status },
      newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }],
    });
    expect(r).toEqual({ published: false, reason: 'not_live', changesCount: 0 });
    expect(redis.hSet).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });
});

describe('publish — settled path', () => {
  it('publishes finished + HDEL + evicts state', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    // first put the event in state
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);
    redis.hSet.mockClear();
    redis.publish.mockClear();

    const r = await pub.publish({ event: { ...liveBase, status: 'settled' }, newOdds: [] });
    expect(r).toEqual({ published: true, reason: 'finished', changesCount: 0 });
    expect(redis.publish).toHaveBeenCalledWith('odds:live', expect.any(String));
    const msg = JSON.parse(redis.publish.mock.calls[0][1] as string);
    expect(msg.type).toBe('finished');
    expect(msg.event_id).toBe('999');
    expect(msg.changes).toEqual([]);
    expect(redis.hDel).toHaveBeenCalledWith('odds:cache', '999');
    expect(pub.getStateSize()).toBe(0);
  });

  it('is idempotent when called for an already-evicted event', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r1 = await pub.publish({ event: { ...liveBase, status: 'settled' }, newOdds: [] });
    expect(r1).toEqual({ published: true, reason: 'finished', changesCount: 0 });
    const r2 = await pub.publish({ event: { ...liveBase, status: 'settled' }, newOdds: [] });
    expect(r2).toEqual({ published: true, reason: 'finished', changesCount: 0 });
    expect(redis.publish).toHaveBeenCalledTimes(2);
    expect(redis.hDel).toHaveBeenCalledTimes(2);
  });
});

describe('publish — failure modes', () => {
  it('catches redis errors and returns redis_unavailable, does not propagate', async () => {
    const redis = makeRedisMock();
    redis.hSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(r).toEqual({ published: false, reason: 'redis_unavailable', changesCount: 0 });
  });

  it('returns skipped when REALTIME_PUBLISHER_ENABLED=false', async () => {
    const orig = process.env.REALTIME_PUBLISHER_ENABLED;
    process.env.REALTIME_PUBLISHER_ENABLED = 'false';
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    const r = await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(r).toEqual({ published: false, reason: 'skipped', changesCount: 0 });
    expect(redis.hSet).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
    if (orig === undefined) delete process.env.REALTIME_PUBLISHER_ENABLED;
    else process.env.REALTIME_PUBLISHER_ENABLED = orig;
  });
});

describe('evictEvent / getStateSize', () => {
  it('evictEvent removes from state map', async () => {
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);
    pub.evictEvent(999);
    expect(pub.getStateSize()).toBe(0);
  });
});

describe('GC pass for stale entries', () => {
  it('removes entries not touched in 30+ minutes', async () => {
    vi.useFakeTimers();
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });
    expect(pub.getStateSize()).toBe(1);

    // Advance 35 min → > 30 min stale threshold.
    vi.advanceTimersByTime(35 * 60_000);
    // GC runs every 5min, so multiple ticks fire — at least one after 30min.
    expect(pub.getStateSize()).toBe(0);
    pub.dispose();
    vi.useRealTimers();
  });

  it('does NOT remove entries touched within 30 minutes', async () => {
    vi.useFakeTimers();
    const redis = makeRedisMock();
    const pub = createRealtimePublisher(redis as any);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });

    // Advance 20 min, then touch via no-change publish.
    vi.advanceTimersByTime(20 * 60_000);
    await pub.publish({ event: liveBase, newOdds: [{ market_type: '1X2', outcome_name: 'home', odds: 2.10 }] });

    // Advance another 20 min (total 40), GC fires, but lastTouched is only 20 min stale.
    vi.advanceTimersByTime(20 * 60_000);
    expect(pub.getStateSize()).toBe(1);
    pub.dispose();
    vi.useRealTimers();
  });
});
