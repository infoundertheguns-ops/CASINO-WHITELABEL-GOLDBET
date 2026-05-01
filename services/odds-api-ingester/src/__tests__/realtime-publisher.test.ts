import { describe, it, expect } from 'vitest';
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
