// lib/settlement/market-classification.ts

export type Category = 'score' | 'stats' | 'player' | 'special';

/**
 * MARKET_CATEGORIES — single source of truth for market → category mapping.
 *
 * Keys are Italian market_type strings as produced by derive_legacy_from_v2()
 * RPC (mig 146 + translations mig 149). Values are categories that drive
 * settlement routing and admin page display.
 *
 * NEVER mutate at runtime. Updates require:
 *   1. edit this dict
 *   2. run `npm run build:market-categories` to regenerate seed JSON
 *   3. include the regenerated JSON + a migration row insert in the same PR
 */
export const MARKET_CATEGORIES: Readonly<Record<string, Category>> = Object.freeze({
  // ========== 🟢 SCORE-ONLY (settable from events_v2.score_home/away + period_scores) ==========
  '1X2': 'score',
  '1X2 1T': 'score',
  '1X2 2T': 'score',
  'Vincente Incontro': 'score',  // ML alias
  'Doppia Chance': 'score',
  'Doppia Chance 1T': 'score',
  'Doppia Chance 2T': 'score',
  'Pareggio Escluso': 'score',  // DNB
  'Handicap Asiatico': 'score',
  'Handicap Europeo': 'score',
  'Spread': 'score',
  'Spread 1T': 'score',
  'Spread 2T': 'score',
  'U/O 0.5': 'score', 'U/O 1.5': 'score', 'U/O 2.5': 'score',
  'U/O 3.5': 'score', 'U/O 4.5': 'score', 'U/O 5.5': 'score',
  'U/O 0.5 1T': 'score', 'U/O 1.5 1T': 'score', 'U/O 2.5 1T': 'score',
  'U/O 0.5 2T': 'score', 'U/O 1.5 2T': 'score',
  'GG/NG': 'score',
  'GG/NG 1T': 'score',
  'GG/NG 2T': 'score',
  'HT/FT': 'score',
  'Risultato Esatto': 'score',
  'Risultato Esatto 1T': 'score',
  'Esatto': 'score',  // alias
  'Numero Goal': 'score',
  'Pari/Dispari Goal': 'score',
  'Pari/Dispari': 'score',
  'Goal/No Goal Squadra Casa': 'score',
  'Goal/No Goal Squadra Trasferta': 'score',
  'Totale Goal Squadra Casa': 'score',
  'Totale Goal Squadra Trasferta': 'score',
  'Risultato Finale': 'score',  // 1X2 alias
  'Linea Goal': 'score',  // alternative goal line

  // ========== 🟡 STATS (need corners/cards/shots/tackles count from FS) ==========
  'Corner': 'stats',
  'Totale Corner': 'stats',
  'Corner 2-Way': 'stats',
  'Corner Race': 'stats',
  'Corner Spread': 'stats',
  'Corner Handicap': 'stats',
  'U/O Corner 7.5': 'stats', 'U/O Corner 8.5': 'stats', 'U/O Corner 9.5': 'stats',
  'U/O Corner 10.5': 'stats', 'U/O Corner 11.5': 'stats', 'U/O Corner 12.5': 'stats',
  'Corner 1T': 'stats',
  'Totale Corner 1T': 'stats',
  'Corner Squadra Casa': 'stats',
  'Corner Squadra Trasferta': 'stats',
  'Cartellini': 'stats',
  'Totale Cartellini': 'stats',
  'U/O Cartellini 3.5': 'stats', 'U/O Cartellini 4.5': 'stats', 'U/O Cartellini 5.5': 'stats',
  'Tiri Totali': 'stats',
  'Tiri in Porta': 'stats',
  'Tiri Squadra Casa': 'stats', 'Tiri Squadra Trasferta': 'stats',
  'Tiri in Porta Casa': 'stats', 'Tiri in Porta Trasferta': 'stats',
  'Salvataggi Portiere': 'stats',
  'Tackles Totali': 'stats',
  'Tackles Squadra Casa': 'stats', 'Tackles Squadra Trasferta': 'stats',

  // ========== 🔴 PLAYER (need who-scored/assists/cards-per-player from FS) ==========
  'Marcatore': 'player',  // Anytime Goalscorer
  'Primo Marcatore': 'player',
  'Ultimo Marcatore': 'player',
  'Multi Marcatori': 'player',
  'Marcatore Squadra Casa': 'player',
  'Marcatore Squadra Trasferta': 'player',
  'Marca o Assist': 'player',
  'Tiri Giocatore': 'player',
  'Tiri in Porta Giocatore': 'player',
  'Falli Commessi Giocatore': 'player',
  'Falli Subiti Giocatore': 'player',
  'Tackles Giocatore': 'player',

  // ========== 🚫 SPECIAL (filtered at derive in v2 — never exposed to player) ==========
  'Metodo Goal': 'special',
  'Primi 10 Minuti': 'special',
  'Specials': 'special',
});

export function classify(market_type: string): Category {
  // Trimmed lookup with fail-safe fallback to 'special' (filtered at derive — never exposed)
  const trimmed = market_type.trim();
  return MARKET_CATEGORIES[trimmed] ?? 'special';
}

/**
 * isExposable — used by derive_legacy_from_v2() (via mig 154 SQL helper) to decide
 * whether a market_v2 row should be projected to the legacy `markets` table.
 *
 * Rule: score always exposable; stats/player only on FS-mapped events; special always filtered.
 */
export function isExposable(market_type: string, eventHasFlashscoreId: boolean): boolean {
  const cat = classify(market_type);
  if (cat === 'score') return true;
  if (cat === 'stats' || cat === 'player') return eventHasFlashscoreId;
  return false;  // special or unclassified → fail-safe: don't expose
}

export function isScoreOnly(market_type: string): boolean {
  return classify(market_type) === 'score';
}

export function requiresStats(market_type: string): boolean {
  return classify(market_type) === 'stats';
}

export function requiresPlayer(market_type: string): boolean {
  return classify(market_type) === 'player';
}

/** Returns true when settlement requires Flashscore (or any external stats source). */
export function requiresExternalStats(market_type: string): boolean {
  const cat = classify(market_type);
  return cat === 'stats' || cat === 'player';
}
