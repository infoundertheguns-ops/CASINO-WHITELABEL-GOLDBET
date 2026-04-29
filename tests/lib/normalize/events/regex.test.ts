import { describe, it, expect } from 'vitest';
import { matchByRegex } from '@/lib/normalize/events/regex';
import type { EventToNormalize, FlashscoreCandidate } from '@/lib/normalize/events/types';

const baseEvent: EventToNormalize = {
  id: 'e1', source: 'kambi', sport: 'Calcio', league: 'Serie A', country: 'Italy',
  home_team: 'Milan', away_team: 'Inter',
  starts_at: '2026-04-22T20:00:00Z', flashscore_id: null,
};

describe('matchByRegex (Sprint 2.x dynamic confidence)', () => {
  it('exact case-insensitive match within 30min → confidence 0.99', async () => {
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs1', home_team: 'MILAN', away_team: 'Inter',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: 'Serie A' },
    ];
    const r = await matchByRegex(baseEvent, candidates);
    expect(r?.flashscore_id).toBe('fs1');
    expect(r?.stage).toBe('regex');
    expect(r?.confidence).toBeCloseTo(0.99);
  });

  it('exact case-insensitive within 1h → confidence 0.97 (auto-verify gate)', async () => {
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs1a', home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-22T20:45:00Z', sport: 'calcio', league: 'Serie A' },
    ];
    const r = await matchByRegex(baseEvent, candidates);
    expect(r?.confidence).toBeCloseTo(0.97);
  });

  it('exact case-insensitive 1-2h drift → confidence 0.93', async () => {
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs1b', home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-22T21:30:00Z', sport: 'calcio', league: 'Serie A' },
    ];
    const r = await matchByRegex(baseEvent, candidates);
    expect(r?.confidence).toBeCloseTo(0.93);
  });

  it('strips non-alphanumerics before comparing → 0.97 within 1h', async () => {
    const event: EventToNormalize = {
      ...baseEvent, home_team: 'PSV Eindhoven', away_team: 'Ajax',
    };
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs2', home_team: 'PSV-Eindhoven', away_team: 'Ajax!',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: null },
    ];
    const r = await matchByRegex(event, candidates);
    expect(r?.flashscore_id).toBe('fs2');
    // Tier 2 normalize match within 1h → 0.97
    expect(r?.confidence).toBeCloseTo(0.97);
  });

  it('word-set equality handles reordered tokens → 0.88', async () => {
    const event: EventToNormalize = {
      ...baseEvent, home_team: 'AC Milan', away_team: 'FC Inter',
    };
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs-reorder', home_team: 'Milan AC', away_team: 'Inter FC',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: null },
    ];
    const r = await matchByRegex(event, candidates);
    expect(r?.flashscore_id).toBe('fs-reorder');
    expect(r?.confidence).toBeCloseTo(0.88);
  });

  it('inherits v2 RPC score when higher than regex tier', async () => {
    // Regex tier: 0.97 (Tier 2 normalize within 1h). v2 score 0.99 (league+country boost).
    // Final should pick v2 score, capped at 0.99.
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs-v2', home_team: 'PSV-Eindhoven', away_team: 'Ajax!',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: null,
        score: 0.99 },
    ];
    const event: EventToNormalize = {
      ...baseEvent, home_team: 'PSV Eindhoven', away_team: 'Ajax',
    };
    const r = await matchByRegex(event, candidates);
    expect(r?.confidence).toBeCloseTo(0.99);
  });

  it('caps confidence at 0.99 even with v2 score 1.0', async () => {
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs-cap', home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: 'Serie A',
        score: 1.0 },
    ];
    const r = await matchByRegex(baseEvent, candidates);
    expect(r?.confidence).toBe(0.99);
  });

  it('requires starts_at within 2h', async () => {
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs3', home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-23T05:00:00Z', sport: 'calcio', league: null },
    ];
    const r = await matchByRegex(baseEvent, candidates);
    expect(r).toBeNull();
  });

  it('returns null when no candidate matches', async () => {
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs4', home_team: 'Roma', away_team: 'Lazio',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: null },
    ];
    const r = await matchByRegex(baseEvent, candidates);
    expect(r).toBeNull();
  });

  it('returns null for empty strings', async () => {
    const event: EventToNormalize = { ...baseEvent, home_team: '', away_team: '' };
    const r = await matchByRegex(event, []);
    expect(r).toBeNull();
  });

  it('picks best candidate across multiple matches', async () => {
    const candidates: FlashscoreCandidate[] = [
      { flashscore_id: 'fs-low', home_team: 'AC Milan', away_team: 'FC Inter',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: null }, // word-set 0.88 (tokens: ac/milan vs milan only)
      { flashscore_id: 'fs-high', home_team: 'Milan', away_team: 'Inter',
        starts_at: '2026-04-22T20:00:00Z', sport: 'calcio', league: null }, // exact 0.99
    ];
    const r = await matchByRegex(baseEvent, candidates);
    expect(r?.flashscore_id).toBe('fs-high');
    expect(r?.confidence).toBeCloseTo(0.99);
  });
});
