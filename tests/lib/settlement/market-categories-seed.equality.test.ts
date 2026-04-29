import { describe, expect, it } from 'vitest';
import seedJson from '@/lib/settlement/market-categories-seed.json';
import { MARKET_CATEGORIES } from '@/lib/settlement/market-classification';

describe('market-categories-seed.json equality', () => {
  it('has same key count as TS dict', () => {
    expect(Object.keys(seedJson.categories).length).toBe(Object.keys(MARKET_CATEGORIES).length);
  });
  it('every TS entry is in seed JSON with same category', () => {
    for (const [mt, cat] of Object.entries(MARKET_CATEGORIES)) {
      expect(seedJson.categories[mt]).toBe(cat);
    }
  });
  it('every seed entry is in TS dict', () => {
    for (const mt of Object.keys(seedJson.categories)) {
      expect(MARKET_CATEGORIES[mt as keyof typeof MARKET_CATEGORIES]).toBeDefined();
    }
  });
});
