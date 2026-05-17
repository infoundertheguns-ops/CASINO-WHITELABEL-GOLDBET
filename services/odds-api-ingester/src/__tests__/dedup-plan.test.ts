import { describe, it, expect } from 'vitest';
import { planDedup, type ExistingEventRow } from '../dedup-plan.js';
import type { EventV2Row } from '../types.js';

function makeEvent(overrides: Partial<EventV2Row> = {}): EventV2Row {
  return {
    odds_api_id: 12345,
    home: 'Player A',
    away: 'Player B',
    home_id: null,
    away_id: null,
    starts_at: '2026-05-17T10:00:00Z',
    sport_slug: 'tennis',
    sport_name: 'Tennis',
    league_slug: 'atp-rome',
    league_name: 'ATP Rome',
    status: 'pending',
    score_home: null,
    score_away: null,
    period_scores: null,
    urls: {},
    ...overrides,
  };
}

function makeExisting(overrides: Partial<ExistingEventRow> = {}): ExistingEventRow {
  return {
    id: 'event-uuid-existing',
    odds_api_id: 99999,
    sport_slug: 'tennis',
    home: 'Player A',
    away: 'Player B',
    starts_at: '2026-05-17T10:00:00Z',
    ...overrides,
  };
}

describe('planDedup', () => {
  it('passes through non-tennis events unchanged (no dedup)', () => {
    const inputs = [makeEvent({ sport_slug: 'football', odds_api_id: 100 })];
    const plan = planDedup(inputs, []);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.toUpsert[0].odds_api_id).toBe(100);
    expect(plan.knownReuseMap.size).toBe(0);
    expect(plan.pendingReuseMap.size).toBe(0);
  });

  it('passes through tennis event with no existing match (normal upsert)', () => {
    const inputs = [makeEvent({ odds_api_id: 100 })];
    const plan = planDedup(inputs, []);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.knownReuseMap.size).toBe(0);
    expect(plan.pendingReuseMap.size).toBe(0);
  });

  it('passes through tennis event when existing has SAME odds_api_id (update path)', () => {
    const inputs = [makeEvent({ odds_api_id: 100 })];
    const existing = [makeExisting({ odds_api_id: 100, id: 'same-row' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.knownReuseMap.size).toBe(0);
  });

  it('SKIPS tennis event when existing has DIFFERENT odds_api_id (dedup hit)', () => {
    const inputs = [makeEvent({ odds_api_id: 30562526 })];
    const existing = [makeExisting({ odds_api_id: 146107, id: 'existing-id-abc' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(0);
    expect(plan.knownReuseMap.get(30562526)).toBe('existing-id-abc');
    expect(plan.pendingReuseMap.size).toBe(0);
  });

  it('signature ignores starts_at HH:MM (same UTC date)', () => {
    const inputs = [makeEvent({ odds_api_id: 200, starts_at: '2026-05-17T15:00:00Z' })];
    const existing = [makeExisting({ odds_api_id: 100, starts_at: '2026-05-17T10:00:00Z', id: 'existing-uuid' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(0);
    expect(plan.knownReuseMap.get(200)).toBe('existing-uuid');
  });

  it('signature DIFFERS when UTC date differs (different day, not a dupe)', () => {
    const inputs = [makeEvent({ odds_api_id: 200, starts_at: '2026-05-18T10:00:00Z' })];
    const existing = [makeExisting({ odds_api_id: 100, starts_at: '2026-05-17T10:00:00Z', id: 'existing-uuid' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.knownReuseMap.size).toBe(0);
  });

  it('within-batch dupe: first becomes canonical, second goes to pendingReuseMap', () => {
    const inputs = [
      makeEvent({ odds_api_id: 100 }),
      makeEvent({ odds_api_id: 200 }),
    ];
    const plan = planDedup(inputs, []);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.toUpsert[0].odds_api_id).toBe(100);
    expect(plan.pendingReuseMap.get(200)).toBe(100);
    expect(plan.knownReuseMap.size).toBe(0);
  });

  it('does NOT dedup tennis if home or away differ (different match)', () => {
    const inputs = [makeEvent({ odds_api_id: 200, home: 'Player C' })];
    const existing = [makeExisting({ odds_api_id: 100, id: 'existing-uuid' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.knownReuseMap.size).toBe(0);
  });

  it('does NOT dedup non-tennis even if signature matches (gate is sport-specific)', () => {
    const inputs = [makeEvent({ odds_api_id: 200, sport_slug: 'football' })];
    const existing = [makeExisting({ odds_api_id: 100, sport_slug: 'football', id: 'existing-uuid' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.knownReuseMap.size).toBe(0);
  });
});

describe('planDedup — edge cases', () => {
  it('within-batch dupe with 3+ inputs: first canonical, others all map to first', () => {
    const inputs = [
      makeEvent({ odds_api_id: 100 }),
      makeEvent({ odds_api_id: 200 }),
      makeEvent({ odds_api_id: 300 }),
    ];
    const plan = planDedup(inputs, []);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.toUpsert[0].odds_api_id).toBe(100);
    expect(plan.pendingReuseMap.get(200)).toBe(100);
    expect(plan.pendingReuseMap.get(300)).toBe(100);
  });

  it('within-batch dupe + existing: ALL inputs reuse existing, none upserted', () => {
    const inputs = [
      makeEvent({ odds_api_id: 100 }),
      makeEvent({ odds_api_id: 200 }),
    ];
    const existing = [makeExisting({ odds_api_id: 99999, id: 'existing-id' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(0);
    expect(plan.knownReuseMap.get(100)).toBe('existing-id');
    expect(plan.knownReuseMap.get(200)).toBe('existing-id');
    expect(plan.pendingReuseMap.size).toBe(0);
  });

  it('mixed batch: tennis dedup applies, football passes through', () => {
    const inputs = [
      makeEvent({ odds_api_id: 100, sport_slug: 'tennis' }),
      makeEvent({ odds_api_id: 200, sport_slug: 'tennis' }),
      makeEvent({ odds_api_id: 300, sport_slug: 'football', home: 'Inter', away: 'Milan' }),
    ];
    const existing = [makeExisting({ odds_api_id: 99999, sport_slug: 'tennis', id: 'tennis-existing' })];
    const plan = planDedup(inputs, existing);
    expect(plan.toUpsert).toHaveLength(1);
    expect(plan.toUpsert[0].sport_slug).toBe('football');
    expect(plan.knownReuseMap.get(100)).toBe('tennis-existing');
    expect(plan.knownReuseMap.get(200)).toBe('tennis-existing');
  });
});
