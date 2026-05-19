import { describe, it, expect } from 'vitest';
import { FixtureState } from '../state.js';
import { shouldFetchEvents, CARD_POLL_TTL_MS } from '../discovery.js';
import type { AFFixture } from '../types.js';

/**
 * Build a minimal AFFixture-shaped object sufficient for shouldFetchEvents.
 * Only fixture.id and goals are inspected; other fields are placeholders.
 */
function buildFixture(id: number, home: number | null, away: number | null): Pick<AFFixture, 'fixture' | 'goals'> {
  return {
    fixture: {
      id,
      date: '2026-05-19T12:00:00+00:00',
      status: { elapsed: 45, long: 'Second Half', short: '2H' },
      venue: { id: null, name: '', city: '' },
    },
    goals: { home, away },
  };
}

const NOW = 1_700_000_000_000;

describe('shouldFetchEvents', () => {
  it('returns score-delta when goals advance (0-0 -> 1-0)', () => {
    const state = new FixtureState();
    state.setLastScore(1, { home: 0, away: 0 });
    state.setEventsFetchAt(1, NOW - 60_000);
    const result = shouldFetchEvents(state, buildFixture(1, 1, 0), NOW);
    expect(result).toEqual({ fetch: true, reason: 'score-delta' });
  });

  it('returns fetch:false when score unchanged and last fetch is recent', () => {
    const state = new FixtureState();
    state.setLastScore(1, { home: 1, away: 0 });
    state.setEventsFetchAt(1, NOW - 60_000);
    const result = shouldFetchEvents(state, buildFixture(1, 1, 0), NOW);
    expect(result).toEqual({ fetch: false });
  });

  it('returns card-poll when score unchanged but TTL has elapsed', () => {
    const state = new FixtureState();
    state.setLastScore(1, { home: 1, away: 0 });
    state.setEventsFetchAt(1, NOW - 6 * 60 * 1000);
    const result = shouldFetchEvents(state, buildFixture(1, 1, 0), NOW);
    expect(result).toEqual({ fetch: true, reason: 'card-poll' });
  });

  it('returns score-delta on VAR cancellation (1-0 -> 0-0)', () => {
    const state = new FixtureState();
    state.setLastScore(1, { home: 1, away: 0 });
    state.setEventsFetchAt(1, NOW - 60_000);
    const result = shouldFetchEvents(state, buildFixture(1, 0, 0), NOW);
    expect(result).toEqual({ fetch: true, reason: 'score-delta' });
  });

  it('returns card-poll on cold start (no prior state, 0-0 fixture)', () => {
    const state = new FixtureState();
    const result = shouldFetchEvents(state, buildFixture(1, 0, 0), NOW);
    expect(result).toEqual({ fetch: true, reason: 'card-poll' });
  });

  it('returns score-delta on cold start when fixture already has live score (precedence: score-delta beats card-poll)', () => {
    const state = new FixtureState();
    const result = shouldFetchEvents(state, buildFixture(1, 2, 1), NOW);
    expect(result).toEqual({ fetch: true, reason: 'score-delta' });
  });

  it('coerces null goals to 0: state {0,0} + fixture {null,null} + recent fetch -> no fetch', () => {
    const state = new FixtureState();
    state.setLastScore(1, { home: 0, away: 0 });
    state.setEventsFetchAt(1, NOW - 1_000);
    const result = shouldFetchEvents(state, buildFixture(1, null, null), NOW);
    expect(result).toEqual({ fetch: false });
  });

  it('is pure: repeated calls with same inputs return stable results and never mutate state', () => {
    const state = new FixtureState();
    state.setLastScore(1, { home: 1, away: 0 });
    state.setEventsFetchAt(1, NOW - 60_000);
    const fixture = buildFixture(1, 1, 1);

    const first = shouldFetchEvents(state, fixture, NOW);
    const second = shouldFetchEvents(state, fixture, NOW);
    const third = shouldFetchEvents(state, fixture, NOW);

    expect(first).toEqual({ fetch: true, reason: 'score-delta' });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // state untouched — score and fetchAt remain as we set them
    expect(state.getLastScore(1)).toEqual({ home: 1, away: 0 });
    expect(state.getLastEventsFetchAt(1)).toBe(NOW - 60_000);
  });

  it('exports CARD_POLL_TTL_MS as 5 minutes', () => {
    expect(CARD_POLL_TTL_MS).toBe(5 * 60 * 1000);
  });
});
