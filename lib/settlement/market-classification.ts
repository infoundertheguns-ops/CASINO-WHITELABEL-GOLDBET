// lib/settlement/market-classification.ts

export type Category = 'score' | 'stats' | 'player' | 'special';

/**
 * MARKET_CATEGORIES — sample dict of canonical IT market_type strings, used for
 * `market_categories_seed` table seeding + observability KPI roll-up.
 *
 * NOT the authoritative classifier — `classify()` below uses regex patterns
 * because actual prod labels include lines/abbreviations/variants that no
 * literal-key dict can enumerate (e.g. "U/O 2.75", "Handicap -1.5",
 * "Totale 1° squadra 0.5", "1X2 - 1T", "DC", "P/D"). Patterns are the source
 * of truth; the dict is a documented sample.
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

/**
 * Pattern-based classifier — handles real-world label variations that include
 * unbounded lines (U/O 2.75, Handicap -1.5), abbreviations (DC, DNB, P/D),
 * and embedded line suffixes (Totale 1° squadra 1.5, U/O - 2T 1.5).
 *
 * Order matters: special → player → stats → score → unknown.
 *   - "Tiri Giocatore" must hit player BEFORE stats matches "Tiri".
 *   - "Totale Corner" must hit stats BEFORE score matches "Totale".
 *
 * Patterns are case-sensitive; labels arrive already normalized in IT.
 */
const SPECIAL_PATTERNS = [
  /^Metodo Goal\b/,
  /^Primi 10 Minuti\b/,
  /^First 10\b/i,
  /^Specials?\b/,
];

const PLAYER_PATTERNS = [
  /Marcator/i,                    // Marcatore, Multi Marcatori, Marcatore Squadra X
  /\bGiocatore\b/i,               // Tiri Giocatore, Falli ... Giocatore, Tackles Giocatore
  /\bMarca o Assist\b/i,
  /\bAnytime\b/i,                 // English fallback
  /\bPlayer\b/i,                  // English fallback
];

const STATS_PATTERNS = [
  /\bCorner\b/i,                  // Corner, Totale Corner, U/O Corner X.X, Corner Squadra X
  /\bCartellin/i,                 // Cartellini, Totale Cartellini, U/O Cartellini X.X
  /\bTackles\b/i,                 // Tackles Totali, Tackles Squadra X (NOT Tackles Giocatore — caught by player above)
  /\bSalvataggi\b/i,              // Salvataggi Portiere
  /\bFalli\b/i,                   // Falli Totali, Falli Squadra X (NOT Falli ... Giocatore — caught above)
  /\bTiri Totali\b/i,
  /\bTiri in Porta\b/i,           // Tiri in Porta, Tiri in Porta Casa/Trasferta (NOT ... Giocatore)
  /\bTiri Squadra\b/i,
];

const SCORE_PATTERNS = [
  /^1X2\b/,
  /^U\/O\b/,                      // U/O 2.5, U/O 3.25, U/O - 2T 1.5
  /^GG\/NG\b/,
  /^DC\b/,                        // Doppia Chance abbreviated
  /^Doppia\b/i,                   // Doppia Chance full
  /^DNB\b/,                       // Pareggio Escluso abbreviated
  /^Pareggio\b/i,                 // Pareggio Escluso full
  /^HT\/FT\b/,
  /^Vincente\b/i,                 // Vincente Incontro / ML
  /^P\/D\b/,                      // Pari/Dispari abbreviated
  /^Pari\/Dispari\b/i,
  /^Numero Goal\b/i,
  /^Esatto\b/i,                   // Esatto / Risultato Esatto
  /^Risultato\b/i,                // Risultato Esatto / Risultato Finale
  /^Linea Goal\b/i,
  /^Goal\/No Goal\b/i,
  /^Totale\b/i,                   // Totale Goal Squadra X / Totale 1° squadra X.X
  /^Handicap\b/i,                 // Handicap -1.5, Handicap 2 (asian/european both numeric line)
  /^Spread\b/i,
  /^Multigol\b/i,
];

function matchesAny(s: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(s));
}

/**
 * classify(market_type) — pattern-based with strict ordering.
 * Returns 'special' for unrecognized labels (fail-safe: derive filter excludes them).
 */
export function classify(market_type: string): Category {
  const s = market_type.trim();
  if (!s) return 'special';
  if (matchesAny(s, SPECIAL_PATTERNS)) return 'special';
  if (matchesAny(s, PLAYER_PATTERNS)) return 'player';
  if (matchesAny(s, STATS_PATTERNS)) return 'stats';
  if (matchesAny(s, SCORE_PATTERNS)) return 'score';
  return 'special';
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
