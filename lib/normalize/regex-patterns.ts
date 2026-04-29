import type { ParsedMarketType } from "./types";
import { normalizePeriod } from "./period";

// Rule: each entry has a regex. First capture group is the period fragment (optional),
// second capture group (if present) is a numeric line. base_key is fixed per rule.
// Rules are tried top-to-bottom; first match wins.
const RULES: Array<{
  base_key: string;
  pattern: RegExp;
  linePos?: number;
  periodPos?: number;
}> = [
  // --- Asian U/O (quarter lines .25/.75) — legacy emits plain "U/O" even for asian
  // lines, so route explicitly to asian_total canonical for cross-source consensus
  // with legacy's "Totale Asiatico N". Rules must precede the generic U/O rules. ---
  { base_key: "asian_total",  pattern: /^U\/O(?:\s+(\d\s*T|\d°\s*Tempo))?\s+(\d+\.(?:25|75))$/i, periodPos: 1, linePos: 2 },
  { base_key: "asian_total",  pattern: /^U\/O\s+(\d+\.(?:25|75))(?:\s+-?\s*(.+))?$/i,          linePos: 1, periodPos: 2 },

  // --- U/O (explicit: period can come before or after line) ---
  // Wave 14: "U/O Incl. Supp. N" legacy OT abbreviated form → u_o_et.
  // Must precede the plain U/O rules so "Incl. Supp." isn't eaten by `([\d.]+)`.
  { base_key: "u_o",          pattern: /^U\/O\s+(Incl\.\s*Supp\.)\s+([\d.]+)$/i, periodPos: 1, linePos: 2 },
  { base_key: "u_o",          pattern: /^U\/O(?:\s+(\d\s*T|\d°\s*Tempo))?\s+([\d.]+)$/i, periodPos: 1, linePos: 2 },
  { base_key: "u_o",          pattern: /^U\/O\s+([\d.]+)(?:\s+-?\s*(.+))?$/i,         linePos: 1, periodPos: 2 },

  // Wave 14: legacy "Totale gol - <period> N.5" (period = "Supplementari inclusi" /
  // "1° Periodo" / "1° tempo" / etc.) → u_o_{ft|1h|2h|3h|4h|et}.
  // Covers OT totals AND hockey period totals (legacy slice 300-400 patterns).
  { base_key: "u_o",          pattern: /^Totale\s+gol\s+-\s+(.+?)\s+([\d.]+)$/i, periodPos: 1, linePos: 2 },

  // --- legacy 1X2 Asian Handicap: "1X2 Asian H (-1)", "1X2 Asian H (-1) - 2T" ---
  // NB: must precede the plain "1X2 H" rule so "Asian" isn't mis-parsed by it.
  { base_key: "asian_handicap", pattern: /^1X2\s+Asian\s+H\s+\(([+-]?[\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // --- 1X2 Handicap: "1X2 H (-1.5)", "1X2 H (-1) - 2T", "1X2 H (0) 1° Tempo" ---
  { base_key: "1x2_handicap", pattern: /^1X2\s+H\s+\(([+-]?[\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // --- legacy-Italian 1X2 Handicap: "1x2 con Handicap (-1)", "1x2 con Handicap - 1° tempo (-1)" ---
  { base_key: "1x2_handicap", pattern: /^1x2\s+con\s+Handicap(?:\s+-\s+(.+?))?\s+\(([+-]?[\d.]+)\)$/i, linePos: 2, periodPos: 1 },

  // --- Asian handicap (legacy Italian form "Handicap Asiatico (...)" + optional period suffix) ---
  { base_key: "asian_handicap", pattern: /^Handicap\s+Asiatico\s+\(([+-]?[\d.]+)\)(?:\s+(.+))?$/i, linePos: 1, periodPos: 2 },

  // --- Asian handicap legacy period-in-middle: "Handicap Asiatico - 1° tempo (-0.5)" ---
  { base_key: "asian_handicap", pattern: /^Handicap\s+Asiatico\s+-\s+(.+?)\s+\(([+-]?[\d.]+)\)$/i, periodPos: 1, linePos: 2 },

  // --- Asian total legacy period-in-middle: "Totale Asiatico - 1° tempo 1.5" (line without parens) ---
  // Must precede generic "Totale Asiatico N" rule.
  { base_key: "asian_total", pattern: /^Totale\s+Asiatico\s+-\s+(.+?)\s+([\d.]+)$/i, periodPos: 1, linePos: 2 },

  // ═══ Wave 13: basket "Handicap - N° Quarto (±X)" → 2way_handicap (2-way, no draw) ═══
  // MUST precede the generic "Handicap - <period>" rule below, otherwise
  // basket quarter strings would be mis-routed to 1x2_handicap (3-way).
  // Explicit "Quarto" anchor; "tempo"/"Periodo" variants fall through to 1x2_handicap.
  { base_key: "2way_handicap", pattern: /^Handicap\s+-\s+(\d°\s*Quarto|(?:primo|secondo|terzo|quarto)\s+quarto)\s+\(([+-]?[\d.]+)\)$/i, periodPos: 1, linePos: 2 },

  // --- legacy plain handicap "Handicap (-0.5)" / "Handicap - 1° tempo (-0.5)" ---
  // Placed after Asiatico rules so they don't get absorbed. Must come before the generic 1X2 rule.
  { base_key: "1x2_handicap", pattern: /^Handicap\s+-\s+(.+?)\s+\(([+-]?[\d.]+)\)$/i, periodPos: 1, linePos: 2 },
  { base_key: "1x2_handicap", pattern: /^Handicap\s+\(([+-]?[\d.]+)\)(?:\s+-\s+(.+))?$/i, linePos: 1, periodPos: 2 },

  // ═══ Wave 13: legacy basket "Punti totali - N° Quarto X.5" → u_o_{1h-4h} ═══
  // "Punti totali - 1° Quarto 40.5" / "Punti totali - 4° Quarto 41.5"
  { base_key: "u_o", pattern: /^Punti\s+totali\s+-\s+(.+?)\s+([\d.]+)$/i, periodPos: 1, linePos: 2 },

  // --- legacy verbose "Gol segnato in entrambi i tempi" (alias of both_halves_score) ---
  { base_key: "both_halves_score", pattern: /^Gol\s+segnato\s+in\s+entrambi\s+i\s+tempi$/i },

  // --- legacy verbose BTTS with optional period + optional "(Gol/No Gol)" suffix ---
  // e.g. "Entrambe le squadre segnano - 2° tempo (Gol/No Gol)", "Entrambe le squadre segnano - 1° tempo", plain "Entrambe le squadre segnano"
  { base_key: "gg_ng", pattern: /^Entrambe\s+le\s+squadre\s+segnano(?:\s+-\s+([^()]+?))?(?:\s+\(Gol\/No\s+Gol\))?$/i, periodPos: 1 },

  // ═══ Wave 16: high-volume patterns — 95% coverage push (2026-04-21) ═══

  // ── Sì/No clean markets ──
  { base_key: "btts_both_halves",     pattern: /^Entrambe\s+Le\s+Squadre\s+Segnano\s+In\s+Entrambi\s+i\s+Tempi$/i },
  { base_key: "team_goal_combo",      pattern: /^Squadre\s+Goal$/i },
  { base_key: "highest_scoring_half", pattern: /^Tempo\s+Con\s+il\s+Maggior\s+Numero\s+Di\s+Punti$/i },
  { base_key: "way_of_winning",       pattern: /^Modalità\s+Di\s+Vittoria$/i },
  { base_key: "coin_toss_winner",     pattern: /^Chi\s+Vincerà\s+il\s+Lancio\s+Della\s+Monetina$/i },
  { base_key: "red_card_given",       pattern: /^Cartellino\s+rosso\s+assegnato$/i },
  { base_key: "penalty_awarded",      pattern: /^Almeno\s+un\s+calcio\s+di\s+rigore\s+assegnato$/i },
  // Both accents tolerate: "Piú" (acute, legacy variant) and "Più" (grave, standard italian).
  { base_key: "more_cards",           pattern: /^Pi[úù]\s+cartellini$/i },
  { base_key: "more_games",           pattern: /^Pi[úù]\s+giochi$/i },
  { base_key: "draw_and_btts",        pattern: /^Pareggio\s+ed\s+entrambe\s+le\s+squadre\s+a\s+segno(?:\s+\(Gol\/No\s+Gol\))?$/i },
  { base_key: "qualification",        pattern: /^Qualificazione$/i },
  { base_key: "cs_map",               pattern: /^Risultato\s+esatto[:]?\s+Mappa$/i },

  // ── legacy 1X2 aliases → 1x2_ft ──
  { base_key: "1x2", pattern: /^Esito\s+Finale\s+1x2\s+-\s+Tempo\s+regolamentare$/i },
  { base_key: "1x2", pattern: /^Esito\s+dell['']incontro$/i },
  { base_key: "1x2", pattern: /^Match\s+Odds$/i },
  { base_key: "1x2", pattern: /^Tempi\s+regolamentari\s+-\s+1X2$/i },

  // ── legacy DC alias ──
  { base_key: "dc", pattern: /^Doppia\s+Chance\s+-\s+Tempo\s+regolamentare$/i },

  // ── legacy basketball "1° Quarto" / "1° Periodo" (standalone, outcomes 1/X/2) → 1X2 per quarter ──
  // NB: do NOT include "Set" here — 1° Set outcomes are tennis player names (Phase 3 Part 2a).
  { base_key: "1x2", pattern: /^(\d°\s*(?:Quarto|Periodo)|(?:primo|secondo|terzo|quarto)\s+(?:quarto|periodo))$/i, periodPos: 1 },

  // ── legacy basketball "Risultato al termine del N° Quarto" → winner_{1h-4h} ──
  { base_key: "winner", pattern: /^Risultato\s+al\s+termine\s+del\s+(\d°\s*Quarto|(?:primo|secondo|terzo|quarto)\s+quarto)$/i, periodPos: 1 },

  // ── legacy DNB per quarter "Draw No Bet - N° Quarto" ──
  { base_key: "dnb", pattern: /^Draw\s+No\s+Bet\s+-\s+(\d°\s*Quarto|(?:primo|secondo|terzo|quarto)\s+quarto)$/i, periodPos: 1 },

  // ── Maps family (esports) ──
  { base_key: "total_maps",    pattern: /^Totale\s+Mappe\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "total_maps",    pattern: /^Total\s+Maps\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_maps",    pattern: /^Mappe\s+totali\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "maps_handicap", pattern: /^Totale\s+Mappe\s+Handicap\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },
  { base_key: "maps_handicap", pattern: /^(?:Handicap\s+Mappa|Map\s+Handicap)\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },
  { base_key: "maps_oe",       pattern: /^Totale\s+Mappe\s+Pari\/Dispari$/i },
  { base_key: "maps_oe",       pattern: /^Total\s+Maps\s+\(Odd\/Even\)$/i },
  // Single map winner: "Map 1" / "Map 2" / "Mappa 1" / "Mappa 2" → map_winner_ft, line=N
  { base_key: "map_winner",    pattern: /^(?:Map|Mappa)\s+(\d+)$/i, linePos: 1 },

  // ── Tennis total games ──
  { base_key: "total_games",      pattern: /^Totale\s+giochi\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_games_set1", pattern: /^Totale\s+giochi\s+nel\s+1°\s+set\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_games_set2", pattern: /^Totale\s+giochi\s+nel\s+2°\s+set\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_games_set3", pattern: /^Totale\s+giochi\s+nel\s+3°\s+set\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_games_set4", pattern: /^Totale\s+giochi\s+nel\s+4°\s+set\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_games_set5", pattern: /^Totale\s+giochi\s+nel\s+5°\s+set\s+([\d.]+)$/i, linePos: 1 },

  // ── Total cards ──
  { base_key: "total_cards", pattern: /^Totale\s+cartellini\s+([\d.]+)$/i, linePos: 1 },

  // ── Team goals minimum "Entrambe le squadre realizzano almeno N gol - Tempi regolamentari" ──
  { base_key: "team_goals_min", pattern: /^Entrambe\s+le\s+squadre\s+realizzano\s+almeno\s+(\d+)\s+gol(?:\s+-\s+Tempi\s+regolamentari)?$/i, linePos: 1 },

  // ── Totale set N.5 (tennis total sets, alias of total_sets) ──
  { base_key: "total_sets", pattern: /^Totale\s+set\s+([\d.]+)$/i, linePos: 1 },

  // ── First scorer team (trailing-dash permissive) ──
  { base_key: "first_scorer_team", pattern: /^Chi\s+Segnerà\s+il\s+Primo\s+Goal\s+Della\s+Partita\??(?:\s+-?\s*.*)?$/i },

  // ── Gol totali - Tempo Regolamentare N.5 → u_o_ft ──
  { base_key: "u_o", pattern: /^Gol\s+totali\s+-\s+Tempo\s+Regolamentare\s+([\d.]+)$/i, linePos: 1 },

  // ═══ (end wave 16) ═══

  // ═══ Wave 17: compound markets + minute-based + multi-goal (2026-04-21) ═══

  // PT-F + Totale (N) — HTFT + total compound
  { base_key: "htft_and_total", pattern: /^PT-F\s+\+\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Handicap 1/2 + Totale (with or without line and period, trailing-dash permissive)
  // Examples: "Handicap 1 + Totale (2.5)", "Handicap 1 + Totale - 1T", "Handicap 1 + Totale - "
  { base_key: "handicap_and_total", pattern: /^Handicap\s+[12]\s+\+\s+Totale(?:\s+\(([\d.]+)\))?(?:\s+-?\s*(.*))?$/i, linePos: 1, periodPos: 2 },

  // Doppia Chance + Totale (N)
  { base_key: "dc_and_total", pattern: /^Doppia\s+Chance\s+\+\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Entrambe A Segno Sì/No + Totale (N) / Entrambe Le Squadre a Segno + Totale (N) — aliases of btts_and_total
  { base_key: "btts_and_total", pattern: /^Entrambe\s+A\s+Segno\s+S[iì]\/No\s+\+\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "btts_and_total", pattern: /^Entrambe\s+Le\s+Squadre\s+a\s+Segno\s+\+\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Multi Goal family (outcomes scraper-bugged, market_type clean)
  // "Multi Goal" / "Multi Goal - 1T" / "Multi Goal - 2T"
  { base_key: "multi_goal", pattern: /^Multi\s+Goal(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },
  // "Squadra 1, Multi Goal" / "Squadra 2, Multi Goal - 1T" / etc.
  { base_key: "team1_multi_goal", pattern: /^Squadra\s+1,\s+Multi\s+Goal(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },
  { base_key: "team2_multi_goal", pattern: /^Squadra\s+2,\s+Multi\s+Goal(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },

  // Risultato Al Minuto (N) — minute N as canonical_line
  { base_key: "minute_result", pattern: /^Risultato\s+Al\s+Minuto\s+\((\d+)\)(?:\s+-?\s*.*)?$/i, linePos: 1 },

  // Tempo Del Primo Goal — grid
  { base_key: "time_of_first_goal", pattern: /^Tempo\s+Del\s+Primo\s+Goal$/i },

  // Totale Goal Nei Tempi (N.5) — halves both U/O
  { base_key: "halves_both_ou", pattern: /^Totale\s+Goal\s+Nei\s+Tempi\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Tennis first serve hold "Vince Il Suo Primo Turno Di Servizio - 1T/2T"
  { base_key: "first_serve_hold", pattern: /^Vince\s+Il\s+Suo\s+Primo\s+Turno\s+Di\s+Servizio(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },

  // Goal Intervallo variants (market canonicalize only — outcomes scraper-bugged)
  { base_key: "goal_interval", pattern: /^Goal\s+Intervallo(?:\s+-\s+(?:S[iì]|No))?(?:\s+\([\d.]+\))?$/i },
  { base_key: "goal_interval", pattern: /^Goal\s+Nell['']intervallo\s+Di\s+Tempo(?:\s+-\s+S[iì]\/No)?(?:\s+\([\d.]+\))?$/i },

  // Vittoria Di (no line, outcomes scraper-bugged) → win_by_margin_grid_ft
  { base_key: "win_by_margin_grid", pattern: /^Vittoria\s+Di$/i },

  // ═══ (end wave 17) ═══

  // ═══ Wave 18: additional families (2026-04-21) ═══

  // Gol Nel Tempo → first_goal_half_ft (3-way: none / 1° Tempo / 2° Tempo)
  { base_key: "first_goal_half", pattern: /^Gol\s+Nel\s+Tempo$/i },

  // Momento In Cui Viene Realizzato Il Secondo Goal → second_goal_time_ft (grid, outcomes bugged)
  { base_key: "second_goal_time", pattern: /^Momento\s+In\s+Cui\s+Viene\s+Realizzato\s+Il\s+Secondo\s+Goal$/i },

  // Individuale Totale 1/2 Numero Esatto Di Goal (N) - 1T/2T → team{1|2}_exact_goals_{1h|2h}
  { base_key: "team1_exact_goals", pattern: /^Individuale\s+Totale\s+1\s+Numero\s+Esatto\s+Di\s+Goal\s+\(\d+\)\s+-\s+(1T|2T)$/i, periodPos: 1 },
  { base_key: "team2_exact_goals", pattern: /^Individuale\s+Totale\s+2\s+Numero\s+Esatto\s+Di\s+Goal\s+\(\d+\)\s+-\s+(1T|2T)$/i, periodPos: 1 },

  // Numero Esatto - 1T/2T (halves exact total, outcomes bugged)
  { base_key: "exact_total_halves", pattern: /^Numero\s+Esatto\s+-\s+(1T|2T)$/i, periodPos: 1 },

  // Totale Esatto (- trailing) → exact_total_grid_ft
  { base_key: "exact_total_grid", pattern: /^Totale\s+Esatto(?:\s+-\s*)?$/i },

  // Set / Partita → set_match_combo_ft
  { base_key: "set_match_combo", pattern: /^Set\s+\/\s+Partita$/i },

  // Individuale Totale 1/2 Pari /Dispari - 1T/2T → team{1|2}_total_oe_{1h|2h}
  { base_key: "team1_total_oe", pattern: /^Individuale\s+Totale\s+1\s+Pari\s*\/\s*Dispari\s+-\s+(1T|2T)$/i, periodPos: 1 },
  { base_key: "team2_total_oe", pattern: /^Individuale\s+Totale\s+2\s+Pari\s*\/\s*Dispari\s+-\s+(1T|2T)$/i, periodPos: 1 },

  // Vittoria Di (N) - 1T/2T → win_by_margin line=N with period
  { base_key: "win_by_margin", pattern: /^Vittoria\s+Di\s+\((\d+)\)\s+-\s+(1T|2T)$/i, linePos: 1, periodPos: 2 },

  // Vittoria o Pareggio Al Minuto (N) → minute_win_or_draw_ft line=N
  { base_key: "minute_win_or_draw", pattern: /^Vittoria\s+o\s+Pareggio\s+Al\s+Minuto\s+\((\d+)\)$/i, linePos: 1 },

  // Totale Al Minuto family (market canonicalize only — outcomes scraper-bugged)
  { base_key: "minute_total_grid", pattern: /^Totale\s+Al\s+Minuto(?:\s+\([\d.]+\))?(?:\s+-?\s*.*)?$/i },

  // Segna In Entrambi i Tempi - (trailing dash, alias of both_halves_score)
  { base_key: "both_halves_score", pattern: /^Segna\s+In\s+Entrambi\s+i\s+Tempi(?:\s+-\s*)?$/i },

  // Prossimo Calcio D'angolo (1) - (trailing dash, alias of next_corner)
  { base_key: "next_corner", pattern: /^Prossimo\s+Calcio\s+D['']angolo\s+\((\d+)\)(?:\s+-\s*)?$/i, linePos: 1 },

  // ═══ (end wave 18) ═══

  // ═══ Wave 19: legacy Opta + legacy esports/tennis/tournament/corners (2026-04-21) ═══

  // ── legacy Opta player scorer props ──
  { base_key: "player_scores_goals", pattern: /^Segna\s+almeno\s+(\d+)\s+gol\s+\d+$/i, linePos: 1 },
  { base_key: "player_scores_goals", pattern: /^Segna\s+(\d+)$/i, linePos: 1 },
  { base_key: "player_scores_header", pattern: /^Segna\s+di\s+testa\s+(\d+)$/i, linePos: 1 },
  { base_key: "player_scores_outside", pattern: /^Segna\s+da\s+fuori\s+area\s+(\d+)$/i, linePos: 1 },
  { base_key: "player_assists", pattern: /^Fornisce\s+un\s+assist(?:\s+\([^)]+\))?\s+(\d+)$/i, linePos: 1 },
  { base_key: "player_scores_or_assists", pattern: /^Segna\s+o\s+passa\s+un\s+assist(?:\s+\([^)]+\))?\s+(\d+)$/i, linePos: 1 },
  { base_key: "player_booked", pattern: /^Riceve\s+un\s+cartellino\s+(\d+)$/i, linePos: 1 },
  { base_key: "player_red_card", pattern: /^Prende\s+un\s+cartellino\s+rosso\s+(\d+)$/i, linePos: 1 },
  { base_key: "player_shots_on_target", pattern: /^Tiri\s+del\s+giocatore\s+nello\s+specchio\s+della\s+porta(?:\s+\([^)]+\))?\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_shots_on_target", pattern: /^Totale\s+tiri\s+in\s+porta(?:\s+\([^)]+\))?\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "more_shots_on_target", pattern: /^Pi[úù]\s+tiri\s+in\s+porta(?:\s+\([^)]+\))?$/i },
  { base_key: "woodwork_hit", pattern: /^Woodwork\s+to\s+be\s+Hit\s+in\s+the\s+Match(?:\s+\([^)]+\))?$/i },

  // ── legacy esports ──
  { base_key: "first_blood", pattern: /^Primo\s+Sangue(?:\s+-\s+(1T|2T|3T))?$/i, periodPos: 1 },
  { base_key: "nashor", pattern: /^Chi\s+Batterà\s+Nashor\s+\((\d+)\)(?:\s+-\s+(1T|2T))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "inhibitor_destroyed", pattern: /^Totale\s+Inhibitor\s+Distrutti\.?\s+\(([\d.]+)\)(?:\s+-\s+(1T|2T))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "frag_race", pattern: /^Frag,\s+Sfida\s+Al\s+\((\d+)\)(?:\s+-\s+(1T|2T))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "frag_total_oe", pattern: /^Frag,\s+Totale\s+Pari\/Dispari(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },
  { base_key: "round_total_oe", pattern: /^Totale\s+Round\s+Pari\s*\/\s*Dispari(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },

  // ── legacy tennis compound ──
  { base_key: "point_score_first_serve", pattern: /^Giocatore\s+[12],\s+Punteggio\s+Del\s+1°\s+Servizio\s+\(([\d.]+)\)\s+-\s+(1T|2T)$/i, linePos: 1, periodPos: 2 },
  { base_key: "serve_hold_with_score", pattern: /^Vince\s+Il\s+Suo\s+Primo\s+Turno\s+Di\s+Servizio\s+Col\s+Punteggio(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },
  { base_key: "games_race", pattern: /^Sfida\s+Al\s+\((\d+)\)\s+-\s+(1T|2T)$/i, linePos: 1, periodPos: 2 },

  // ── legacy tournament-level ──
  { base_key: "tournament_most_scoring_match", pattern: /^Partita\s+Con\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s*Totale\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "tournament_least_scoring_match", pattern: /^Partita\s+Con\s+il\s+Minor\s+Numero\s+di\s+Marcature\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "tournament_most_scoring_team", pattern: /^Squadra\s+Che\s+Realizza\s+il\s+Maggior\s+Numero\s+Di\s+Marcature\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "tournament_least_scoring_team", pattern: /^Squadra\s+Che\s+Realizza\s+il\s+Minor\s+Numero\s+Di\s+Marcature\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "tournament_highest_away_score", pattern: /^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+In\s+Trasferta\s+Totale\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "tournament_matches_overunder", pattern: /^Totale\s+Partite\s+Con\s+Over\/Under$/i },

  // ── legacy corner intervals ──
  { base_key: "corner_interval", pattern: /^Calcio\s+D['']angolo\s+Dal\s+Minuto\s+Al\s+Minuto(?:\s+\([\d.]+\))?(?:\s+-\s*)?$/i },
  { base_key: "team1_corner_interval", pattern: /^Squadra\s+1,\s+Calcio\s+D['']angolo\s+Dal\s+Minuto\s+Al\s+Minuto(?:\s+\([\d.]+\))?(?:\s+-\s*)?$/i },
  { base_key: "team2_corner_interval", pattern: /^Squadra\s+2,\s+Calcio\s+D['']angolo\s+Dal\s+Minuto\s+Al\s+Minuto(?:\s+\([\d.]+\))?(?:\s+-\s*)?$/i },

  // ── Scraper-bug market-level (outcomes unusable) ──
  { base_key: "first_goal_time", pattern: /^Momento\s+In\s+Cui\s+Viene\s+Realizzato\s+Il\s+Primo\s+Goal$/i },
  { base_key: "team_half_first_goal", pattern: /^In\s+Quale\s+Tempo\s+Squadra\s+[12]\s+Segna\s+Il\s+Suo\s+Goal$/i },
  { base_key: "super_handicap", pattern: /^SuperHandicap(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },
  { base_key: "super_total", pattern: /^SuperTotale(?:\s+-\s+(1T|2T))?$/i, periodPos: 1 },
  { base_key: "exact_total_sets", pattern: /^Numero\s+Esatto\s+Totale\s+di\s+Set$/i },
  { base_key: "exact_total", pattern: /^Numero\s+Esatto$/i },

  // Prossimo Calcio D'angolo (no line, trailing dash) — fallback
  { base_key: "next_corner", pattern: /^Prossimo\s+Calcio\s+D['']angolo(?:\s+-\s*)?$/i },

  // ═══ (end wave 19) ═══

  // ═══ Wave 20: period extensions + new families (2026-04-21) ═══

  // Totale 1/2 Individuale 3Opzioni (N) 3T/4T — use existing team{1|2}_total_3way rule; canonicals added via mig 070
  // (no new regex rule needed — existing rule at line ~231 already handles arbitrary period suffix via 2nd group)

  // Squadra 1/2, Calci D'Angolo Multipli (N) - (trailing dash) → team{1|2}_multi_corners_ft
  { base_key: "team1_multi_corners", pattern: /^Squadra\s+1,\s+Calci\s+D['']Angolo\s+Multipli\s+\(([\d.]+)\)(?:\s+-\s*)?$/i, linePos: 1 },
  { base_key: "team2_multi_corners", pattern: /^Squadra\s+2,\s+Calci\s+D['']Angolo\s+Multipli\s+\(([\d.]+)\)(?:\s+-\s*)?$/i, linePos: 1 },
  { base_key: "multi_corners",       pattern: /^Calci\s+D['']Angolo\s+Multipli\s+\(([\d.]+)\)(?:\s+-\s*)?$/i, linePos: 1 },

  // Entrambe Le Squadre Segnano N Punti Ciascuna (N) - 1T/2T/3T/4T → team_scores_n_points (has_line=N)
  { base_key: "team_scores_n_points", pattern: /^Entrambe\s+Le\s+Squadre\s+Segnano\s+\d+\s+Punti\s+Ciascuna\s+\(([\d.]+)\)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },

  // Differenza Punti Esatta. (N) / Differenza Punti Esatta (N) - 1T/2T — tolerate trailing dot
  { base_key: "exact_point_diff", pattern: /^Differenza\s+Punti\s+Esatta\.?\s+\(([\d.]+)\)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },

  // Cifra Nel Risultato (N) / - 1T/2T
  { base_key: "last_digit_result", pattern: /^Cifra\s+Nel\s+Risultato\s+\(([\d.]+)\)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },

  // Map N - Team Kills Handicap (N) — esports
  { base_key: "map_team_kills_handicap", pattern: /^Map\s+\d+\s+-\s+Team\s+Kills\s+Handicap\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },
  { base_key: "map_total_kills", pattern: /^Map\s+\d+\s+-\s+Total\s+Kills\s+([\d.]+)$/i, linePos: 1 },

  // Punteggio Più Alto Della Squadra Di Casa Totale (N) - NT → tournament_highest_home_score_ft
  { base_key: "tournament_highest_home_score", pattern: /^Punteggio\s+Più\s+Alto\s+Della\s+Squadra\s+Di\s+Casa\s+Totale\s+\(([\d.]+)\)(?:\s+-\s+\d+T)?$/i, linePos: 1 },

  // Totale Ogni Squadra Segnerà Under/Over (N) → both_teams_total_ou_ft
  { base_key: "both_teams_total_ou", pattern: /^Totale\s+Ogni\s+Squadra\s+Segnerà\s+Under\/Over\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Squadra 1/2 Segna Goal Consecutivi (N)
  { base_key: "team1_consecutive_goals", pattern: /^Squadra\s+1\s+Segna\s+Goal\s+Consecutivi\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "team2_consecutive_goals", pattern: /^Squadra\s+2\s+Segna\s+Goal\s+Consecutivi\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Sfida A Punti (NOpzioni) (N) - NT (race to points with N-way option)
  { base_key: "race_to_points", pattern: /^Sfida\s+A\s+Punti\s+\(\d+Opzioni\)\s+\(([\d.]+)\)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },

  // Totale Nashor/Draghi/Torri (esports generic totals)
  { base_key: "total_nashor", pattern: /^Totale\s+Nashor\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_dragons", pattern: /^Totale\s+Draghi\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "total_towers", pattern: /^Totale\s+Torri\s+([\d.]+)$/i, linePos: 1 },

  // ═══ (end wave 20) ═══

  // ═══ Wave 21: residue fixes + extensions (2026-04-21) ═══

  // Team-name-embedded totals: "Totale Home (Points) N.N - NT" / "Totale Away (Points) N.N - NT"
  // Specific anchors only (avoids overmatching "Totale calci d'angolo" / "Totale gol" etc.).
  { base_key: "total_team", pattern: /^Totale\s+(?:Home|Away)\s+\(Points\)\s+([\d.]+)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },

  // Differenza Punti Esatta (permissive multi-dot trailing — "Esatta..." / "Esatta...")
  { base_key: "exact_point_diff", pattern: /^Differenza\s+Punti\s+Esatta[.]*\s+\(([\d.]+)\)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },

  // Cricket: Squadra N Totale Run Nell'Over (N)
  { base_key: "team_total_run_over", pattern: /^Squadra\s+[12]\s+Totale\s+Run\s+Nell['']Over\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Cricket: Ultima Cifra Nel Risultato Della Partita Dopo N Over Del Primo Innings (N)
  { base_key: "last_digit_after_overs", pattern: /^Ultima\s+Cifra\s+Nel\s+Risultato\s+Della\s+Partita\s+Dopo\s+\d+\s+Over\s+Del\s+Primo\s+Innings\s+\([\d.]+\)$/i },

  // Minute-based handicap
  { base_key: "minute_handicap", pattern: /^Handicap\s+Al\s+Minuto\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },
  // Minute-based BTTS
  { base_key: "minute_btts", pattern: /^Entrambe\s+Le\s+Squadre\s+a\s+Segno\s+Al\s+Minuto\s+\(([\d.]+)\)$/i, linePos: 1 },

  // Testa a testa Handicap (N) — alias of 2way_handicap
  { base_key: "2way_handicap", pattern: /^Testa\s+a\s+testa\s+Handicap\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },

  // Frag, Totale (N) / Frag, Totale (N) - NT
  { base_key: "frag_total", pattern: /^Frag,\s+Totale\s+\(([\d.]+)\)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "team1_frag_total", pattern: /^Squadra\s+1,\s+Totale\s+Frag\s+\(([\d.]+)\)(?:\s+-\s+\d+T)?$/i, linePos: 1 },
  { base_key: "team2_frag_total", pattern: /^Squadra\s+2,\s+Totale\s+Frag\s+\(([\d.]+)\)(?:\s+-\s+\d+T)?$/i, linePos: 1 },

  // Map N - Round Handicap (N) / Map N - Total Rounds N.N / Mappa N - Minuti totali N.N
  { base_key: "map_round_handicap", pattern: /^Map\s+\d+\s+-\s+Round\s+Handicap\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },
  { base_key: "map_total_rounds", pattern: /^Map\s+\d+\s+-\s+Total\s+Rounds\s+([\d.]+)$/i, linePos: 1 },
  { base_key: "map_total_minutes", pattern: /^Mappa\s+\d+\s+-\s+Minuti\s+totali\s+([\d.]+)$/i, linePos: 1 },

  // Quante Squadre Segneranno Un Determinato Numero Di Goal [- period]
  { base_key: "teams_scoring_n_goals", pattern: /^Quante\s+Squadre\s+Segneranno\s+Un\s+Determinato\s+Numero\s+Di\s+Goal(?:\s+-\s+(1T|2T|11T|12T))?$/i, periodPos: 1 },

  // NXN H (N) - NT (= 1X2 H but different form) — fallback handicap 3-way
  { base_key: "1x2_handicap", pattern: /^\dX\d\s+H\s+\(([+-]?[\d.]+)\)(?:\s+-\s+(\d+T))?$/i, linePos: 1, periodPos: 2 },

  // VN + Totale N (N) — already handled by team{1|2}_win_and_team_total rule.
  // But "V1 + Totale 1 (N) - 11T" needs period 11T → 1h (handled by period.ts now).

  // ═══ (end wave 21) ═══

  // ═══ Wave 22: final sweep (2026-04-21) ═══

  // Punti Extra / - 1T/2T (basket overtime extras)
  { base_key: "extra_points", pattern: /^Punti\s+Extra(?:\s+-\s+(1T|2T|11T|12T))?$/i, periodPos: 1 },

  // Risultato Dopo I Primi Due Set (tennis)
  { base_key: "result_after_2_sets", pattern: /^Risultato\s+Dopo\s+I\s+Primi\s+Due\s+Set$/i },

  // Numero Esatto Di Punti Nel Set - 1T/2T (tennis)
  { base_key: "exact_points_set", pattern: /^Numero\s+Esatto\s+Di\s+Punti\s+Nel\s+Set\s+-\s+(1T|2T)$/i, periodPos: 1 },

  // Squadra 1/2 Vince Entrambi I Tempi
  { base_key: "team1_wins_both_halves", pattern: /^Squadra\s+1\s+Vince\s+Entrambi\s+I\s+Tempi$/i },
  { base_key: "team2_wins_both_halves", pattern: /^Squadra\s+2\s+Vince\s+Entrambi\s+I\s+Tempi$/i },

  // Squadra Segna In Ogni Tempo - Sì/No
  { base_key: "team_scores_every_half", pattern: /^Squadra\s+Segna\s+In\s+Ogni\s+Tempo\s+-\s+S[iì]\/No$/i },

  // Totale Draghi/Nashor Battuti (N) - NT (esports)
  { base_key: "total_dragons_slain", pattern: /^Totale\s+Draghi\s+Battuti\s+\(([\d.]+)\)(?:\s+-\s+(1T|2T|11T|12T))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "total_nashor_slain", pattern: /^Totale\s+Nashor\s+Battuti\s+\(([\d.]+)\)(?:\s+-\s+(1T|2T|11T|12T))?$/i, linePos: 1, periodPos: 2 },

  // Quando Sarà Determinato il Vincitore
  { base_key: "winner_determined", pattern: /^Quando\s+Sarà\s+Determinato\s+il\s+Vincitore$/i },

  // Quadrupla Uccisione (- period)
  { base_key: "quadra_kill", pattern: /^Quadrupla\s+Uccisione(?:\s+-\s+(1T|2T|11T|12T))?$/i, periodPos: 1 },

  // Un Avversario Vince Di (N) - NT
  { base_key: "either_wins_by", pattern: /^Un\s+Avversario\s+Vince\s+Di\s+\(([\d.]+)\)(?:\s+-\s+(1T|2T|11T|12T))?$/i, linePos: 1, periodPos: 2 },

  // Vince Di. (trailing dot alias, no line) → win_by_margin_grid_ft
  { base_key: "win_by_margin_grid", pattern: /^Vince\s+Di\.$/i },

  // Totale Partite Con Over/Under - 1T/2T
  { base_key: "tournament_matches_overunder", pattern: /^Totale\s+Partite\s+Con\s+Over\/Under\s+-\s+(1T|2T|11T|12T)$/i, periodPos: 1 },

  // Handicap Al Minuto (no parens) — fallback, map to minute_handicap_ft grid-ish (but has_line=true). Skip if ambiguous.
  // (residue: 76 rows at single type — low priority)

  // ═══ (end wave 22) ═══

  // ═══ Wave 9: alias regex for existing canonicals (patterns emerged from LLM batches) ═══

  // legacy "Tempo Regolamentare Doppia Chance" → dc_ft
  { base_key: "dc", pattern: /^Tempo\s+Regolamentare\s+Doppia\s+Chance$/i },

  // legacy "Quale Squadra Segnerà Punti Per Prima?" → first_team_to_score_ft
  { base_key: "first_team_to_score", pattern: /^Quale\s+Squadra\s+Segnerà\s+Punti\s+Per\s+Prima\?$/i },

  // legacy "Vittoria (2 Opzioni)" → winner_ft (2-way moneyline alias)
  { base_key: "winner", pattern: /^Vittoria\s+\(2\s+Opzioni\)$/i },

  // Wave 15: legacy "Vittoria Squadra" (post scraper-fix consolidated, outcomes "Squadra 1 Vince"/"Squadra 2 Vince") → winner_ft
  { base_key: "winner", pattern: /^Vittoria\s+Squadra$/i },

  // Wave 15: legacy "Autogol" (Sì/No own-goal market) → own_goal_ft (new canonical, mig 064)
  { base_key: "own_goal", pattern: /^Autogol$/i },

  // legacy "Risultato Ed Entrambe Le Squadre Segnano [- period]" → 1x2_btts_*
  { base_key: "1x2_btts", pattern: /^Risultato\s+Ed\s+Entrambe\s+Le\s+Squadre\s+Segnano(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // legacy "Gol totali - Pari/Dispari - period" (verbose oe_1h/2h form)
  { base_key: "odd_even", pattern: /^Gol\s+totali\s+-\s+Pari\/Dispari\s+-\s+(.+)$/i, periodPos: 1 },

  // ═══ Wave 10: new canonicals (T/T handicap, set family, team win-to-nil) ═══

  // T/T Handicap (2-way handicap, no draw) — esports/tennis/volley
  { base_key: "2way_handicap", pattern: /^T\/T\s+Handicap\s+\(([+-]?[\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // Squadra X Vince A Zero [- period] → team{1|2}_win_to_nil_*
  // Must precede bare "Vince a Zero" rule to avoid absorption.
  { base_key: "team1_win_to_nil", pattern: /^Squadra\s+1\s+Vince\s+A\s+Zero(?:\s+-?\s*(.+))?$/i, periodPos: 1 },
  { base_key: "team2_win_to_nil", pattern: /^Squadra\s+2\s+Vince\s+A\s+Zero(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // legacy "Vince a Zero [- period]" — now permissive (replaces strict FT rule)
  { base_key: "win_to_nil", pattern: /^Vince\s+a\s+Zero(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // Tennis set family
  { base_key: "set_handicap", pattern: /^Set\s+Handicap\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },
  { base_key: "total_sets", pattern: /^Totale\s+Set\s+\(([\d.]+)\)$/i, linePos: 1 },
  { base_key: "set_result", pattern: /^Risultato\s+Set$/i },

  // ═══ (end wave 9/10) ═══

  // ═══ Wave 11: team-specific both-halves-score (Sì/No per team) ═══
  { base_key: "team1_both_halves_score", pattern: /^Squadra\s+1\s+Segna\s+Un\s+Goal\s+In\s+Entrambi\s+I\s+Tempi$/i },
  { base_key: "team2_both_halves_score", pattern: /^Squadra\s+2\s+Segna\s+Un\s+Goal\s+In\s+Entrambi\s+I\s+Tempi$/i },

  // ═══ Wave 12a: team win + team total combo (legacy "V1 + Totale 1 (N)" / "V2 + Totale 2 (N)") ═══
  { base_key: "team1_win_and_team_total", pattern: /^V1\s+\+\s+Totale\s+1\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "team2_win_and_team_total", pattern: /^V2\s+\+\s+Totale\s+2\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // ═══ Wave 12b: team nolose (1X/2X or DC) + team total ═══
  // Team 1: "1X + Squadra 1 Totale (N)" or "Doppia Chance + Totale Squadra 1 (N)"
  { base_key: "team1_nolose_and_team_total", pattern: /^1X\s+\+\s+Squadra\s+1\s+Totale\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "team1_nolose_and_team_total", pattern: /^Doppia\s+Chance\s+\+\s+Totale\s+Squadra\s+1\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },
  // Team 2: "2X + Squadra 2 Totale (N)" or "Doppia Chance + Totale Squadra 2 (N)"
  { base_key: "team2_nolose_and_team_total", pattern: /^2X\s+\+\s+Squadra\s+2\s+Totale\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "team2_nolose_and_team_total", pattern: /^Doppia\s+Chance\s+\+\s+Totale\s+Squadra\s+2\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // ═══ Wave 12c: BTTS combos ═══
  // "Entrambe Le Squadre Segnano + Doppia Chance [- period]" → no_btts_and_dc_*
  // (outcomes "Almeno Una Non Segna E 1X/2X" confirm BTTS=No variant)
  { base_key: "no_btts_and_dc", pattern: /^Entrambe\s+Le\s+Squadre\s+Segnano\s+\+\s+Doppia\s+Chance(?:\s+-?\s*(.+))?$/i, periodPos: 1 },
  // "Totale E Entrambe A Segno (N) [- period]" → btts_and_total (BTTS=Yes + U/O)
  { base_key: "btts_and_total", pattern: /^Totale\s+E\s+Entrambe\s+A\s+Segno\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },
  // "Almeno Una Delle Due Squadre Non Segna + Totale (N) [- period]" → no_btts_and_total (BTTS=No + U/O)
  { base_key: "no_btts_and_total", pattern: /^Almeno\s+Una\s+Delle\s+Due\s+Squadre\s+Non\s+Segna\s+\+\s+Totale\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // ═══ Wave 7: corner markets (legacy) ═══
  // Tollera sia apostrofo ASCII ' che tipografico ' in "d'angolo".

  // Totale calci d'angolo period-in-middle: "Totale calci d'angolo - 1° tempo 4.5"
  // Must precede the plain "Totale calci d'angolo N.5" rule to avoid partial capture.
  { base_key: "total_corners", pattern: /^Totale\s+calci\s+d['']angolo\s+-\s+(.+?)\s+([\d.]+)$/i, periodPos: 1, linePos: 2 },
  // Totale calci d'angolo N.5 (full time)
  { base_key: "total_corners", pattern: /^Totale\s+calci\s+d['']angolo\s+([\d.]+)$/i, linePos: 1 },

  // Più calci d'angolo [- period] (corner winner 1/X/2)
  { base_key: "corner_winner", pattern: /^Più\s+calci\s+d['']angolo(?:\s+-\s+(.+))?$/i, periodPos: 1 },

  // Corner 1X2 handicap: "Calci d'angolo - 1X2 con Handicap (-2)"
  { base_key: "corner_1x2_handicap", pattern: /^Calci\s+d['']angolo\s+-\s+1X2\s+con\s+Handicap\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },

  // Corner successivo: "Corner successivo, puntata annullata in caso di nessun corner, (N)"
  // N = which next corner (1st, 2nd, ...). Greedy match tolerant to descriptor variations.
  { base_key: "next_corner",  pattern: /^Corner\s+successivo,.*\((\d+)\)$/i, linePos: 1 },

  // ═══ (end wave 7) ═══

  // --- legacy combo: "1X2 + Ogni Squadra Segna" (1X2 + BTTS), optional period suffix ---
  { base_key: "1x2_btts",     pattern: /^1X2\s+\+\s+Ogni\s+Squadra\s+Segna(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // --- Totale Squadra ---
  { base_key: "total_team",   pattern: /^Totale\s+Squadra\s+([\d.]+)$/i, linePos: 1 },

  // ═══ Wave 13: legacy "Totale Home/Away N [- period]" → total_team_{ft|1h|2h} ═══
  // Home/Away distinction is lost (maps to generic total_team canonical), as the
  // catalog uses a single base_key=total_team. Period 1T/2T requires total_team_1h/2h
  // canonicals added in migration 062.
  { base_key: "total_team",   pattern: /^Totale\s+(?:Home|Away)\s+([\d.]+)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // --- legacy Totale Asiatico (over/under with asian push/refund, period optional) ---
  // Wave 13: permissive trailing dash (allow "Totale Asiatico 12.25 - " with empty period).
  { base_key: "asian_total",  pattern: /^Totale\s+Asiatico\s+([\d.]+)(?:\s+-?\s*(.*))?$/i, linePos: 1, periodPos: 2 },

  // --- legacy Squadra 1/2 Totale Asiatico (team asian total, period optional) ---
  // Wave 13: permissive trailing dash for "Squadra 1 Totale Asiatico (4.75) - ".
  { base_key: "total_team_asian", pattern: /^Squadra\s+[12]\s+Totale\s+Asiatico\s+\(([\d.]+)\)(?:\s+-?\s*(.*))?$/i, linePos: 1, periodPos: 2 },

  // ═══ Wave 13: legacy "Multicalci d'angolo (N.5) [- period]" → total_corners_{ft|1h|2h} ═══
  // Tollera entrambi apostrofi (ASCII U+0027 ' e tipografico U+2019 '). Trailing-dash permissive.
  { base_key: "total_corners", pattern: /^Multicalci\s+d['’]angolo\s+\(([\d.]+)\)(?:\s+-?\s*(.*))?$/i, linePos: 1, periodPos: 2 },

  // ═══ Wave 13: legacy "Chi Segnerà il L'ultimo Goal Della Partita?" → last_scorer ═══
  // last_scorer canonical period=ft only. Apostrofo ASCII U+0027 o tipografico U+2019. Trailing-dash permissive.
  { base_key: "last_scorer", pattern: /^Chi\s+Segnerà\s+il\s+L['’]ultimo\s+Goal\s+Della\s+Partita\??(?:\s+-?\s*(.*))?$/i, periodPos: 1 },

  // --- legacy "Vincente Incontro" (2-way moneyline for no-draw sports: tennis/basket/volley), optional period ---
  { base_key: "winner",       pattern: /^Vincente\s+Incontro(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // --- Both halves score (legacy "Segna Entrambi i Tempi" + legacy "Segna/Goal In Entrambi i Tempi") ---
  { base_key: "both_halves_score", pattern: /^(?:Segna|Goal)\s+(?:In\s+)?Entrambi\s+i\s+Tempi$/i },

  // --- legacy "Numero Esatto (N)" (exact goals count), with optional period ---
  // (N) is the exact goal count (usually 2, 3, 4); treated as canonical_line.
  { base_key: "exact_goals", pattern: /^Numero\s+Esatto\s+\((\d+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // ═══ Wave A+ patterns (fixed-string, team-specific, no line) ═══

  // Squadra X Segna Nei Tempi — 3-way goal compare 1T vs 2T per team
  // (legacy name "Segna Nei Tempi" is misleading: outcomes are 1T</>/=2T)
  { base_key: "team1_halves_goal_compare", pattern: /^Squadra\s+1\s+Segna\s+Nei\s+Tempi$/i },
  { base_key: "team2_halves_goal_compare", pattern: /^Squadra\s+2\s+Segna\s+Nei\s+Tempi$/i },

  // Doppia Chance + Entrambe Le Squadre Segnano — DC+BTTS combo (6 outcomes), optional period
  { base_key: "dc_btts",      pattern: /^Doppia\s+Chance\s+\+\s+Entrambe\s+Le\s+Squadre\s+Segnano(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // Pareggio In Almeno Un Tempo — Sì/No
  { base_key: "draw_any_half",pattern: /^Pareggio\s+In\s+Almeno\s+Un\s+Tempo$/i },

  // Individuale Totale X Pari/Dispari (scraper emits "Pari /Dispari" with stray space, tolerate both)
  { base_key: "team1_total_oe", pattern: /^Individuale\s+Totale\s+1\s+Pari\s*\/\s*Dispari$/i },
  { base_key: "team2_total_oe", pattern: /^Individuale\s+Totale\s+2\s+Pari\s*\/\s*Dispari$/i },

  // Squadra X Vince Uno Dei Due Tempi — Sì/No per team
  { base_key: "team1_wins_any_half", pattern: /^Squadra\s+1\s+Vince\s+Uno\s+Dei\s+Due\s+Tempi$/i },
  { base_key: "team2_wins_any_half", pattern: /^Squadra\s+2\s+Vince\s+Uno\s+Dei\s+Due\s+Tempi$/i },

  // Ultimo Goal [- period] — last scorer per half OR full match (home/away/none).
  // Wave 15: period optional (was required) so plain "Ultimo Goal" (legacy post-fix
  // emission) maps to last_goal_ft. New canonical last_goal_ft added in mig 064.
  { base_key: "last_goal",    pattern: /^Ultimo\s+Goal(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // ═══ (end wave A+) ═══

  // ═══ Wave B patterns (line=N, with optional period) ═══

  // Totale X Individuale 3Opzioni (N) — must precede generic "Totale 3Opzioni" rule
  { base_key: "team1_total_3way", pattern: /^Totale\s+1\s+Individuale\s+3Opzioni\s+\((\d+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "team2_total_3way", pattern: /^Totale\s+2\s+Individuale\s+3Opzioni\s+\((\d+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // Totale 3Opzioni (N) — generic 3-way total
  { base_key: "total_3way",   pattern: /^Totale\s+3Opzioni\s+\((\d+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // N, Risultato + Totale (X.Y) — team-specific win/dnb + U/O combo
  { base_key: "team1_result_total", pattern: /^1,\s+Risultato\s+\+\s+Totale\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },
  { base_key: "team2_result_total", pattern: /^2,\s+Risultato\s+\+\s+Totale\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // Goal Successivo (N) — next goal N (home/away/none)
  { base_key: "next_goal",    pattern: /^Goal\s+Successivo\s+\((\d+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // Una Qualsiasi Squadra Vince Di (N) — must precede "Vittoria Di" to avoid generic absorption
  // (well-specified prefix "Una Qualsiasi" but safer to order first)
  { base_key: "any_team_win_by_margin", pattern: /^Una\s+Qualsiasi\s+Squadra\s+Vince\s+Di\s+\((\d+)\)$/i, linePos: 1 },

  // Vittoria Di (N) — team wins by exactly N (Sì/No per team, 4 outcomes)
  { base_key: "win_by_margin", pattern: /^Vittoria\s+Di\s+\((\d+)\)$/i, linePos: 1 },

  // Sfida Al (N) — race to N goals (home/away/none). Wave 13: trailing-dash permissive.
  { base_key: "race_to_goals", pattern: /^Sfida\s+Al\s+\((\d+)\)(?:\s+-?\s*(.*))?$/i, linePos: 1, periodPos: 2 },

  // Pareggio + Totale (X.Y) — draw + U/O combo (Sì/No × over/under)
  { base_key: "draw_and_u_o", pattern: /^Pareggio\s+\+\s+Totale\s+\(([\d.]+)\)(?:\s+-?\s*(.+))?$/i, linePos: 1, periodPos: 2 },

  // ═══ (end wave B) ═══

  // --- Esito 1T/Finale (must precede 1X2 rule to avoid it consuming the string) ---
  { base_key: "htft",         pattern: /^Esito\s+1T\/Finale$/i },

  // --- legacy "PT-F" (HT/FT alias: outcomes V1V1/V1X/V1V2/XV1/XX/XV2/V2V1/V2X/V2V2) ---
  // Exact match anchor to avoid eating combo variants like "PT-F + Totale (2.5)".
  { base_key: "htft",         pattern: /^PT-F$/i },

  // --- legacy "Tempo/Tempo" (HT/FT alias: outcomes spelled out "Squadra X Vince il 1°Tempo/..." etc.) ---
  { base_key: "htft",         pattern: /^Tempo\/Tempo$/i },

  // --- legacy "Segna Goal" (First Team to Score: outcomes 1/X/2, avg odds X≈11 confirms X=neither) ---
  // Needs new canonical "first_team_to_score_ft" (migration 052).
  { base_key: "first_team_to_score", pattern: /^Segna\s+Goal$/i },

  // --- Risultato Esatto with optional period suffix ---
  { base_key: "correct_score",pattern: /^Risultato\s+Esatto(?:\s+(.+))?$/i, periodPos: 1 },

  // --- Draw No Bet with optional period suffix ---
  { base_key: "dnb",          pattern: /^Draw\s+No\s+Bet(?:\s+(.+))?$/i, periodPos: 1 },

  // --- DC with optional period suffix ---
  { base_key: "dc",           pattern: /^DC(?:\s+(.+))?$/i, periodPos: 1 },

  // --- 1X2 with optional period suffix ---
  { base_key: "1x2",          pattern: /^1X2(?:\s+-?\s*(.+))?$/i, periodPos: 1 },

  // --- GG/NG with optional period suffix ---
  { base_key: "gg_ng",        pattern: /^GG\/NG(?:\s+(.+))?$/i, periodPos: 1 },

  // --- Pari/Dispari ---
  { base_key: "odd_even",     pattern: /^Pari\/Dispari(?:\s+(.+))?$/i, periodPos: 1 },

  // ═══ Wave 35 — set winners, set handicap, consecutive goals, extra time (2026-04-23) ═══

  // --- Set winner "N° Set" (legacy tennis) → set_n_winner_ft line=N ---
  // Outcomes are player names (tennis) — Phase 3 Part 2a canonicalizes
  // via events.home_team/away_team matching.
  { base_key: "set_n_winner", pattern: /^(\d+)°\s+Set$/i, linePos: 1 },

  // --- Alternative form "Set N" (legacy variant) → set_n_winner_ft line=N ---
  { base_key: "set_n_winner", pattern: /^Set\s+(\d+)$/i, linePos: 1 },

  // --- legacy "Handicap sui Set (±L)" → set_handicap_ft line=L ---
  // Distinct canonical from 1x2_handicap: tennis set spread, not goal spread.
  { base_key: "set_handicap", pattern: /^Handicap\s+sui\s+Set\s+\(([+-]?[\d.]+)\)$/i, linePos: 1 },

  // --- legacy "Goal Di Seguito Di Una Squadra (N)" → any_team_consecutive_goals_ft line=N ---
  // Distinct from team1_/team2_consecutive_goals (those are team-specific).
  // "Di Una Squadra" = "of any team" — 2-outcome Sì/No market.
  { base_key: "any_team_consecutive_goals", pattern: /^Goal\s+Di\s+Seguito\s+Di\s+Una\s+Squadra\s+\((\d+)\)$/i, linePos: 1 },

  // --- legacy "Ci Saranno i Supplementari - Sì/No [- NT]" → extra_time_yn_{ft,1h,2h,3h} ---
  // Tolerates Sì (accented) and Si (ASCII) — scraper has mixed emissions.
  // Period fragment optional (bare form → ft).
  { base_key: "extra_time_yn", pattern: /^Ci\s+Saranno\s+i\s+Supplementari\s+-\s+S[iì]\s*\/\s*No(?:\s+-\s+(\d\s*T))?$/i, periodPos: 1 },

];

export function parseMarketType(input: string): ParsedMarketType | null {
  if (!input) return null;
  const s = input.trim();

  for (const rule of RULES) {
    const match = s.match(rule.pattern);
    if (!match) continue;
    const periodFragment = rule.periodPos != null ? match[rule.periodPos] : null;
    const lineStr = rule.linePos != null ? match[rule.linePos] : null;
    const period = normalizePeriod(periodFragment);
    // Unknown numeric period (e.g. "- 12T"): skip this rule, try next. If no
    // rule parses cleanly, the engine leaves the row unmapped.
    if (period === null) continue;
    return {
      base_key: rule.base_key,
      period,
      line: lineStr != null ? parseFloat(lineStr) : null,
    };
  }
  return null;
}

/**
 * Given a parsed market type, look up the canonical_key by joining
 * base_key + period. Used by stage 1 to build the final StageResult.
 */
export function canonicalKeyFor(parsed: ParsedMarketType): string {
  if (parsed.base_key === "1x2_handicap") return `1x2_h_${parsed.period}`;
  return `${parsed.base_key}_${parsed.period}`;
}
