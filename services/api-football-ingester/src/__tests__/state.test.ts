import { describe, it, expect } from 'vitest';
import { FixtureState } from '../state.js';

describe('FixtureState', () => {
  describe('getLastScore / setLastScore', () => {
    it('returns {home:0, away:0} default before any setLastScore call', () => {
      const state = new FixtureState();
      expect(state.getLastScore(42)).toEqual({ home: 0, away: 0 });
    });

    it('round-trips a score via setLastScore then getLastScore', () => {
      const state = new FixtureState();
      state.setLastScore(42, { home: 2, away: 1 });
      expect(state.getLastScore(42)).toEqual({ home: 2, away: 1 });
    });
  });

  describe('getLastEventsFetchAt / setEventsFetchAt', () => {
    it('returns 0 default and the set value after setEventsFetchAt', () => {
      const state = new FixtureState();
      expect(state.getLastEventsFetchAt(99)).toBe(0);
      state.setEventsFetchAt(99, 1234567890);
      expect(state.getLastEventsFetchAt(99)).toBe(1234567890);
    });
  });

  describe('pruneStale', () => {
    it('removes stale fixtures from both maps while preserving active ones', () => {
      const state = new FixtureState();
      // Three fixtures, all populated in both maps
      state.setLastScore(1, { home: 1, away: 0 });
      state.setEventsFetchAt(1, 1000);
      state.setLastScore(2, { home: 0, away: 2 });
      state.setEventsFetchAt(2, 2000);
      state.setLastScore(3, { home: 3, away: 3 });
      state.setEventsFetchAt(3, 3000);

      // Only 1 and 3 remain active; 2 is stale
      state.pruneStale(new Set([1, 3]));

      // Active fixtures preserved with original values
      expect(state.getLastScore(1)).toEqual({ home: 1, away: 0 });
      expect(state.getLastEventsFetchAt(1)).toBe(1000);
      expect(state.getLastScore(3)).toEqual({ home: 3, away: 3 });
      expect(state.getLastEventsFetchAt(3)).toBe(3000);

      // Stale fixture cleared from BOTH maps (defaults restored)
      expect(state.getLastScore(2)).toEqual({ home: 0, away: 0 });
      expect(state.getLastEventsFetchAt(2)).toBe(0);
    });

    it('removes all entries when called with an empty Set (end-of-day cleanup)', () => {
      const state = new FixtureState();
      state.setLastScore(10, { home: 1, away: 1 });
      state.setEventsFetchAt(10, 10000);
      state.setLastScore(20, { home: 2, away: 2 });
      state.setEventsFetchAt(20, 20000);

      state.pruneStale(new Set());

      expect(state.getLastScore(10)).toEqual({ home: 0, away: 0 });
      expect(state.getLastEventsFetchAt(10)).toBe(0);
      expect(state.getLastScore(20)).toEqual({ home: 0, away: 0 });
      expect(state.getLastEventsFetchAt(20)).toBe(0);
    });

    it('removes orphan lastEventsFetchAt entries (no matching lastSeenScores) when not active', () => {
      // Defensive case: validates the docstring claim that pruneStale
      // iterates both internal maps independently rather than relying on
      // the subset invariant (lastEventsFetchAt keys subset of lastSeenScores).
      const state = new FixtureState();
      // Orphan: only in lastEventsFetchAt, never set in lastSeenScores
      state.setEventsFetchAt(77, 7700);
      // Active baseline to confirm we didn't nuke everything
      state.setLastScore(1, { home: 1, away: 0 });
      state.setEventsFetchAt(1, 1000);

      state.pruneStale(new Set([1]));

      // Orphan removed
      expect(state.getLastEventsFetchAt(77)).toBe(0);
      // Active preserved
      expect(state.getLastScore(1)).toEqual({ home: 1, away: 0 });
      expect(state.getLastEventsFetchAt(1)).toBe(1000);
    });
  });
});
