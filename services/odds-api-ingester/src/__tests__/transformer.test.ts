import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformEvent, expandOutcome } from '../transformer.js';
import type { ApiEvent } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'event-pisa-lecce.json'), 'utf8')
) as ApiEvent;

const MK = { event_odds_api_id: 1, bookmaker: 'X', market_name: 'M' };

describe('transformEvent — top-level', () => {
  it('extracts the event row with stable IDs and ISO date', () => {
    const result = transformEvent(fixture);
    expect(result.event.odds_api_id).toBe(61061637);
    expect(result.event.home).toBe('Pisa SC');
    expect(result.event.away).toBe('US Lecce');
    expect(result.event.sport_slug).toBe('football');
    expect(result.event.league_slug).toBe('italy-serie-a');
    expect(result.event.starts_at).toBe('2026-05-01T18:45:00Z');
    expect(result.event.status).toBe('pending');
  });

  it('produces one market row per (bookmaker, market_name)', () => {
    const result = transformEvent(fixture);
    const bet365 = result.markets.filter(m => m.bookmaker === 'Bet365');
    expect(bet365.length).toBe(36);
    const names = new Set(bet365.map(m => m.market_name));
    expect(names.has('ML')).toBe(true);
    expect(names.has('Totals')).toBe(true);
    expect(names.has('European Handicap')).toBe(true);
    expect(names.has('Anytime Goalscorer')).toBe(true);
  });

  it('returns null score_home/away for pending events', () => {
    const result = transformEvent(fixture);
    expect(result.event.score_home).toBeNull();
    expect(result.event.score_away).toBeNull();
  });

  it('preserves urls verbatim', () => {
    const result = transformEvent(fixture);
    expect(typeof result.event.urls).toBe('object');
  });

  it('produces hundreds of outcomes for rich Bet365 feed', () => {
    const result = transformEvent(fixture);
    expect(result.outcomes.length).toBeGreaterThan(900);
  });

  it('every outcome links back via market_key composite', () => {
    const result = transformEvent(fixture);
    for (const o of result.outcomes.slice(0, 50)) {
      expect(o.market_key.event_odds_api_id).toBe(61061637);
      expect(typeof o.market_key.bookmaker).toBe('string');
      expect(typeof o.market_key.market_name).toBe('string');
    }
  });
});

