// tests/lib/settlement/market-classification.test.ts
import { describe, expect, it } from 'vitest';
import {
  classify,
  MARKET_CATEGORIES,
  isScoreOnly,
  requiresStats,
  requiresPlayer,
  isExposable,
  type Category,
} from '@/lib/settlement/market-classification';

describe('market-classification', () => {
  describe('score-only markets', () => {
    const scoreMarkets = [
      '1X2', 'U/O 2.5', 'GG/NG', 'Doppia Chance',
      'Vincente Incontro', 'Esatto', 'Risultato Esatto',
      'Pari/Dispari Goal', 'Numero Goal', 'Handicap Asiatico',
      'HT/FT', 'Spread', 'U/O 2.5 1T', 'GG/NG 1T',
    ];
    it.each(scoreMarkets)('classifies "%s" as score', (mt) => {
      expect(classify(mt)).toBe('score');
      expect(isScoreOnly(mt)).toBe(true);
    });
  });

  describe('stats markets', () => {
    const statsMarkets = [
      'Corner', 'Totale Corner', 'U/O Corner 9.5',
      'Cartellini', 'Totale Cartellini', 'U/O Cartellini 4.5',
      'Tiri Totali', 'Tiri in Porta', 'Salvataggi Portiere',
      'Tackles Totali',
    ];
    it.each(statsMarkets)('classifies "%s" as stats', (mt) => {
      expect(classify(mt)).toBe('stats');
      expect(requiresStats(mt)).toBe(true);
    });
  });

  describe('player markets', () => {
    const playerMarkets = [
      'Marcatore', 'Multi Marcatori', 'Marcatore Squadra Casa',
      'Tiri Giocatore', 'Falli Subiti Giocatore',
      'Marca o Assist',
    ];
    it.each(playerMarkets)('classifies "%s" as player', (mt) => {
      expect(classify(mt)).toBe('player');
      expect(requiresPlayer(mt)).toBe(true);
    });
  });

  describe('special markets', () => {
    it('classifies "Metodo Goal" as special', () => {
      expect(classify('Metodo Goal')).toBe('special');
    });
    it('classifies "Primi 10 Minuti" as special', () => {
      expect(classify('Primi 10 Minuti')).toBe('special');
    });
  });

  describe('fail-safe', () => {
    it('classifies unknown market as "special" with no error', () => {
      expect(classify('Some Future Brand New Market')).toBe('special');
    });
    it('exposes the dict as a frozen const', () => {
      expect(() => {
        // @ts-expect-error - runtime mutation should fail
        MARKET_CATEGORIES['1X2'] = 'stats';
      }).toThrow();
    });
  });

  describe('coverage completeness', () => {
    it('every market in dict has valid category', () => {
      const validCategories: Category[] = ['score', 'stats', 'player', 'special'];
      for (const [mt, cat] of Object.entries(MARKET_CATEGORIES)) {
        expect(validCategories).toContain(cat);
      }
    });
    it('dict has at least 50 entries (full catalog)', () => {
      expect(Object.keys(MARKET_CATEGORIES).length).toBeGreaterThanOrEqual(50);
    });
  });

  describe('isExposable (filter-at-exposure rule)', () => {
    it('exposes score markets regardless of flashscore mapping', () => {
      expect(isExposable('1X2', false)).toBe(true);
      expect(isExposable('1X2', true)).toBe(true);
      expect(isExposable('U/O 2.5', false)).toBe(true);
      expect(isExposable('Risultato Esatto', false)).toBe(true);
    });

    it('exposes stats markets ONLY when event has flashscore_id', () => {
      expect(isExposable('Corner', true)).toBe(true);
      expect(isExposable('Corner', false)).toBe(false);
      expect(isExposable('Totale Cartellini', true)).toBe(true);
      expect(isExposable('Totale Cartellini', false)).toBe(false);
    });

    it('exposes player markets ONLY when event has flashscore_id', () => {
      expect(isExposable('Marcatore', true)).toBe(true);
      expect(isExposable('Marcatore', false)).toBe(false);
      expect(isExposable('Tiri Giocatore', true)).toBe(true);
      expect(isExposable('Tiri Giocatore', false)).toBe(false);
    });

    it('never exposes special markets, regardless of flashscore mapping', () => {
      expect(isExposable('Metodo Goal', true)).toBe(false);
      expect(isExposable('Metodo Goal', false)).toBe(false);
      expect(isExposable('Specials', true)).toBe(false);
    });

    it('never exposes unknown markets (fail-safe)', () => {
      expect(isExposable('Some Future Brand New Market', true)).toBe(false);
      expect(isExposable('Some Future Brand New Market', false)).toBe(false);
    });
  });
});
