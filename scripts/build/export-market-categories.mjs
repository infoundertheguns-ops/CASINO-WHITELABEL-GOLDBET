// scripts/build/export-market-categories.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Use tsx to import TS file directly
const { MARKET_CATEGORIES } = await import('../../lib/settlement/market-classification.ts');

const output = {
  __generated__: new Date().toISOString(),
  __source__: 'lib/settlement/market-classification.ts',
  categories: MARKET_CATEGORIES,
  count: Object.keys(MARKET_CATEGORIES).length,
};

const dest = resolve(import.meta.dirname, '../../lib/settlement/market-categories-seed.json');
writeFileSync(dest, JSON.stringify(output, null, 2) + '\n');

console.log(`✔ exported ${output.count} categories to ${dest}`);