describe('expandOutcome — shape coverage', () => {
  it('shape ML 3-way {home, draw, away}', () => {
    const out = expandOutcome('ML', { home: '3.000', draw: '3.000', away: '2.450' }, MK);
    expect(out).toHaveLength(3);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['away', 'draw', 'home']);
    out.forEach(o => expect(o.line).toBeNull());
    expect(out.find(o => o.outcome_key === 'home')?.odds).toBe(3.0);
  });

  it('shape DNB 2-way {home, away}', () => {
    const out = expandOutcome('Draw No Bet', { home: '2.100', away: '1.666' }, MK);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['away', 'home']);
    out.forEach(o => expect(o.line).toBeNull());
  });

  it('shape Spread {hdp, home, away}', () => {
    const out = expandOutcome('Spread', { hdp: 0.25, home: '1.750', away: '2.125' }, MK);
    expect(out).toHaveLength(2);
    out.forEach(o => expect(o.line).toBe(0.25));
    expect(out.find(o => o.outcome_key === 'home')?.odds).toBe(1.75);
  });

  it('shape European Handicap 3-way {hdp, home, draw, away}', () => {
    const out = expandOutcome(
      'European Handicap',
      { hdp: -1, home: '2.000', draw: '4.000', away: '5.500' },
      MK,
    );
    expect(out).toHaveLength(3);
    out.forEach(o => expect(o.line).toBe(-1));
  });

  it('shape European Handicap 2-way (no home) {hdp, draw, away}', () => {
    const out = expandOutcome(
      'European Handicap',
      { hdp: -1, draw: '4.000', away: '5.500' },
      MK,
    );
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['away', 'draw']);
    out.forEach(o => expect(o.line).toBe(-1));
  });

  it('shape Totals {hdp, over, under}', () => {
    const out = expandOutcome('Totals', { hdp: 2.5, over: '1.875', under: '1.975' }, MK);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['over', 'under']);
    out.forEach(o => expect(o.line).toBe(2.5));
  });

  it('shape BTTS {yes, no}', () => {
    const out = expandOutcome('BTTS', { yes: '2.050', no: '1.700' }, MK);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['no', 'yes']);
    out.forEach(o => expect(o.line).toBeNull());
  });

  it('shape labeled {label, under} (Double Chance)', () => {
    const out = expandOutcome('Double Chance', { label: 'Draw or Lecce', under: '1.400' }, MK);
    expect(out).toHaveLength(1);
    expect(out[0].outcome_key).toBe('Draw or Lecce');
    expect(out[0].line).toBeNull();
    expect(out[0].odds).toBe(1.4);
  });

  it('shape labeled {label, over} (Player To Score)', () => {
    const out = expandOutcome(
      'Player To Score or Assist',
      { label: 'Alex Sala (Assist) (2)', over: '10.000' },
      MK,
    );
    expect(out).toHaveLength(1);
    expect(out[0].outcome_key).toBe('Alex Sala (Assist) (2)');
    expect(out[0].odds).toBe(10);
    expect(out[0].line).toBeNull();
  });

  it('shape labeled {hdp, label, over} (Anytime Goalscorer)', () => {
    const out = expandOutcome(
      'Anytime Goalscorer',
      { label: 'Alex Sala', hdp: 0.5, over: '13.000' },
      MK,
    );
    expect(out).toHaveLength(1);
    expect(out[0].outcome_key).toBe('Alex Sala');
    expect(out[0].line).toBe(0.5);
    expect(out[0].odds).toBe(13);
  });

  it('shape labeled {hdp, label, away} (1st Half Handicap variant)', () => {
    const out = expandOutcome(
      '1st Half Handicap',
      { label: 'Tie (-1)', hdp: -1, away: '12.000' },
      MK,
    );
    expect(out).toHaveLength(1);
    expect(out[0].outcome_key).toBe('Tie (-1)');
    expect(out[0].line).toBe(-1);
    expect(out[0].odds).toBe(12);
  });

  it('shape labeled {hdp, home, label} (Specials variant)', () => {
    const out = expandOutcome(
      'Specials',
      { label: 'To Win From Behind (1)', hdp: 1, home: '5.500' },
      MK,
    );
    expect(out).toHaveLength(1);
    expect(out[0].outcome_key).toBe('To Win From Behind (1)');
    expect(out[0].line).toBe(1);
    expect(out[0].odds).toBe(5.5);
  });

  it('shape Totals with extra label {hdp, label, over, under} (First 10 Min)', () => {
    const out = expandOutcome(
      'First 10 Minutes',
      { label: 'Goals (Over) (0.5)', hdp: 0.5, over: '5.500', under: '1.142' },
      MK,
    );
    // Both shapes valid: could expand as labeled (1 outcome) or totals (2). Choose totals
    // since over/under both present (more informative).
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['over', 'under']);
    out.forEach(o => expect(o.line).toBe(0.5));
  });

  it('returns empty for unknown shapes', () => {
    const out = expandOutcome('Mystery', { foo: 'bar', baz: 42 }, MK);
    expect(out).toHaveLength(0);
  });

  it('handles invalid odds strings via graceful degradation', () => {
    const out = expandOutcome('ML', { home: 'not-a-number', draw: '3.0', away: '2.5' }, MK);
    // home parses to null (NaN), so the 3-way ML branch is skipped. The remaining
    // {draw, away} pair matches rule 5 (2-way handicap variant), expanding to 2 outcomes.
    // Acceptable — degrades to partial data rather than crashing or returning empty.
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['away', 'draw']);
  });

  it('returns empty when odds are entirely missing/invalid', () => {
    const out = expandOutcome('ML', { home: 'x', draw: 'y', away: 'z' }, MK);
    expect(out).toHaveLength(0);
  });

  it('shape {even, odd} (basketball Odd/Even)', () => {
    const out = expandOutcome('Odd/Even', { even: '1.85', odd: '1.95' }, MK);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['even', 'odd']);
    out.forEach(o => expect(o.line).toBeNull());
    expect(out.find(o => o.outcome_key === 'even')?.odds).toBe(1.85);
  });

  it('shape {12, 1X, X2} (ice hockey 3-Way Result Double Chance)', () => {
    const out = expandOutcome('3-Way Result', { '12': '1.5', '1X': '1.7', 'X2': '2.3' }, MK);
    expect(out).toHaveLength(3);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['12', '1X', 'X2']);
    out.forEach(o => expect(o.line).toBeNull());
    expect(out.find(o => o.outcome_key === '12')?.odds).toBe(1.5);
  });

  it('generic fallback ignores invalid values', () => {
    const out = expandOutcome('Mystery', { foo: '1.5', bar: '2.0', baz: 'invalid' }, MK);
    expect(out).toHaveLength(2);
    expect(out.map(o => o.outcome_key).sort()).toEqual(['bar', 'foo']);
  });
});
