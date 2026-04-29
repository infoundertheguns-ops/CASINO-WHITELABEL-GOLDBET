import { describe, it, expect } from 'vitest';
import { buildPrompt, parseResponse, toMatchResult } from '@/lib/normalize/events/llm-core';

describe('llm-core', () => {
  const event = {
    id: 'e1', source: 'kambi' as const, sport: 'Tennis', league: 'ATP', country: 'Spain',
    home_team: 'Djokovic', away_team: 'Alcaraz',
    starts_at: '2026-04-22T15:00:00Z', flashscore_id: null,
  };

  it('buildPrompt includes source event fields', () => {
    const p = buildPrompt({ event, candidates: [] });
    expect(p).toContain('Djokovic');
    expect(p).toContain('Tennis');
    expect(p).toContain('Spain');
    expect(p).toContain('```json');
    expect(p).toContain('(none)');
  });

  it('buildPrompt lists candidates with country when present', () => {
    const p = buildPrompt({
      event,
      candidates: [
        { flashscore_id: 'fs1', home_team: 'N. Djokovic', away_team: 'C. Alcaraz',
          starts_at: '2026-04-22T15:00:00Z', sport: 'tennis', league: 'ATP', country: 'Spain' },
      ],
    });
    expect(p).toContain('fs1');
    expect(p).toContain('N. Djokovic');
    expect(p).toContain('Spain');
  });

  it('buildPrompt instructs LLM about verify dual gate', () => {
    const p = buildPrompt({ event, candidates: [] });
    expect(p).toContain('verify');
    expect(p).toMatch(/human operator confirm this match/i);
    expect(p).toMatch(/WITHOUT HESITATION/);
  });

  it('parseResponse extracts JSON with verify field', () => {
    const r = parseResponse('```json\n{"flashscore_id":"fs1","confidence":0.97,"verify":true,"reason":"exact"}\n```');
    expect(r?.flashscore_id).toBe('fs1');
    expect(r?.confidence).toBe(0.97);
    expect(r?.verify).toBe(true);
  });

  it('parseResponse defaults verify=false when missing (legacy LLM output)', () => {
    const r = parseResponse('```json\n{"flashscore_id":"fs1","confidence":0.97,"reason":"exact"}\n```');
    expect(r?.verify).toBe(false);
  });

  it('parseResponse treats verify=truthy non-true as false (strict gate)', () => {
    const r = parseResponse('{"flashscore_id":"fs","confidence":0.97,"verify":"yes","reason":"x"}');
    // Only literal boolean true counts as verify=true. Strings, numbers, etc → false.
    expect(r?.verify).toBe(false);
    const r2 = parseResponse('{"flashscore_id":"fs","confidence":0.97,"verify":1,"reason":"x"}');
    expect(r2?.verify).toBe(false);
  });

  it('parseResponse handles bare JSON', () => {
    const r = parseResponse('{"flashscore_id":"fs2","confidence":0.85,"verify":false,"reason":"probable"}');
    expect(r?.flashscore_id).toBe('fs2');
    expect(r?.verify).toBe(false);
  });

  it('parseResponse clamps confidence to [0,1]', () => {
    const r = parseResponse('{"flashscore_id":"fs","confidence":1.5,"verify":true,"reason":"x"}');
    expect(r?.confidence).toBe(1);
    const r2 = parseResponse('{"flashscore_id":"fs","confidence":-0.2,"verify":false,"reason":"x"}');
    expect(r2?.confidence).toBe(0);
  });

  it('parseResponse returns null on invalid input', () => {
    expect(parseResponse('no json here')).toBeNull();
    expect(parseResponse('{"foo":"bar"}')).toBeNull();
  });

  it('toMatchResult returns null for null flashscore_id', () => {
    expect(toMatchResult({ flashscore_id: null, confidence: 0.3, verify: false, reason: 'no match' })).toBeNull();
  });

  it('toMatchResult builds MatchResult with stage=llm and propagates verify flag', () => {
    const r = toMatchResult({ flashscore_id: 'fs1', confidence: 0.9, verify: true, reason: 'ok' });
    expect(r?.stage).toBe('llm');
    expect(r?.llm_reason).toBe('ok');
    expect(r?.llm_verify).toBe(true);
  });

  it('toMatchResult propagates verify=false through to MatchResult', () => {
    const r = toMatchResult({ flashscore_id: 'fs1', confidence: 0.97, verify: false, reason: 'common surnames' });
    expect(r?.llm_verify).toBe(false);
  });

  // ───────── Mig 121 — propose_alias ─────────
  it('parseResponse extracts well-formed propose_alias', () => {
    const r = parseResponse('{"flashscore_id":"fs1","confidence":0.97,"verify":true,"reason":"x","propose_alias":{"alias":"PSG","canonical":"Paris Saint-Germain"}}');
    expect(r?.propose_alias).toEqual({ alias: 'psg', canonical: 'paris saint-germain' });
  });

  it('parseResponse defaults propose_alias to null when missing', () => {
    const r = parseResponse('{"flashscore_id":"fs1","confidence":0.97,"verify":true,"reason":"x"}');
    expect(r?.propose_alias).toBeNull();
  });

  it('parseResponse rejects malformed propose_alias (string instead of object)', () => {
    const r = parseResponse('{"flashscore_id":"fs1","confidence":0.97,"verify":false,"reason":"x","propose_alias":"psg=paris"}');
    expect(r?.propose_alias).toBeNull();
  });

  it('parseResponse rejects propose_alias with missing canonical', () => {
    const r = parseResponse('{"flashscore_id":"fs1","confidence":0.97,"verify":false,"reason":"x","propose_alias":{"alias":"psg"}}');
    expect(r?.propose_alias).toBeNull();
  });

  it('parseResponse rejects propose_alias when alias === canonical (no-op)', () => {
    const r = parseResponse('{"flashscore_id":"fs1","confidence":0.97,"verify":false,"reason":"x","propose_alias":{"alias":"milan","canonical":"milan"}}');
    expect(r?.propose_alias).toBeNull();
  });

  it('parseResponse rejects propose_alias with too-short fields', () => {
    const r = parseResponse('{"flashscore_id":"fs1","confidence":0.97,"verify":false,"reason":"x","propose_alias":{"alias":"a","canonical":"b"}}');
    expect(r?.propose_alias).toBeNull();
  });
});
