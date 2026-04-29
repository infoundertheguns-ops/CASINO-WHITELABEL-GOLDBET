// tests/lib/admin/canonicalization-signals.test.ts
import { describe, it, expect } from 'vitest';
import {
  signalToIcon,
  signalToTooltip,
  pctToColor,
  formatPct,
} from '@/lib/admin/canonicalization-signals';

describe('signalToIcon', () => {
  it('returns ✅ for ok / ok_verified', () => {
    expect(signalToIcon('ok')).toBe('✅');
    expect(signalToIcon('ok_verified')).toBe('✅');
  });
  it('returns ⚠️ for variant', () => {
    expect(signalToIcon('variant')).toBe('⚠️');
  });
  it('returns ❌ for absent_problem', () => {
    expect(signalToIcon('absent_problem')).toBe('❌');
  });
  it('returns ✓ for absent_ok', () => {
    expect(signalToIcon('absent_ok')).toBe('✓');
  });
  it('returns 🚧 for feature_pending', () => {
    expect(signalToIcon('feature_pending')).toBe('🚧');
  });
  it('returns 🔗 for ok_synthetic', () => {
    // Sprint 3 Phase A: cross-source canonical_id assigned by mig 126 RPC.
    expect(signalToIcon('ok_synthetic')).toBe('🔗');
  });
  it('returns 🔒 for structural_source_only', () => {
    // Sprint 3 Phase B: events.is_source_only=true (mig 129 classifier).
    expect(signalToIcon('structural_source_only')).toBe('🔒');
  });
});

describe('signalToTooltip', () => {
  it('returns Italian descriptions', () => {
    expect(signalToTooltip('ok')).toContain('canonicalizzato');
    expect(signalToTooltip('variant')).toContain('variant');
    expect(signalToTooltip('feature_pending')).toContain('roadmap');
  });
  it('mentions sintetica/cross-source for ok_synthetic', () => {
    expect(signalToTooltip('ok_synthetic')).toMatch(/sintetic|cross-source/i);
  });
  it('mentions Flashscore exclusion for structural_source_only', () => {
    expect(signalToTooltip('structural_source_only')).toMatch(/Flashscore|source-only|mappabili/i);
  });
});

describe('pctToColor', () => {
  it('green at >=90%', () => {
    expect(pctToColor(90)).toBe('green');
    expect(pctToColor(100)).toBe('green');
  });
  it('yellow 60-90%', () => {
    expect(pctToColor(60)).toBe('yellow');
    expect(pctToColor(89.9)).toBe('yellow');
  });
  it('red below 60%', () => {
    expect(pctToColor(0)).toBe('red');
    expect(pctToColor(59.9)).toBe('red');
  });
  it('gray for null/undefined', () => {
    expect(pctToColor(null as any)).toBe('gray');
  });
});

describe('formatPct', () => {
  it('1 decimal place with %', () => {
    expect(formatPct(54.0)).toBe('54.0%');
    expect(formatPct(99.95)).toBe('99.9%'); // truncate, not round
  });
  it('handles 0 and 100', () => {
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(100)).toBe('100.0%');
  });
});
