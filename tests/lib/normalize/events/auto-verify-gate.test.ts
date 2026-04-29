// Unit tests for the shouldAutoVerify() gate (lib/normalize/events/types.ts).
//
// Decision matrix tested:
//   stage             | confidence | llm_verify | expected
//   ------------------+-----------+-----------+----------
//   flashscore_native | any       | n/a       | true   (always)
//   manual            | any       | n/a       | true   (always)
//   propagation       | any       | n/a       | true   (always)
//   regex             | >= 0.97   | n/a       | true
//   regex             | <  0.97   | n/a       | false
//   trigram           | >= 0.97   | n/a       | true
//   trigram           | <  0.97   | n/a       | false
//   alias_dict        | >= 0.97   | n/a       | true
//   alias_dict        | <  0.97   | n/a       | false
//   llm               | >= 0.95   | true      | true   (dual gate satisfied)
//   llm               | >= 0.95   | false     | false  (verify gate)
//   llm               | <  0.95   | true      | false  (conf gate)
//   llm               | any       | undefined | false
//   any               | any (no flashscore_id) | n/a | false

import { describe, it, expect } from 'vitest';
import { shouldAutoVerify } from '@/lib/normalize/events/types';
import type { MatchResult, MatchStage } from '@/lib/normalize/events/types';

function r(stage: MatchStage | 'unmapped', confidence: number, opts: Partial<MatchResult> = {}): MatchResult {
  return {
    flashscore_id: opts.flashscore_id !== undefined ? opts.flashscore_id : 'fs-stub',
    stage,
    confidence,
    ...opts,
  };
}

describe('shouldAutoVerify — always-verify stages', () => {
  it('flashscore_native verifies regardless of confidence', () => {
    expect(shouldAutoVerify(r('flashscore_native', 0.0))).toBe(true);
    expect(shouldAutoVerify(r('flashscore_native', 1.0))).toBe(true);
  });
  it('manual verifies regardless of confidence', () => {
    expect(shouldAutoVerify(r('manual', 0.5))).toBe(true);
  });
  it('propagation verifies regardless of confidence', () => {
    expect(shouldAutoVerify(r('propagation', 0.5))).toBe(true);
  });
});

describe('shouldAutoVerify — threshold-based stages (0.97 gate)', () => {
  it('regex 0.97 → verifies', () => {
    expect(shouldAutoVerify(r('regex', 0.97))).toBe(true);
  });
  it('regex 0.96999 → does not verify', () => {
    expect(shouldAutoVerify(r('regex', 0.96999))).toBe(false);
  });
  it('trigram 0.99 → verifies', () => {
    expect(shouldAutoVerify(r('trigram', 0.99))).toBe(true);
  });
  it('trigram 0.95 → does not verify (below 0.97)', () => {
    expect(shouldAutoVerify(r('trigram', 0.95))).toBe(false);
  });
  it('alias_dict 0.98 → verifies', () => {
    expect(shouldAutoVerify(r('alias_dict', 0.98))).toBe(true);
  });
});

describe('shouldAutoVerify — LLM dual gate (conf>=0.95 AND llm_verify=true)', () => {
  it('llm 0.95 + verify=true → verifies', () => {
    expect(shouldAutoVerify(r('llm', 0.95, { llm_verify: true }))).toBe(true);
  });
  it('llm 0.99 + verify=true → verifies', () => {
    expect(shouldAutoVerify(r('llm', 0.99, { llm_verify: true }))).toBe(true);
  });
  it('llm 0.99 + verify=false → does NOT verify (verify gate)', () => {
    expect(shouldAutoVerify(r('llm', 0.99, { llm_verify: false }))).toBe(false);
  });
  it('llm 0.94 + verify=true → does NOT verify (conf gate)', () => {
    expect(shouldAutoVerify(r('llm', 0.94, { llm_verify: true }))).toBe(false);
  });
  it('llm 0.99 + verify=undefined → does NOT verify (missing field)', () => {
    expect(shouldAutoVerify(r('llm', 0.99))).toBe(false);
  });
});

describe('shouldAutoVerify — guards', () => {
  it('null flashscore_id never verifies', () => {
    expect(shouldAutoVerify(r('regex', 1.0, { flashscore_id: null }))).toBe(false);
    expect(shouldAutoVerify(r('llm', 1.0, { flashscore_id: null, llm_verify: true }))).toBe(false);
  });
  it('unmapped stage never verifies', () => {
    expect(shouldAutoVerify(r('unmapped', 0.0, { flashscore_id: null }))).toBe(false);
    // even with bogus flashscore_id, unmapped should not verify
    expect(shouldAutoVerify({
      flashscore_id: 'fs-stub', stage: 'unmapped', confidence: 0.99,
    })).toBe(false);
  });
});
