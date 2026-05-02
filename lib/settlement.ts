import { SupabaseClient } from "@supabase/supabase-js";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  extractStat,
  type FlashscoreStat,
} from "@/lib/settlement/stats-extractor";
import {
  canonicalizeOutcome,
  makeEmptyLookups,
  resolveCanonicalSettler,
  type CanonicalLookups,
} from "@/lib/settlement/canonical-dispatcher";
import { loadCanonicalLookups } from "@/lib/settlement/canonical-loader";
import {
  classifyLeg as planDClassifyLeg,
  type ScoreResult as PlanDScoreResult,
  type Verdict as PlanDVerdict,
} from "@/lib/settlement/odds-api/classify";
import { aggregatePayout } from "@/lib/settlement/half-stake-payout";

// ═══ TYPES ═══

interface SettlementResult {
  // Full-time scores (all sports)
  home: number;
  away: number;
  total: number;
  // Half-time / first period (football: 1st half; basketball: Q1+Q2)
  ht_home?: number;
  ht_away?: number;
  ht_total?: number;
  // Second half / second period calculated
  sh_home?: number;
  sh_away?: number;
  sh_total?: number;
  // Raw per-period array from live_data (tennis: per-set games, basket: per-quarter pts)
  halfScores?: { home: number[]; away: number[] };
  // Sport name (lowercase)
  sport?: string;
  // Period string from event
  period?: string;
  // Match statistics (from Flashscore)
  corners_home?: number;
  corners_away?: number;
  corners_total?: number;
  ht_corners_home?: number;
  ht_corners_away?: number;
  ht_corners_total?: number;
  cards_home?: number;
  cards_away?: number;
  cards_total?: number;
  shots_on_target_home?: number;
  shots_on_target_away?: number;
  // Second-half corners
  sh_corners_home?: number;
  sh_corners_away?: number;
  sh_corners_total?: number;
  // Half-time yellow+red totals (Phase 2 consumers)
  ht_cards_home?: number;
  ht_cards_away?: number;
  ht_cards_total?: number;
  sh_cards_home?: number;
  sh_cards_away?: number;
  sh_cards_total?: number;
  // Total shots (tiri totali) FT/HT/SH
  shots_total_home?: number;
  shots_total_away?: number;
  ht_shots_total_home?: number;
  ht_shots_total_away?: number;
  sh_shots_total_home?: number;
  sh_shots_total_away?: number;
  // Shots on target HT/SH (shots_on_target_home/away FT already exist above)
  ht_shots_on_target_home?: number;
  ht_shots_on_target_away?: number;
  sh_shots_on_target_home?: number;
  sh_shots_on_target_away?: number;
}

type Verdict = "won" | "lost" | "void" | "push" | "half_won" | "half_lost";

type SettlerFn = (
  result: SettlementResult,
  outcomeName: string,
  line?: number,
  setIdx?: number
) => Verdict | null; // null = stats not available yet, try later

export interface SettleOutcome {
  success?: boolean;
  already_settled?: boolean;
  skipped_no_scores?: boolean;
  error?: string;
  legs_processed?: number;
  bets_settled?: number;
  total_payout?: number;
}

// ═══ buildResult ═══

function buildResult(
  event: Record<string, unknown>,
  manualResult?: { home: number; away: number },
  sport?: string
): SettlementResult | null {
  const home =
    manualResult?.home ?? (event.score_home as number | null);
  const away =
    manualResult?.away ?? (event.score_away as number | null);

  if (home == null || away == null) return null;

  const sr: SettlementResult = {
    home,
    away,
    total: home + away,
    sport: sport || "",
    period: (event.period as string) || "",
  };

  // Per-period scores from live_data JSONB
  const ld = (event.live_data as Record<string, unknown>) || {};
  const htHome = ld.halfScoreHome as number[] | undefined;
  const htAway = ld.halfScoreAway as number[] | undefined;

  if (htHome?.length && htAway?.length) {
    sr.halfScores = { home: [...htHome], away: [...htAway] };

    // Football half-time: element[0] = 1st half score
    const sportLower = (sport || "").toLowerCase();
    const isFootball =
      sportLower === "calcio" ||
      sportLower === "football" ||
      sportLower === "soccer" ||
      sportLower === "";

    if (isFootball && htHome.length >= 1 && htAway.length >= 1) {
      const htH = htHome[0];
      const htA = htAway[0];
      // Safety: if ht > ft, data is corrupted (cumulative, not real HT)
      if (htH <= home && htA <= away) {
        sr.ht_home = htH;
        sr.ht_away = htA;
        sr.ht_total = htH + htA;
        sr.sh_home = home - htH;
        sr.sh_away = away - htA;
        sr.sh_total = sr.sh_home + sr.sh_away;
      }
    }
  }

  // Match statistics from Flashscore (persisted in live_data.stats, Italian names)
  const statsArr = ld.stats as FlashscoreStat[] | undefined;
  if (statsArr?.length) {
    const cornersFt = extractStat(statsArr, "ft", "corners");
    if (cornersFt) {
      sr.corners_home = cornersFt.home;
      sr.corners_away = cornersFt.away;
      sr.corners_total = cornersFt.total;
    }
    const cornersHt = extractStat(statsArr, "ht", "corners");
    if (cornersHt) {
      sr.ht_corners_home = cornersHt.home;
      sr.ht_corners_away = cornersHt.away;
      sr.ht_corners_total = cornersHt.total;
    }
    const yellowFt = extractStat(statsArr, "ft", "cards_yellow");
    const redFt = extractStat(statsArr, "ft", "cards_red");
    if (yellowFt) {
      sr.cards_home = yellowFt.home + (redFt?.home ?? 0);
      sr.cards_away = yellowFt.away + (redFt?.away ?? 0);
      sr.cards_total = sr.cards_home + sr.cards_away;
    }
    const shotsOn = extractStat(statsArr, "ft", "shots_on_target");
    if (shotsOn) {
      sr.shots_on_target_home = shotsOn.home;
      sr.shots_on_target_away = shotsOn.away;
    }
    const cornersSh = extractStat(statsArr, "sh", "corners");
    if (cornersSh) {
      sr.sh_corners_home = cornersSh.home;
      sr.sh_corners_away = cornersSh.away;
      sr.sh_corners_total = cornersSh.total;
    }
    const yellowHt = extractStat(statsArr, "ht", "cards_yellow");
    const redHt = extractStat(statsArr, "ht", "cards_red");
    if (yellowHt) {
      sr.ht_cards_home = yellowHt.home + (redHt?.home ?? 0);
      sr.ht_cards_away = yellowHt.away + (redHt?.away ?? 0);
      sr.ht_cards_total = sr.ht_cards_home + sr.ht_cards_away;
    }
    const yellowSh = extractStat(statsArr, "sh", "cards_yellow");
    const redSh = extractStat(statsArr, "sh", "cards_red");
    if (yellowSh) {
      sr.sh_cards_home = yellowSh.home + (redSh?.home ?? 0);
      sr.sh_cards_away = yellowSh.away + (redSh?.away ?? 0);
      sr.sh_cards_total = sr.sh_cards_home + sr.sh_cards_away;
    }
    const shotsFt = extractStat(statsArr, "ft", "shots_total");
    if (shotsFt) {
      sr.shots_total_home = shotsFt.home;
      sr.shots_total_away = shotsFt.away;
    }
    const shotsHt = extractStat(statsArr, "ht", "shots_total");
    if (shotsHt) {
      sr.ht_shots_total_home = shotsHt.home;
      sr.ht_shots_total_away = shotsHt.away;
    }
    const shotsSh = extractStat(statsArr, "sh", "shots_total");
    if (shotsSh) {
      sr.sh_shots_total_home = shotsSh.home;
      sr.sh_shots_total_away = shotsSh.away;
    }
    const shotsOnHt = extractStat(statsArr, "ht", "shots_on_target");
    if (shotsOnHt) {
      sr.ht_shots_on_target_home = shotsOnHt.home;
      sr.ht_shots_on_target_away = shotsOnHt.away;
    }
    const shotsOnSh = extractStat(statsArr, "sh", "shots_on_target");
    if (shotsOnSh) {
      sr.sh_shots_on_target_home = shotsOnSh.home;
      sr.sh_shots_on_target_away = shotsOnSh.away;
    }
  }

  return sr;
}

// ═══ MARKET PATTERN MATCHING ═══

interface MarketPattern {
  pattern: RegExp;
  key: string;
  lineGroup?: number; // capture group index for the line
  setGroup?: number; // capture group index for the set number
}

// Auto-VOID patterns — markets we cannot settle (need player data, in-play, etc.)
// NOTE: Quarti basket, periodi hockey, corner, cartellini, tiri are NOW settlable
// and have been REMOVED from this list. They are handled by MARKET_PATTERNS + SETTLERS.
const VOID_PATTERNS: RegExp[] = [
  /^.+\s\|\s/,  // All player markets (contain " | " separator)
  /^Marcatore\s+al\s+90/i,
  /^Doppietta\s+al\s+90/i,
  /^Tripletta\s+al\s+90/i,
  /^Pros\s+Marc/i,
  /^Marc\s*\+/i,
  /^(1X2|U\/O)\s+Interv\./i,
  // ── Corner/angoli: keep only race/primo types ──
  // Family B out-of-scope (require minute-level timeline data we do not ingest):
  //   - "Primo Corner Squadra" (subset of /^Primo Corner/i)
  //   - "Gara A N Corner" (race-to-N)
  //   - "1X2 Corner - Prima Metà/Meta" (half-specific 1X2 corner)
  /^Gara\s+A\s+\d+\s+Corner/i,
  /^Corner successivo/i,
  // "Calci d'angolo - Minuto X" / "Calci d'angolo - Prossimo" etc. (unsettlable race markets)
  // NOTE: "Calci d'angolo - 1X2 con Handicap" and HT/SH corner markets are settled below
  /^Calci d'angolo\s+-\s+(?!1X2 con Handicap|Totale|Più|1X2|Handicap\s+[12]°?\s*Tempo)/i,
  /^1X2\s+Corner\s+-\s+Prima\s+Mett[aà]/i,
  /^Primo\s+Angolo/i,
  /^Primo Corner/i,
  /^Espulsione/i,
  /^Piazzato\s+Sul\s+Podio/i,
  // ── Tennis per-game ──
  /^T\/T\s+(Set|Punto)\s+\d+\s+Gioco/i,
  /^Set\s+\d+\s+Gioco\s+\d+/i,
  /^T\/T\s+Punto\s+\d+/i,
  /^Vincente\s+Entrambi\s+Giochi/i,
  /^Set\s+\d+\s+Chi\s+(Arriva|Vince)/i,
  /^Risultato\s+Esatto\s+Tiebreak/i,
  // ── Esports ──
  /^Prima\s+(Torre|Eliminazione|Barone|Inhibitor)/i,
  /^Primo\s+(Barone|Inhibitor)/i,
  /^U\/O\s+Mappe/i,
  /^T\/T\s+Mappa\s+\d+/i,
  /^Vincente\s+Titolo/i,
  /^Vincente Mappa\s+\d/i,
  /^Vincente Incontro \+ Vincente Mappa/i,
  /^Mappa \d+:/i,
  /^1X2 Mappa/i,
  /Vince Almeno 1 Mappa/i,
  // ── Props ──
  /^Modalit[àa]\b.*Vittoria/i,
  /^Margine\s+Vittoria/i,
  /^Segna\s+Goal\s+Interv/i,
  /^Prossimo\s+Gol/i,
  /^(Giocat|Giocatore)\.\s+\d+\s+(U\/O|Vince\s+1)/i,
  /^Vincente a 0\s+1T/i,
  // Tennis per-set (non-games based)
  /^Under\/Over\s+\d+°\s+Set/i,
  /^Pari\/Dispari\s+Punti\s+Set\s+\d+\s+Gioco/i,
  // ── Gol props ──
  /^Gara\s+A\s+\d+\s+Gol/i,
  /^Vince\s+(Almeno|Entrambi)\s/i,
  /^Ribaltone\s/i,
  /^Autorete\s/i,
  /^Gol\s+Nei\s+Primi/i,
  /^1X2\s+10\s+Minuti/i,
  /^Squadra\s+(Casa|Ospite)\s+Segna\s+\d/i,
  /^Marcatore\s+(Entrambi|1°|2°)/i,
  /^Primo\s+Marcatore\s+Squadra/i,
  // ── Handicap Punti (basketball/sports — complex point handicap) ──
  /^Handicap Punti\b/i,
  // ── Exact score per period (too complex to settle) ──
  /^Risultato esatto\s+-\s+\d+°\s*Periodo$/i,
  // ── Cumulative quarter markets (complex, low volume) ──
  /^Risultato al termine del\s+\d+°\s*Quarto$/i,
  /^Totale punti\s+-\s+Risultato alla fine del\s+\d+°\s*Quarto/i,
  /^Handicap\s+-\s+Risultato al termine del\s+\d+°\s*Quarto/i,
  /^Draw No Bet\s+-\s+Risultato al termine del\s+\d+°\s*Quarto$/i,
  /^Primo tempo\/Fine partita\s+-\s+Fine del\s+\d+°\s*Quarto$/i,
  /^Prima a\s+\d+\s+corner/i,
  // ── Minuti ──
  /^1X2\s+\d+\s+Minuti/i,
  // ── Props varie ──
  /^Metodo Primo Gol/i,
  /^Tempo Primo Gol/i,
  /^Tempo Con Più Gol/i,
  /^Rigore\s/i,
  /^Numero Esatto Gol/i,
  /^Squadra Segna Gol/i,
  /^Vincente \(Incl\./i,
  /^Quarto Con Più Punti/i,
  /^Falli\s/i,
  /^Rinvii\s/i,
  // ── Tennis match-level ──
  /^Entrambi Vincono Un Set/i,
  /^G\d Vince Almeno/i,
  /^Deuce\s/i,
  /^Tiebreak\s+Set\s+\d/i,
  /^Risultato Esatto Set\s+\d/i,
  /^Gara A \d+ Games Set/i,
  /^T\/T Handicap Games Set/i,
  /^U\/O Games Set/i,
  /^Pari\/Dispari Games Set/i,
  /^Vincente Set \d+ Game/i,
  /^Pari\/Dispari Punti Set/i,
  /^In Vantaggio Dopo/i,
  /^Risultato Esatto \(Best Of/i,
  // ── Power Play (hockey) ──
  /^Power Play/i,
  /^U\/O Gol PP/i,
  /^Handicap Gol PP/i,
  /^DC Gol PP/i,
  /^Risultato Gol PP/i,
  // ── Player props (stat suffix) ──
  /\bPassaggi Completati\b/i,
  /\bContrasti Difensivi\b/i,
  /\bAssist$/i,
  /\bFalli$/i,
  /\bParate$/i,
  /\bRespinte$/i,
  /\bFuorigioco$/i,
  /\bCross$/i,
  // ── Gol race/marcatore ──
  /^Gara A \d+ Gol/i,
  /^Marcatore 2\+/i,
  /^Primo Marcatore (Casa|Ospite)/i,
  /^Marcatore Piede/i,
  /^Marcatore Di Testa/i,
  /^Marcatore Fuori Area/i,
  // ── Stats/Props aggiuntivi ──
  /^Primo Cartellino/i,
  /^Cartellino rosso/i,
  /^1X2 Falli/i,
  /^Contrasti Totali/i,
  /^Rimesse Laterali/i,
  /^Quale Squadra Segna/i,
  /^Ultima Squadra/i,
  /^Tempo Più Gol/i,
  /^Entrambi Tempi (Over|Under)/i,
  /^U\/O 3-Way/i,
  /^Punti Extra Set/i,
  /^Squadra .+ Segna Entrambi/i,
  /^Shootout$/i,
  /^U\/O\s+(Tempi\s+Reg\.|Team\s+\d+\s+Tempi\s+Reg\.)/i,
  /^1°?\s*Quarto\s+Gara/i,
  /^T\/T\s+Handicap\s+\d+°\s+Tempo/i,
  /^Over\/Under\s+\d+°\s+(Tempo|Set)/i,
  /^Pari\/Dispari\s+\d+°\s+Tempo/i,
  // ── Kambi-specific ──
  /^Primo marcatore$/i,
  /^Segna almeno \d+ gol/i,
  /^Segna \d+$/i,
  /^Entrambe le squadre realizzano almeno \d+ gol/i,
  /^Entrambe le squadre segnano almeno \d+ gol/i,
  /^2nd Half\b/i,
  /^Draw No Bet\s+-\s+2nd Half/i,
];

// Priority-ordered pattern array: first match wins
const MARKET_PATTERNS: MarketPattern[] = [
  // ─── Football FT Core ───
  { pattern: /^1X2$/, key: "1X2" },
  { pattern: /^1X2 Tempi Reg\.$/, key: "1X2" },
  { pattern: /^Esito [Ff]inale 1X2$/, key: "1X2" },
  { pattern: /^Esito Finale 1x2\s+-\s+Tempo regolamentare$/i, key: "1X2" },
  { pattern: /^Supplementari e rigori inclusi$/, key: "1X2" },
  { pattern: /^Tempo Regolamentare$/, key: "1X2" },
  { pattern: /^U\/O\s+([\d.]+)$/, key: "O/U", lineGroup: 1 },
  { pattern: /^Under\/Over\s+([\d.]+)$/, key: "O/U", lineGroup: 1 },
  { pattern: /^Under\/Over$/, key: "O/U" },
  { pattern: /^Gol totali\s+-\s+Tempo Regolamentare\s+([\d.]+)$/i, key: "O/U", lineGroup: 1 },
  { pattern: /^Gol totali\s+-\s+Supplementari e rigori inclusi\s+([\d.]+)$/i, key: "O/U", lineGroup: 1 },
  { pattern: /^GG\/NG$/, key: "GG/NG" },
  { pattern: /^Gol\/NoGol$/, key: "GG/NG" },
  { pattern: /^Goal\/No Goal$/, key: "GG/NG" },
  { pattern: /^Gol\/No\s+Gol$/i, key: "GG/NG" },
  { pattern: /^Entrambe le squadre segnano\s+-\s+Tempo regolamentare\s+\(Gol\/No Gol\)$/i, key: "GG/NG" },
  { pattern: /^Entrambe le squadre segnano\s+-\s+Supplementari e rigori inclusi$/i, key: "GG/NG" },
  { pattern: /^DC$/, key: "DC" },
  { pattern: /^Doppia Chance$/, key: "DC" },
  { pattern: /^Doppia Chance\s+-\s+Tempo regolamentare$/i, key: "DC" },
  { pattern: /^Draw No Bet$/, key: "DNB" },
  { pattern: /^Draw No Bet\s+-\s+Tempo regolamentare$/i, key: "DNB" },
  { pattern: /^Ris(?:ultato)?\.?\s*[Ee]satto(?:\s+\d+\s+Esiti)?$/, key: "EXACT_SCORE" },
  { pattern: /^Risultato esatto\s+-\s+(?:Tempo regolamentare|Supplementari e rigori inclusi)$/i, key: "EXACT_SCORE" },
  { pattern: /^1X2\s+H\s+\(([+-]?[\d.]+)\)$/, key: "HANDICAP", lineGroup: 1 },
  { pattern: /^1X2\s+H\s+(-?[\d.]+)$/, key: "HANDICAP", lineGroup: 1 },
  { pattern: /^1X2\s+H$/, key: "HANDICAP" },
  { pattern: /^1X2\s+Handicap\b/, key: "HANDICAP" },
  { pattern: /^1X2\s+Hand$/, key: "HANDICAP" },
  { pattern: /^Handicap Asiatico\b/, key: "HANDICAP" },
  { pattern: /^Handicap\s+Corner\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS", lineGroup: 1 },
  // GAP 1: "Calci d'angolo - 1X2 con Handicap (-1)" / "(+1.5)" etc.
  { pattern: /^Calci d'angolo\s+-\s+1X2 con Handicap\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS", lineGroup: 1 },
  // Kambi verbose: "Handicap - 1° Quarto (-1.5)" — must be before catch-all
  { pattern: /^Handicap\s+-\s+(\d+)°\s*Quarto\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_QUARTER", setGroup: 1, lineGroup: 2 },
  // Kambi verbose: "Handicap - 3° Periodo (-1)" / "Handicap -1° Periodo (-1)"
  { pattern: /^Handicap\s*-\s*(\d+)°\s*Periodo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_PERIOD", setGroup: 1, lineGroup: 2 },
  // Kambi verbose: "1X2 con Handicap - Cartellini (-1)"
  { pattern: /^1X2 con Handicap\s+-\s+Cartellini\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CARDS", lineGroup: 1 },
  // Family B: handicap corners HT/SH — must precede /^Handicap\b/ catch-all
  { pattern: /^Handicap\s+Corner\s+1°?\s*T\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_HT", lineGroup: 1 },
  { pattern: /^Handicap\s+Corner\s+2°?\s*T\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_SH", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Handicap\s+1°?\s*Tempo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_HT", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Handicap\s+2°?\s*Tempo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CORNERS_SH", lineGroup: 1 },
  // Family B: handicap HT cards — must precede /^Handicap\b/ catch-all
  { pattern: /^Handicap\s+Cartellini\s+1°?\s*T\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_CARDS_HT", lineGroup: 1 },
  { pattern: /^Handicap\b/, key: "HANDICAP" },
  { pattern: /^(?:Somma Gol|Multigol)$/, key: "GOALS_BAND" },
  { pattern: /^P\/D$/, key: "ODD_EVEN" },
  { pattern: /^Pari\/Dispari$/, key: "ODD_EVEN" },
  { pattern: /^Gol totali\s+-\s+Pari\/Dispari\s+-\s+Primo tempo$/i, key: "ODD_EVEN_HT" },

  // ─── Football HT markets ───
  { pattern: /^Draw No Bet\s+1T$/i, key: "DNB_HT" },
  { pattern: /^Draw No Bet\s+-\s+2°?\s*tempo$/i, key: "DNB_SH" },
  { pattern: /^1X2\s+1T$/, key: "1X2_HT" },
  { pattern: /^1X2\s+(?:Primo Tempo|1°?\s*Tempo)$/, key: "1X2_HT" },
  // GAP 3: "1x2 con Handicap - 1° tempo (-1)" / "(+1.5)"
  { pattern: /^1[xX]2\s+con\s+Handicap\s+-\s+1°?\s*[Tt]empo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_HT", lineGroup: 1 },
  { pattern: /^Handicap\s+-\s+1°?\s*[Tt]empo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_HT", lineGroup: 1 },
  // GAP 4: "Handicap Asiatico - 1° tempo (-0.5)" / "(+1)"
  { pattern: /^Handicap\s+Asiatico\s+-\s+1°?\s*[Tt]empo\s+\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_ASIAN_HT", lineGroup: 1 },
  { pattern: /^U\/O\s+1T\s+([\d.]+)$/, key: "O/U_HT", lineGroup: 1 },
  { pattern: /^U\/O\s+1°?\s*Tempo\s+([\d.]+)$/, key: "O/U_HT", lineGroup: 1 },
  { pattern: /^Under\/Over\s+1°?\s*Tempo\s+([\d.]+)$/, key: "O/U_HT", lineGroup: 1 },
  { pattern: /^Under\/Over\s+1°?\s*Tempo$/, key: "O/U_HT" },
  // GAP 5: Totale Asiatico 1° tempo — uses Asian O/U settler for quarter-point lines
  { pattern: /^Totale Asiatico\s+-\s+1°?\s*tempo\s+([\d.]+)$/i, key: "O/U_HT_ASIAN", lineGroup: 1 },
  { pattern: /^DC\s+1°?\s*Tempo$/, key: "DC_HT" },
  { pattern: /^DC\s+2°?\s*Tempo$/, key: "DC_SH" },
  { pattern: /^(?:GG\/NG|Gol\/NoGol)\s+1°?\s*Tempo$/, key: "GG/NG_HT" },
  { pattern: /^Entrambe le squadre segnano\s+-\s+2°?\s*tempo\s+\(Gol\/No Gol\)$/i, key: "GG/NG_SH" },
  { pattern: /^Risultato Esatto\s+1°?\s*Tempo$/, key: "EXACT_SCORE_HT" },
  { pattern: /^(?:Somma Gol|Multigol)\s+1°?\s*Tempo$/, key: "GOALS_BAND_HT" },
  { pattern: /^Pari\/Dispari\s+1°?\s*Tempo$/, key: "ODD_EVEN_HT" },
  { pattern: /^U\/O\s+Casa\s+1°T\s+([\d.]+)$/, key: "O/U_HOME_HT", lineGroup: 1 },
  { pattern: /^U\/O\s+Ospite\s+1°T\s+([\d.]+)$/, key: "O/U_AWAY_HT", lineGroup: 1 },

  // ─── Football 2nd Half markets ───
  { pattern: /^1X2\s+Secondo\s+Tempo$/, key: "1X2_SH" },
  { pattern: /^1X2\s+2T$/, key: "1X2_SH" },
  { pattern: /^1X2\s+2°?\s*Tempo$/, key: "1X2_SH" },
  { pattern: /^Under\/Over\s+2°?\s*Tempo\s*([\d.]+)?$/, key: "O/U_SH", lineGroup: 1 },
  { pattern: /^U\/O\s+2T\s+([\d.]+)$/, key: "O/U_SH", lineGroup: 1 },
  { pattern: /^U\/O\s+2°?\s*Tempo\s+([\d.]+)$/, key: "O/U_SH", lineGroup: 1 },
  { pattern: /^U\/O\s+Casa\s+2°T\s*([\d.]+)?$/, key: "O/U_HOME_SH", lineGroup: 1 },
  { pattern: /^U\/O\s+Ospite\s+2°T\s*([\d.]+)?$/, key: "O/U_AWAY_SH", lineGroup: 1 },
  { pattern: /^Vincente a 0\s+2T\s+Casa$/, key: "WIN_NIL_SH_HOME" },
  { pattern: /^Vincente a 0\s+2T\s+Ospite$/, key: "WIN_NIL_SH_AWAY" },

  // ─── Football Team-specific ───
  { pattern: /^Under\/Over\s+Casa\s+([\d.]+)$/, key: "O/U_HOME", lineGroup: 1 },
  { pattern: /^Under\/Over\s+Ospite\s+([\d.]+)$/, key: "O/U_AWAY", lineGroup: 1 },
  { pattern: /^U\/O\s+Casa\s+([\d.]+)$/, key: "O/U_HOME", lineGroup: 1 },
  { pattern: /^U\/O\s+Ospite\s+([\d.]+)$/, key: "O/U_AWAY", lineGroup: 1 },
  { pattern: /^U\/O\s+Punti\s+Casa\s*([\d.]+)?$/, key: "O/U_HOME", lineGroup: 1 },
  { pattern: /^U\/O\s+Punti\s+Ospite\s*([\d.]+)?$/, key: "O/U_AWAY", lineGroup: 1 },
  { pattern: /^(?:Somma Gol|Multigol)\s+Casa$/, key: "GOALS_BAND_HOME" },
  { pattern: /^(?:Somma Gol|Multigol)\s+Ospite$/, key: "GOALS_BAND_AWAY" },
  { pattern: /^Rete Inviolata\s+Casa$/, key: "CLEAN_SHEET_HOME" },
  { pattern: /^Rete Inviolata\s+Ospite$/, key: "CLEAN_SHEET_AWAY" },
  { pattern: /^Vincente\s+A\s+0\s+Squadra\s+Casa$/i, key: "WIN_NIL_HOME" },
  { pattern: /^Vincente\s+A\s+0\s+Squadra\s+Ospite$/i, key: "WIN_NIL_AWAY" },
  { pattern: /^Pari\/Dispari\s+Casa$/, key: "ODD_EVEN_HOME" },
  { pattern: /^Pari\/Dispari\s+Ospite$/, key: "ODD_EVEN_AWAY" },

  // ─── Football Combos ───
  { pattern: /^1X2\s*\+\s*U\/O\s+([\d.]+)$/, key: "COMBO_1X2_OU", lineGroup: 1 },
  { pattern: /^1X2\s*\+\s*Under\/Over\s*([\d.]+)?$/, key: "COMBO_1X2_OU", lineGroup: 1 },
  { pattern: /^1X2\s*\+\s*(?:GG\/NG|Gol\/NoGol)$/, key: "COMBO_1X2_GG" },
  { pattern: /^DC\s*\+\s*(?:GG\/NG|Gol\/NoGol)$/, key: "COMBO_DC_GG" },
  { pattern: /^DC\s*\+\s*Under\/Over\s+([\d.]+)$/, key: "COMBO_DC_OU", lineGroup: 1 },
  { pattern: /^DC\s*\+\s*U\/O\s+([\d.]+)$/, key: "COMBO_DC_OU", lineGroup: 1 },
  { pattern: /^DC\s*\+\s*Under\/Over$/, key: "COMBO_DC_OU" },
  { pattern: /^GG o Over\s+([\d.]+)$/, key: "GG_OR_OVER", lineGroup: 1 },
  { pattern: /^1X2\s*\+\s*(?:GG\/NG)\s+1°?\s*Tempo$/, key: "COMBO_1X2_GG_HT" },
  { pattern: /^1X2\s*\+\s*U\/O\s+1°?\s*Tempo\s*([\d.]+)?$/, key: "COMBO_1X2_OU_HT", lineGroup: 1 },
  { pattern: /^(?:GG\/NG|Gol\/NoGol)\s*\+\s*(?:Under\/Over|U\/O)\s*([\d.]+)?$/, key: "COMBO_GG_OU", lineGroup: 1 },

  // ─── Football HT/FT (Parziale/Finale) ───
  { pattern: /^Parziale\/Finale$/, key: "HT_FT" },
  { pattern: /^Esito\s+1T\/Finale$/, key: "HT_FT" },
  { pattern: /^Esito\s+1°\s*Tempo\/Finale$/, key: "HT_FT" },
  { pattern: /Primo Tempo.*Finale|1T.*2T|HT.*FT/i, key: "HT_FT" },
  { pattern: /^Tempo Con Maggior Gol 1X2$/, key: "HALF_MOST_GOALS" },

  // ─── Football Props ───
  { pattern: /^Prima Squadra A Segnare$/, key: "NEXT_GOAL" },
  { pattern: /^Segna Goal$/, key: "NEXT_GOAL" },
  { pattern: /^Passaggio Turno$/, key: "QUALIFY" },
  { pattern: /^Tempi Supplementari Si\/No$/, key: "OVERTIME_YN" },
  { pattern: /^Gol In Entrambi I Tempi/i, key: "GOAL_BOTH_HALVES" },
  { pattern: /^Gol segnato in entrambi i tempi$/i, key: "GOAL_BOTH_HALVES" },

  // ─── Tennis / Table Tennis ───
  { pattern: /^Vincente Incontro(?:\s+\(escl\.\s*ritiro\))?$/, key: "MATCH_WINNER" },
  { pattern: /^T\/T\s+(?:Risultato|Match)$/, key: "MATCH_WINNER" },
  { pattern: /^Vincente\s+\(escl\.\s*ritiro\)\s+Set\s+(\d+)$/, key: "SET_WINNER", setGroup: 1 },
  { pattern: /^Vincente\s+Set\s+(\d+)$/, key: "SET_WINNER", setGroup: 1 },
  { pattern: /^Vincente Set$/, key: "SET_WINNER" },
  { pattern: /^Set Betting\b/, key: "SET_BETTING" },
  { pattern: /^U\/O\s+Games\s+([\d.]+)$/, key: "O/U_GAMES", lineGroup: 1 },
  { pattern: /^Numero Totale Giochi\s*([\d.]+)?$/, key: "O/U_GAMES", lineGroup: 1 },
  { pattern: /^U\/O\s+(?:Giochi|Game)\s+Set\s+(\d+)\s+([\d.]+)$/, key: "O/U_GAMES_SET", setGroup: 1, lineGroup: 2 },
  { pattern: /^U\/O\s+(?:Giochi|Game)\s+Set\s+(\d+)$/i, key: "O/U_GAMES_SET", setGroup: 1 },
  { pattern: /^Numero Esatto Set$/, key: "EXACT_SETS" },
  { pattern: /^Set\s+(\d+)\s+Si\/No$/, key: "SET_PLAYED", setGroup: 1 },
  { pattern: /^Giocatore\s+(\d)\s+Vince Almeno Un Set$/, key: "PLAYER_WINS_SET", setGroup: 1 },
  { pattern: /^Giocat\.\s+(\d)\s+Vince Almeno Un Set$/i, key: "PLAYER_WINS_SET", setGroup: 1 },
  { pattern: /^T\/T\s+Handicap\s+Games\s+(-?[\d.]+)$/, key: "HANDICAP_GAMES", lineGroup: 1 },
  { pattern: /^Handicap Giochi\s+([\d.]+)$/, key: "HANDICAP_GAMES", lineGroup: 1 },
  { pattern: /^Pari\/Dispari\s+Games$/, key: "ODD_EVEN_GAMES" },
  { pattern: /^Pari\/Dispari\s+Numero\s+Giochi$/i, key: "ODD_EVEN_GAMES" },
  { pattern: /^Pari\/Dispari\s+Set\s+(\d+)$/, key: "ODD_EVEN_GAMES_SET", setGroup: 1 },
  { pattern: /^Pari\/Dispari\s+(\d+)°\s+Set$/i, key: "ODD_EVEN_GAMES_SET", setGroup: 1 },
  { pattern: /^Tiebreak Set$/, key: "TIEBREAK_YN" },
  { pattern: /^Tiebreak\s+Nel\s+Match\s+Si\/No$/i, key: "TIEBREAK_YN" },
  { pattern: /^Combo Set 1 & Match$/, key: "COMBO_SET1_MATCH" },
  { pattern: /^Ris\.\s*Esatto\s+Set\s*(\d+)?$/, key: "EXACT_SET_SCORE", setGroup: 1 },

  // ─── Tennis additional ───
  { pattern: /^Pari\/Dispari\s+Set$/i, key: "ODD_EVEN_SETS" },
  { pattern: /^Almeno\s+Un\s+Set\s+6-0\s+o\s+0-6$/i, key: "BAGEL_SET" },
  { pattern: /^U\/O\s+Set\s+Totali\s*([\d.]+)?$/i, key: "O/U_SETS", lineGroup: 1 },
  { pattern: /^Set\s+(\d+)\s+T\/T\s+Handicap\s+Giochi$/i, key: "HANDICAP_SET", setGroup: 1 },

  // ─── Basketball Quarters ───
  { pattern: /^1X2\s+-\s+(\d+)°\s+Quarto$/i, key: "1X2_QUARTER", setGroup: 1 },
  { pattern: /^(\d+)°\s*Quarto$/i, key: "1X2_QUARTER", setGroup: 1 },
  { pattern: /^Under\/Over\s+(\d+)°\s+Quarto\s+([\d.]+)$/i, key: "O/U_QUARTER", setGroup: 1, lineGroup: 2 },
  { pattern: /^Over\/Under\s+(\d+)°\s+Quarto\s+([\d.]+)$/i, key: "O/U_QUARTER", setGroup: 1, lineGroup: 2 },
  { pattern: /^U\/O\s+(\d+)°\s+Quarto\s+([\d.]+)$/i, key: "O/U_QUARTER", setGroup: 1, lineGroup: 2 },
  // Kambi verbose: "Punti totali - 1° Quarto 57.5"
  { pattern: /^Punti totali\s+-\s+(\d+)°\s+Quarto\s+([\d.]+)$/i, key: "O/U_QUARTER", setGroup: 1, lineGroup: 2 },
  { pattern: /^Pari\/Dispari\s+(\d+)°\s+Quarto$/i, key: "ODD_EVEN_QUARTER", setGroup: 1 },
  { pattern: /^Draw No Bet\s+-\s+(\d+)°\s*Quarto$/i, key: "DNB_QUARTER", setGroup: 1 },
  { pattern: /^T\/T\s+Handicap\s+(\d+)°\s+Quarto\s+([+-]?[\d.]+)$/i, key: "HANDICAP_QUARTER", setGroup: 1, lineGroup: 2 },
  { pattern: /^1x2 con Handicap\s+-\s+(\d+)°\s+Quarto\s*\(?([+-]?[\d.]+)\)?$/i, key: "HANDICAP_QUARTER", setGroup: 1, lineGroup: 2 },

  // ─── Hockey Periods ───
  { pattern: /^1X2\s+(\d+)°\s+Periodo$/i, key: "1X2_PERIOD", setGroup: 1 },
  { pattern: /^(\d+)°\s*Periodo$/i, key: "1X2_PERIOD", setGroup: 1 },
  { pattern: /^U\/O\s+(\d+)°\s+Periodo\s+([\d.]+)$/i, key: "O/U_PERIOD", setGroup: 1, lineGroup: 2 },
  { pattern: /^Under\/Over\s+(\d+)°\s+Periodo\s+([\d.]+)$/i, key: "O/U_PERIOD", setGroup: 1, lineGroup: 2 },
  // Kambi verbose: "Totale gol - 1° Periodo 1.5"
  { pattern: /^Totale gol\s+-\s+(\d+)°\s+Periodo\s+([\d.]+)$/i, key: "O/U_PERIOD", setGroup: 1, lineGroup: 2 },
  // Kambi verbose: "Doppia chance - Periodo 1" / "Doppia chance - 3° Periodo"
  { pattern: /^Doppia chance\s+-\s+Periodo\s+(\d+)$/i, key: "DC_PERIOD", setGroup: 1 },
  { pattern: /^Doppia chance\s+-\s+(\d+)°\s+Periodo$/i, key: "DC_PERIOD", setGroup: 1 },
  // Kambi verbose: "Entrambe le squadre segnano - 1° Periodo (Gol/No Gol)"
  { pattern: /^Entrambe le squadre segnano\s+-\s+(\d+)°\s+Periodo\s+\(Gol\/No Gol\)$/i, key: "GG_NG_PERIOD", setGroup: 1 },
  // Kambi verbose: "Draw No Bet - 1° Periodo"
  { pattern: /^Draw No Bet\s+-\s+(\d+)°\s+Periodo$/i, key: "DNB_PERIOD", setGroup: 1 },

  // ─── Corner/Angoli markets ───
  // GAP 2: HT corners — must be before catch-all FT corner patterns
  { pattern: /^Totale calci d'angolo\s+-\s+1°\s*[Tt]empo\s+([\d.]+)$/i, key: "O/U_CORNERS_HT", lineGroup: 1 },
  { pattern: /^U\/O\s+(?:Angoli|Corner)\s+1°?\s*[Tt]empo\s+([\d.]+)$/i, key: "O/U_CORNERS_HT", lineGroup: 1 },
  { pattern: /^Più calci d'angolo\s+-\s+1°\s*[Tt]empo$/i, key: "1X2_CORNERS_HT" },
  { pattern: /^1X2\s+(?:Angoli|Corner)\s+1°?\s*[Tt]empo$/i, key: "1X2_CORNERS_HT" },
  { pattern: /^Calci d'angolo\s+-\s+Totale\s+1°\s*[Tt]empo\s+([\d.]+)$/i, key: "O/U_CORNERS_HT", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Più\s+1°\s*[Tt]empo$/i, key: "1X2_CORNERS_HT" },
  // GAP 2: SH corners
  { pattern: /^Totale calci d'angolo\s+-\s+2°\s*[Tt]empo\s+([\d.]+)$/i, key: "O/U_CORNERS_SH", lineGroup: 1 },
  { pattern: /^U\/O\s+(?:Angoli|Corner)\s+2°?\s*[Tt]empo\s+([\d.]+)$/i, key: "O/U_CORNERS_SH", lineGroup: 1 },
  { pattern: /^Più calci d'angolo\s+-\s+2°\s*[Tt]empo$/i, key: "1X2_CORNERS_SH" },
  { pattern: /^1X2\s+(?:Angoli|Corner)\s+2°?\s*[Tt]empo$/i, key: "1X2_CORNERS_SH" },
  { pattern: /^Calci d'angolo\s+-\s+Totale\s+2°\s*[Tt]empo\s+([\d.]+)$/i, key: "O/U_CORNERS_SH", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Più\s+2°\s*[Tt]empo$/i, key: "1X2_CORNERS_SH" },
  // ─── Family A: team-split corners O/U ───
  { pattern: /^O\/U\s+Corner\s+Casa\s+([\d.]+)$/i, key: "O/U_CORNER_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Corner\s+Ospite\s+([\d.]+)$/i, key: "O/U_CORNER_AWAY", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Totale\s+Casa\s+([\d.]+)$/i, key: "O/U_CORNER_HOME", lineGroup: 1 },
  { pattern: /^Calci d'angolo\s+-\s+Totale\s+Ospite\s+([\d.]+)$/i, key: "O/U_CORNER_AWAY", lineGroup: 1 },
  // FT corners (catch-all, after HT/SH variants)
  { pattern: /^U\/O\s+(?:Angoli|Corner)\s+([\d.]+)$/i, key: "O/U_CORNERS", lineGroup: 1 },
  { pattern: /^Totale calci d'angolo\s+([\d.]+)$/i, key: "O/U_CORNERS", lineGroup: 1 },
  { pattern: /^Corners\s+U\/O\s+([\d.]+)$/i, key: "O/U_CORNERS", lineGroup: 1 },
  { pattern: /^1X2\s+(?:Angoli|Corner)$/i, key: "1X2_CORNERS" },
  { pattern: /^Più calci d'angolo$/i, key: "1X2_CORNERS" },
  // Family B: DC corners HT/SH — must precede bare /^DC\s+Corner$/
  { pattern: /^DC\s+Corner\s+1°?\s*T$/i, key: "DC_CORNERS_HT" },
  { pattern: /^DC\s+Corner\s+2°?\s*T$/i, key: "DC_CORNERS_SH" },
  { pattern: /^DC\s+Corner$/i, key: "DC_CORNERS" },
  { pattern: /^Fascia\s+Corner$/i, key: "CORNERS_BAND" },

  // ─── Card/Cartellini markets ───
  // Family B: HT cards (total) — must precede FT O/U catch-all
  { pattern: /^O\/U\s+Cartellini\s+1°?\s*T\s+([\d.]+)$/i, key: "O/U_CARDS_HT", lineGroup: 1 },
  { pattern: /^U\/O\s+Cartellini\s+1°?\s*T\s+([\d.]+)$/i, key: "O/U_CARDS_HT", lineGroup: 1 },
  { pattern: /^1X2\s+Cartellini$/i, key: "1X2_CARDS" },
  { pattern: /^U\/O\s+Cartellini\s+([\d.]+)$/i, key: "O/U_CARDS", lineGroup: 1 },
  // Kambi verbose: "Totale cartellini 5.5"
  { pattern: /^Totale cartellini\s+([\d.]+)$/i, key: "O/U_CARDS", lineGroup: 1 },
  // Kambi verbose: "Piú cartellini" / "Più cartellini"
  { pattern: /^Pi[uúù] cartellini$/i, key: "1X2_CARDS" },

  // ─── Shot/Tiri markets ───
  // ─── Family A: team-split shots O/U ───
  { pattern: /^O\/U\s+Tiri\s+Porta\s+Casa\s+([\d.]+)$/i, key: "O/U_SHOTS_ON_TARGET_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Tiri\s+Porta\s+Ospite\s+([\d.]+)$/i, key: "O/U_SHOTS_ON_TARGET_AWAY", lineGroup: 1 },
  { pattern: /^O\/U\s+Tiri\s+Casa\s+([\d.]+)$/i, key: "O/U_SHOTS_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Tiri\s+Ospite\s+([\d.]+)$/i, key: "O/U_SHOTS_AWAY", lineGroup: 1 },
  { pattern: /^U\/O\s+Tiri\s+In\s+Porta\s+([\d.]+)$/i, key: "O/U_SHOTS", lineGroup: 1 },
  { pattern: /^1X2\s+Tiri$/i, key: "1X2_SHOTS" },
  // Kambi verbose: "Totale tiri in porta (Scommesse refertate usando Opta) 8.5"
  { pattern: /^Totale tiri in porta\s+\(.*?\)\s+([\d.]+)$/i, key: "O/U_SHOTS", lineGroup: 1 },
  // Kambi verbose: "Più tiri in porta (Scommesse refertate usando Opta)"
  { pattern: /^Pi[uúù] tiri in porta\b/i, key: "1X2_SHOTS" },

  // ─── Family A: team-split goals O/U ───
  { pattern: /^O\/U\s+Gol\s+Casa\s+([\d.]+)$/i, key: "O/U_GOALS_HOME", lineGroup: 1 },
  { pattern: /^O\/U\s+Gol\s+Ospite\s+([\d.]+)$/i, key: "O/U_GOALS_AWAY", lineGroup: 1 },
  { pattern: /^Gol\s+totali\s+Casa\s+([\d.]+)$/i, key: "O/U_GOALS_HOME", lineGroup: 1 },
  { pattern: /^Gol\s+totali\s+Ospite\s+([\d.]+)$/i, key: "O/U_GOALS_AWAY", lineGroup: 1 },

  // ─── Basketball ───
  { pattern: /^U\/O\s+Incl\.?\s*Supp\.?\s*([\d.]+)?$/, key: "O/U", lineGroup: 1 },
  { pattern: /^U\/O\s+Incl\s+Supp\s*([\d.]+)?$/, key: "O/U", lineGroup: 1 },
  { pattern: /^1X2\s+Basket\s+\((\d+),(\d+)\s*p/i, key: "HANDICAP" },
  { pattern: /^Under\/Over\s+Punti\s+([\d.]+)$/, key: "O/U", lineGroup: 1 },
  { pattern: /^U\/O\s+Punti\s+Nell.Incontro\s+([\d.]+)$/, key: "O/U", lineGroup: 1 },
  { pattern: /^Pari\/Dispari\s+Incl\.?\s*Supp\.?$/, key: "ODD_EVEN" },
  { pattern: /^U\/O\s+Casa\s+Incl\.?\s*Supp\.?\s*([\d.]+)?$/i, key: "O/U_HOME", lineGroup: 1 },
  { pattern: /^U\/O\s+Ospite\s+Incl\.?\s*Supp\.?\s*([\d.]+)?$/i, key: "O/U_AWAY", lineGroup: 1 },
  { pattern: /^T\/T\s+Risultato\s*\+\s*U\/O\s+Incl\.?\s*Supp\.?$/i, key: "COMBO_1X2_OU" },

  // ─── Generic / sport-agnostic (catch-all) ───
  { pattern: /^T\/T\s+Handicap\s+\(([+-]?[\d.]+)\)$/, key: "HANDICAP_POINTS", lineGroup: 1 },
  { pattern: /^T\/T\s+Handicap\s+(-?[\d.]+)$/, key: "HANDICAP_POINTS", lineGroup: 1 },
  { pattern: /^T\/T\s+Handicap\s+(?:1°|2°|3°|4°)\s*Set\s+(-?[\d.]+)$/, key: "HANDICAP_SET", lineGroup: 1 },
  { pattern: /^Testa\s+[Aa]\s+Testa\s+Handicap/i, key: "HANDICAP_POINTS" },
  { pattern: /^Testa\s+[Aa]\s+Testa$/i, key: "MATCH_WINNER" },

  // ─── Hockey / generic ───
  { pattern: /^Entrambe\s+Segnano\s+Almeno\s+(\d+)\s+Goal$/i, key: "BOTH_SCORE_N", lineGroup: 1 },
];

// ═══ resolveSettlerKey — maps source market names → settler key ═══
//
// Dispatch order:
//   1. Auto-VOID regex (unchanged) — fast path for unsettlable markets.
//   2. MARKET_PATTERNS regex (unchanged) — fast path for Kambi Italian naming
//      and known legacy verbose forms.
//   3. Canonical fallback (Phase B) — looks up (source, market_type) in
//      market_normalization. If a trusted mapping exists and its canonical_key
//      is registered in CANONICAL_TO_SETTLER, dispatch to that settler.
//   4. Return null → void.

function resolveSettlerKey(
  marketType: string,
  marketLine?: number | null,
  source?: string | null,
  lookups?: CanonicalLookups | null
): { key: string; line?: number; setIdx?: number; canonicalKey?: string } | null {
  const mt = marketType.trim();

  // Check auto-VOID patterns first
  for (const vp of VOID_PATTERNS) {
    if (vp.test(mt)) return null;
  }

  // Try each pattern in priority order
  for (const mp of MARKET_PATTERNS) {
    const m = mt.match(mp.pattern);
    if (!m) continue;

    let line: number | undefined;
    let setIdx: number | undefined;

    // Extract line from capture group or fall back to market.line
    if (mp.lineGroup && m[mp.lineGroup]) {
      line = parseFloat(m[mp.lineGroup]);
    } else if (marketLine != null) {
      line = marketLine;
    }

    // Extract set index from capture group
    if (mp.setGroup && m[mp.setGroup]) {
      setIdx = parseInt(m[mp.setGroup], 10);
    }

    // Special: basketball "1X2 Basket (5,5 punti)" → handicap line
    if (mp.key === "HANDICAP" && /^1X2\s+Basket/.test(mt)) {
      const bm = mt.match(/\((\d+),(\d+)\s*p/);
      if (bm) {
        line = parseFloat(`${bm[1]}.${bm[2]}`);
      }
    }

    // Special: Handicap line extraction from various formats
    if (mp.key === "HANDICAP" && line == null) {
      const hm = mt.match(/(-?[\d.]+)\s*\)?$/);
      if (hm) line = parseFloat(hm[1]);
    }

    return { key: mp.key, line, setIdx };
  }

  // Canonical fallback (Phase B + C)
  if (source && lookups) {
    const canonical = resolveCanonicalSettler(source, mt, marketLine, lookups);
    if (canonical) {
      return {
        key: canonical.key,
        line: canonical.line,
        setIdx: canonical.setIdx,
        canonicalKey: canonical.canonicalKey,
      };
    }
  }

  // No match → void
  return null;
}

// ═══ SETTLER HELPERS ═══

function isOverSel(sel: string): boolean {
  return /^(over|ov|o)$/i.test(sel.trim());
}

function isUnderSel(sel: string): boolean {
  return /^(under|un|u)$/i.test(sel.trim());
}

function isYes(sel: string): boolean {
  return /^(si|sì|yes|1)$/i.test(sel.trim());
}

function isNo(sel: string): boolean {
  return /^(no|2)$/i.test(sel.trim());
}

function settleOU(total: number, sel: string, line?: number): Verdict {
  if (line == null) return "void";
  if (total === line) return "push";
  if (isOverSel(sel) && total > line) return "won";
  if (isUnderSel(sel) && total < line) return "won";
  if (isOverSel(sel) && total < line) return "lost";
  if (isUnderSel(sel) && total > line) return "lost";
  return "lost";
}

// Asian O/U: supports quarter-point lines (1.25, 1.75, 2.25, etc.)
// Quarter-point lines split stake between two adjacent full/half lines:
//   X.25 → split between X and X.5: if total == X → lower half push (overall push), if total == X+1 → full win
//   X.75 → split between X.5 and X+1: if total == X+1 → upper half push (overall push), if total == X → full loss
// In our engine push → void (refund), so partial push = push = void for simplicity.
function isQuarterPoint(line: number): boolean {
  // Handles both positive and negative values: abs(line % 1) ≈ 0.25 or 0.75
  const frac = Math.abs(line % 1);
  return Math.abs(frac - 0.25) < 0.001 || Math.abs(frac - 0.75) < 0.001;
}

function settleOUAsian(total: number, sel: string, line?: number): Verdict {
  if (line == null) return "void";
  // Quarter-point lines
  if (isQuarterPoint(line)) {
    const lower = Math.floor(line * 2) / 2; // round down to nearest 0.5
    const upper = lower + 0.5;
    // Settle against both halves
    const lowerV = settleOU(total, sel, lower);
    const upperV = settleOU(total, sel, upper);
    if (lowerV === upperV) return lowerV;
    // Mismatched (one push/one win or one win/one lost) → push (partial refund)
    if (lowerV === "push" || upperV === "push") {
      // Half push + half win → push overall (conservative)
      return "push";
    }
    // Half won + half lost → push (stake returned)
    return "push";
  }
  // Regular half/full lines
  return settleOU(total, sel, line);
}

// Asian handicap: supports quarter-point lines
function settleHandicapAsian(homeScore: number, awayScore: number, sel: string, line?: number): Verdict {
  if (line == null) return "void";
  const s = sel.replace(/\s*H\s*$/i, "").trim();
  if (isQuarterPoint(line)) {
    const lower = Math.floor(line * 2) / 2;
    const upper = lower + 0.5;
    const adjHomeLower = homeScore + lower;
    const adjHomeUpper = homeScore + upper;
    const verdictLower = (() => {
      if (adjHomeLower === awayScore) return "push" as Verdict;
      if (s === "1" && adjHomeLower > awayScore) return "won" as Verdict;
      if (s === "2" && adjHomeLower < awayScore) return "won" as Verdict;
      return "lost" as Verdict;
    })();
    const verdictUpper = (() => {
      if (adjHomeUpper === awayScore) return "push" as Verdict;
      if (s === "1" && adjHomeUpper > awayScore) return "won" as Verdict;
      if (s === "2" && adjHomeUpper < awayScore) return "won" as Verdict;
      return "lost" as Verdict;
    })();
    if (verdictLower === verdictUpper) return verdictLower;
    return "push";
  }
  const adjHome = homeScore + line;
  if (adjHome === awayScore) return "push";
  if (s === "1" && adjHome > awayScore) return "won";
  if (s === "2" && adjHome < awayScore) return "won";
  return "lost";
}

function settle1X2(homeScore: number, awayScore: number, sel: string): Verdict {
  const s = sel.trim();
  if (homeScore > awayScore && s === "1") return "won";
  if (homeScore === awayScore && (s === "X" || s === "x")) return "won";
  if (homeScore < awayScore && s === "2") return "won";
  return "lost";
}

function settleDC(homeScore: number, awayScore: number, sel: string): Verdict {
  const s = sel.trim().toUpperCase();
  if (s === "1X" && homeScore >= awayScore) return "won";
  if (s === "X2" && homeScore <= awayScore) return "won";
  if (s === "12" && homeScore !== awayScore) return "won";
  return "lost";
}

function settleGGNG(homeScore: number, awayScore: number, sel: string): Verdict {
  const gg = homeScore > 0 && awayScore > 0;
  const selUp = sel.trim().toUpperCase();
  if ((selUp === "GG" || selUp === "GOL" || selUp === "SI" || selUp === "SÌ") && gg) return "won";
  if ((selUp === "NG" || selUp === "NOGOL" || selUp === "NO") && !gg) return "won";
  return "lost";
}

function settleGoalsBand(total: number, sel: string): Verdict {
  const st = sel.trim();
  // Single number: "0", "1", "2", "3", "4"
  if (/^\d+$/.test(st)) return total === parseInt(st, 10) ? "won" : "lost";
  // N+ format: "5+", "6+"
  if (/^\d+\+$/.test(st)) return total >= parseInt(st, 10) ? "won" : "lost";
  // Range: "0-1", "2-3", "4-5"
  const rangeMatch = st.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    if (total >= lo && total <= hi) return "won";
  }
  return "lost";
}

function settleExactScore(home: number, away: number, sel: string): Verdict {
  // Normalize both colon and dash format
  const norm = sel.trim().replace(":", "-");
  if (norm.toLowerCase() === "altro") {
    return (home > 4 || away > 4) ? "won" : "lost";
  }
  if (norm === `${home}-${away}`) return "won";
  return "lost";
}

function settleOddEven(total: number, sel: string): Verdict {
  const isEven = total % 2 === 0;
  const s = sel.trim().toUpperCase();
  // Pari = Even, Dispari = Odd
  if ((s === "PARI" || s === "P" || s === "EVEN") && isEven) return "won";
  if ((s === "DISPARI" || s === "D" || s === "DISP" || s === "ODD") && !isEven) return "won";
  return "lost";
}

function settleYesNo(condition: boolean, sel: string): Verdict {
  if (isYes(sel) && condition) return "won";
  if (isNo(sel) && !condition) return "won";
  return "lost";
}

// Helper: generic O/U settler parametrized by which numeric getter to use.
// Used by Family A per-team O/U markets (corners, shots, goals per team).
function makeTeamOU(getter: (sr: SettlementResult) => number | undefined): SettlerFn {
  return (sr, outcomeName, line) => {
    const v = getter(sr);
    if (v == null || line == null) return null;
    const n = outcomeName.trim().toLowerCase();
    const isOver = n === "over" || n.startsWith("over ");
    const isUnder = n === "under" || n.startsWith("under ");
    if (!isOver && !isUnder) return null;
    if (v === line) return "push";
    const won = isOver ? v > line : v < line;
    return won ? "won" : "lost";
  };
}

// Helper: generic total O/U settler parametrized by a total-value getter.
// Used by Family B for HT cards (total yellow+red over/under).
function makeTotalOU(getter: (sr: SettlementResult) => number | undefined): SettlerFn {
  return (sr, outcomeName, line) => {
    const v = getter(sr);
    if (v == null || line == null) return null;
    const n = outcomeName.trim().toLowerCase();
    const isOver = n === "over" || n.startsWith("over ");
    const isUnder = n === "under" || n.startsWith("under ");
    if (!isOver && !isUnder) return null;
    if (v === line) return "push";
    const won = isOver ? v > line : v < line;
    return won ? "won" : "lost";
  };
}

// Helper: generic Double Chance settler for per-period / per-stat DC markets.
// Outcomes: "1X" (home or draw), "12" (home or away), "X2" (draw or away).
// Used by Family B for HT/SH corners.
function makeDC(
  getHome: (sr: SettlementResult) => number | undefined,
  getAway: (sr: SettlementResult) => number | undefined
): SettlerFn {
  return (sr, outcomeName) => {
    const h = getHome(sr);
    const a = getAway(sr);
    if (h == null || a == null) return null;
    const n = outcomeName.trim().replace(/\s/g, "").toUpperCase();
    const homeWins = h > a;
    const draw = h === a;
    const awayWins = h < a;
    if (n === "1X") return homeWins || draw ? "won" : "lost";
    if (n === "12") return homeWins || awayWins ? "won" : "lost";
    if (n === "X2") return draw || awayWins ? "won" : "lost";
    return null;
  };
}

// Helper: generic handicap settler for per-period / per-stat 1X2-handicap markets.
// Line convention mirrors existing HANDICAP_CORNERS (FT): adjHome = h + line.
// Outcomes: "1"/"Casa" (home covers), "2"/"Ospite" (away covers), "X"/"Pareggio" (handicap push).
// Used by Family B for HT/SH corners and HT cards.
function makeHandicap(
  getHome: (sr: SettlementResult) => number | undefined,
  getAway: (sr: SettlementResult) => number | undefined
): SettlerFn {
  return (sr, outcomeName, line) => {
    const h = getHome(sr);
    const a = getAway(sr);
    if (h == null || a == null || line == null) return null;
    const n = outcomeName.trim();
    const isHome = n === "1" || /^casa$/i.test(n);
    const isAway = n === "2" || /^ospite$/i.test(n);
    const isDraw = n === "X" || /^pareggio$/i.test(n);
    if (!isHome && !isAway && !isDraw) return null;
    const adjHome = h + line;
    if (adjHome === a) return isDraw ? "won" : "push";
    if (isHome) return adjHome > a ? "won" : "lost";
    if (isAway) return adjHome < a ? "won" : "lost";
    // Draw selection but adjHome !== a → lost
    return "lost";
  };
}

// ═══ SETTLERS ═══

const SETTLERS: Record<string, SettlerFn> = {
  // ─── Football FT Core ───

  "1X2": (r, sel) => settle1X2(r.home, r.away, sel),

  "O/U": (r, sel, line) => settleOU(r.total, sel, line),

  "GG/NG": (r, sel) => settleGGNG(r.home, r.away, sel),

  DC: (r, sel) => settleDC(r.home, r.away, sel),

  DNB: (r, sel) => {
    if (r.home === r.away) return "void";
    if (sel.trim() === "1" && r.home > r.away) return "won";
    if (sel.trim() === "2" && r.home < r.away) return "won";
    return "lost";
  },

  EXACT_SCORE: (r, sel) => settleExactScore(r.home, r.away, sel),

  HANDICAP: (r, sel, line) => {
    if (line == null) return "void";
    const adjHome = r.home + line;
    if (adjHome === r.away) return "push";
    // Strip " H" suffix from outcome name
    const s = sel.replace(/\s*H\s*$/i, "").trim();
    if (s === "1" && adjHome > r.away) return "won";
    if ((s === "X" || s === "x") && adjHome === r.away) return "won";
    if (s === "2" && adjHome < r.away) return "won";
    return "lost";
  },

  GOALS_BAND: (r, sel) => settleGoalsBand(r.total, sel),

  ODD_EVEN: (r, sel) => settleOddEven(r.total, sel),

  // ─── Football HT ───

  "1X2_HT": (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    return settle1X2(r.ht_home, r.ht_away, sel);
  },

  "O/U_HT": (r, sel, line) => {
    if (r.ht_total == null) return "void";
    return settleOU(r.ht_total, sel, line);
  },

  DC_HT: (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    return settleDC(r.ht_home, r.ht_away, sel);
  },

  "GG/NG_HT": (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    return settleGGNG(r.ht_home, r.ht_away, sel);
  },

  EXACT_SCORE_HT: (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    return settleExactScore(r.ht_home, r.ht_away, sel);
  },

  GOALS_BAND_HT: (r, sel) => {
    if (r.ht_total == null) return "void";
    return settleGoalsBand(r.ht_total, sel);
  },

  ODD_EVEN_HT: (r, sel) => {
    if (r.ht_total == null) return "void";
    return settleOddEven(r.ht_total, sel);
  },

  "O/U_HOME_HT": (r, sel, line) => {
    if (r.ht_home == null) return "void";
    return settleOU(r.ht_home, sel, line);
  },

  "O/U_AWAY_HT": (r, sel, line) => {
    if (r.ht_away == null) return "void";
    return settleOU(r.ht_away, sel, line);
  },

  // GAP 3: 1x2 con Handicap - 1° tempo
  HANDICAP_HT: (r, sel, line) => {
    if (r.ht_home == null || r.ht_away == null || line == null) return "void";
    const adjHome = r.ht_home + line;
    if (adjHome === r.ht_away) return "push";
    const s = sel.replace(/\s*H\s*$/i, "").trim();
    if (s === "1" && adjHome > r.ht_away) return "won";
    if ((s === "X" || s === "x") && adjHome === r.ht_away) return "won";
    if (s === "2" && adjHome < r.ht_away) return "won";
    return "lost";
  },

  // GAP 4: Handicap Asiatico - 1° tempo (supports quarter-point lines)
  HANDICAP_ASIAN_HT: (r, sel, line) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    return settleHandicapAsian(r.ht_home, r.ht_away, sel, line);
  },

  // GAP 5: Totale Asiatico - 1° tempo (Asian O/U with quarter-point support)
  "O/U_HT_ASIAN": (r, sel, line) => {
    if (r.ht_total == null) return "void";
    return settleOUAsian(r.ht_total, sel, line);
  },

  DNB_HT: (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    if (r.ht_home === r.ht_away) return "void";
    if (sel.trim() === "1" && r.ht_home > r.ht_away) return "won";
    if (sel.trim() === "2" && r.ht_home < r.ht_away) return "won";
    return "lost";
  },

  DNB_SH: (r, sel) => {
    if (r.sh_home == null || r.sh_away == null) return "void";
    if (r.sh_home === r.sh_away) return "void";
    if (sel.trim() === "1" && r.sh_home > r.sh_away) return "won";
    if (sel.trim() === "2" && r.sh_home < r.sh_away) return "won";
    return "lost";
  },

  DC_SH: (r, sel) => {
    if (r.sh_home == null || r.sh_away == null) return "void";
    return settleDC(r.sh_home, r.sh_away, sel);
  },

  "GG/NG_SH": (r, sel) => {
    if (r.sh_home == null || r.sh_away == null) return "void";
    return settleGGNG(r.sh_home, r.sh_away, sel);
  },

  // ─── Football 2nd Half ───

  "1X2_SH": (r, sel) => {
    if (r.sh_home == null || r.sh_away == null) return "void";
    return settle1X2(r.sh_home, r.sh_away, sel);
  },

  "O/U_SH": (r, sel, line) => {
    if (r.sh_total == null) return "void";
    return settleOU(r.sh_total, sel, line);
  },

  "O/U_HOME_SH": (r, sel, line) => {
    if (r.sh_home == null) return "void";
    return settleOU(r.sh_home, sel, line);
  },

  "O/U_AWAY_SH": (r, sel, line) => {
    if (r.sh_away == null) return "void";
    return settleOU(r.sh_away, sel, line);
  },

  WIN_NIL_SH_HOME: (r, sel) => {
    if (r.sh_home == null || r.sh_away == null) return "void";
    return settleYesNo(r.sh_home > r.sh_away && r.sh_away === 0, sel);
  },

  WIN_NIL_SH_AWAY: (r, sel) => {
    if (r.sh_home == null || r.sh_away == null) return "void";
    return settleYesNo(r.sh_away > r.sh_home && r.sh_home === 0, sel);
  },

  // ─── Football Team-specific ───

  "O/U_HOME": (r, sel, line) => settleOU(r.home, sel, line),

  "O/U_AWAY": (r, sel, line) => settleOU(r.away, sel, line),

  GOALS_BAND_HOME: (r, sel) => settleGoalsBand(r.home, sel),

  GOALS_BAND_AWAY: (r, sel) => settleGoalsBand(r.away, sel),

  CLEAN_SHEET_HOME: (r, sel) => settleYesNo(r.away === 0, sel),

  CLEAN_SHEET_AWAY: (r, sel) => settleYesNo(r.home === 0, sel),

  WIN_NIL_HOME: (r, sel) => settleYesNo(r.home > r.away && r.away === 0, sel),

  WIN_NIL_AWAY: (r, sel) => settleYesNo(r.away > r.home && r.home === 0, sel),

  ODD_EVEN_HOME: (r, sel) => settleOddEven(r.home, sel),

  ODD_EVEN_AWAY: (r, sel) => settleOddEven(r.away, sel),

  // ─── Football Combos ───

  COMBO_1X2_OU: (r, sel, line) => {
    // Outcome: "1 - Over", "X - Under", "1 - Ov", "2 - Un"
    const parts = sel.split(/\s*-\s*/);
    if (parts.length < 2) return "void";
    const ftSel = parts[0].trim();
    const ouSel = parts[parts.length - 1].trim();
    const ftResult = settle1X2(r.home, r.away, ftSel);
    const ouResult = settleOU(r.total, ouSel, line);
    if (ftResult === "void" || ouResult === "void") return "void";
    if (ftResult === "push" || ouResult === "push") return "push";
    return ftResult === "won" && ouResult === "won" ? "won" : "lost";
  },

  COMBO_1X2_GG: (r, sel) => {
    const parts = sel.split(/\s*-\s*/);
    if (parts.length < 2) return "void";
    const ftResult = settle1X2(r.home, r.away, parts[0].trim());
    const ggResult = settleGGNG(r.home, r.away, parts[parts.length - 1].trim());
    return ftResult === "won" && ggResult === "won" ? "won" : "lost";
  },

  COMBO_DC_GG: (r, sel) => {
    const parts = sel.split(/\s*-\s*/);
    if (parts.length < 2) return "void";
    const dcResult = settleDC(r.home, r.away, parts[0].trim());
    const ggResult = settleGGNG(r.home, r.away, parts[parts.length - 1].trim());
    return dcResult === "won" && ggResult === "won" ? "won" : "lost";
  },

  COMBO_DC_OU: (r, sel, line) => {
    const parts = sel.split(/\s*-\s*/);
    if (parts.length < 2) return "void";
    const dcResult = settleDC(r.home, r.away, parts[0].trim());
    const ouResult = settleOU(r.total, parts[parts.length - 1].trim(), line);
    if (dcResult === "void" || ouResult === "void") return "void";
    if (ouResult === "push") return "push";
    return dcResult === "won" && ouResult === "won" ? "won" : "lost";
  },

  COMBO_GG_OU: (r, sel, line) => {
    const parts = sel.split(/\s*-\s*/);
    if (parts.length < 2) return "void";
    const ggResult = settleGGNG(r.home, r.away, parts[0].trim());
    const ouResult = settleOU(r.total, parts[parts.length - 1].trim(), line);
    if (ggResult === "void" || ouResult === "void") return "void";
    if (ouResult === "push") return "push";
    return ggResult === "won" && ouResult === "won" ? "won" : "lost";
  },

  GG_OR_OVER: (r, sel, line) => {
    // "GG o Over X.X" — Si wins if GG OR total > line
    const gg = r.home > 0 && r.away > 0;
    const over = line != null && r.total > line;
    return settleYesNo(gg || over, sel);
  },

  COMBO_1X2_GG_HT: (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    const parts = sel.split(/\s*-\s*/);
    if (parts.length < 2) return "void";
    const ftResult = settle1X2(r.ht_home, r.ht_away, parts[0].trim());
    const ggResult = settleGGNG(r.ht_home, r.ht_away, parts[parts.length - 1].trim());
    return ftResult === "won" && ggResult === "won" ? "won" : "lost";
  },

  COMBO_1X2_OU_HT: (r, sel, line) => {
    if (r.ht_home == null || r.ht_away == null || r.ht_total == null) return "void";
    const parts = sel.split(/\s*-\s*/);
    if (parts.length < 2) return "void";
    const ftResult = settle1X2(r.ht_home, r.ht_away, parts[0].trim());
    const ouResult = settleOU(r.ht_total, parts[parts.length - 1].trim(), line);
    if (ftResult === "void" || ouResult === "void") return "void";
    if (ouResult === "push") return "push";
    return ftResult === "won" && ouResult === "won" ? "won" : "lost";
  },

  // ─── Football HT/FT ───

  HT_FT: (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    const htRes =
      r.ht_home > r.ht_away ? "1" : r.ht_home === r.ht_away ? "X" : "2";
    const ftRes =
      r.home > r.away ? "1" : r.home === r.away ? "X" : "2";
    const expected = `${htRes}/${ftRes}`;
    // Normalize: handle both "1/1" and "1 - 1" separators
    const norm = sel.trim().replace(/\s*-\s*/g, "/").replace(/\s+/g, "");
    if (norm === expected) return "won";
    return "lost";
  },

  HALF_MOST_GOALS: (r, sel) => {
    if (r.ht_total == null || r.sh_total == null) return "void";
    const s = sel.trim();
    if (r.ht_total > r.sh_total && s === "1") return "won";
    if (r.ht_total === r.sh_total && (s === "X" || s === "x")) return "won";
    if (r.ht_total < r.sh_total && s === "2") return "won";
    return "lost";
  },

  // ─── Football Props ───

  NEXT_GOAL: () => "void", // Need live timeline data

  QUALIFY: (r, sel) => {
    // Simple: home wins → Casa, away wins → Ospite
    const s = sel.trim().toLowerCase();
    if ((s === "casa" || s === "1") && r.home > r.away) return "won";
    if ((s === "ospite" || s === "2") && r.away > r.home) return "won";
    // Draw = void (two-leg ties need aggregate data)
    if (r.home === r.away) return "void";
    return "lost";
  },

  OVERTIME_YN: (r, sel) => {
    const hasOT =
      (r.period || "").toUpperCase().includes("OVERTIME") ||
      (r.period || "").toUpperCase().includes("EXTRA");
    return settleYesNo(hasOT, sel);
  },

  GOAL_BOTH_HALVES: (r, sel) => {
    if (r.ht_total == null || r.sh_total == null) return "void";
    const goalsBothHalves = r.ht_total > 0 && r.sh_total > 0;
    return settleYesNo(goalsBothHalves, sel);
  },

  // ─── Tennis / Table Tennis ───

  MATCH_WINNER: (r, sel) => {
    // No draw in tennis/basketball — void if tied
    if (r.home === r.away) return "void";
    const s = sel.trim();
    if ((s === "1" || s.toLowerCase() === "casa") && r.home > r.away) return "won";
    if ((s === "2" || s.toLowerCase() === "ospite") && r.away > r.home) return "won";
    return "lost";
  },

  SET_WINNER: (r, sel, _line, setIdx) => {
    if (!r.halfScores) return "void";
    const idx = (setIdx ?? 1) - 1; // 1-based → 0-based
    if (idx < 0 || idx >= r.halfScores.home.length) return "void";
    const hGames = r.halfScores.home[idx];
    const aGames = r.halfScores.away[idx];
    if (hGames === aGames) return "void";
    const s = sel.trim();
    if (s === "1" && hGames > aGames) return "won";
    if (s === "2" && aGames > hGames) return "won";
    return "lost";
  },

  SET_BETTING: (r, sel) => {
    if (!r.halfScores) return "void";
    const { home, away } = r.halfScores;
    // Count sets won by each player
    let p1Sets = 0;
    let p2Sets = 0;
    for (let i = 0; i < home.length; i++) {
      if (home[i] > away[i]) p1Sets++;
      else if (away[i] > home[i]) p2Sets++;
    }
    // Outcome like "2-0", "2-1", "1-2", "0-2", "3-0", etc.
    const norm = sel.trim().replace(":", "-");
    if (norm === `${p1Sets}-${p2Sets}`) return "won";
    return "lost";
  },

  "O/U_GAMES": (r, sel, line) => {
    if (!r.halfScores) return "void";
    const totalGames =
      r.halfScores.home.reduce((a, b) => a + b, 0) +
      r.halfScores.away.reduce((a, b) => a + b, 0);
    return settleOU(totalGames, sel, line);
  },

  "O/U_GAMES_SET": (r, sel, line, setIdx) => {
    if (!r.halfScores) return "void";
    const idx = (setIdx ?? 1) - 1;
    if (idx < 0 || idx >= r.halfScores.home.length) return "void";
    const gamesInSet = r.halfScores.home[idx] + r.halfScores.away[idx];
    return settleOU(gamesInSet, sel, line);
  },

  EXACT_SETS: (r, sel) => {
    if (!r.halfScores) return "void";
    const totalSets = r.halfScores.home.length;
    const s = sel.trim();
    if (s === String(totalSets)) return "won";
    return "lost";
  },

  SET_PLAYED: (r, sel, _line, setIdx) => {
    if (!r.halfScores) return "void";
    const n = setIdx ?? 1;
    const played = r.halfScores.home.length >= n;
    return settleYesNo(played, sel);
  },

  PLAYER_WINS_SET: (r, sel, _line, setIdx) => {
    if (!r.halfScores) return "void";
    const playerNum = setIdx ?? 1; // 1 = home, 2 = away
    const { home, away } = r.halfScores;
    let winsSet = false;
    for (let i = 0; i < home.length; i++) {
      if (playerNum === 1 && home[i] > away[i]) { winsSet = true; break; }
      if (playerNum === 2 && away[i] > home[i]) { winsSet = true; break; }
    }
    return settleYesNo(winsSet, sel);
  },

  HANDICAP_GAMES: (r, sel, line) => {
    if (!r.halfScores || line == null) return "void";
    const homeGames = r.halfScores.home.reduce((a, b) => a + b, 0);
    const awayGames = r.halfScores.away.reduce((a, b) => a + b, 0);
    const adjHome = homeGames + line;
    if (adjHome === awayGames) return "push";
    const s = sel.trim();
    if (s === "1" && adjHome > awayGames) return "won";
    if (s === "2" && adjHome < awayGames) return "won";
    return "lost";
  },

  HANDICAP_POINTS: (r, sel, line) => {
    if (line == null) return "void";
    const adjHome = r.home + line;
    if (adjHome === r.away) return "push";
    const s = sel.trim();
    if (s === "1" && adjHome > r.away) return "won";
    if (s === "2" && adjHome < r.away) return "won";
    return "lost";
  },

  HANDICAP_SET: (r, sel, line, setIdx) => {
    if (!r.halfScores || line == null) return "void";
    const idx = (setIdx ?? 1) - 1;
    if (idx < 0 || idx >= r.halfScores.home.length) return "void";
    const adjHome = r.halfScores.home[idx] + line;
    const awayGames = r.halfScores.away[idx];
    if (adjHome === awayGames) return "push";
    const s = sel.trim();
    if (s === "1" && adjHome > awayGames) return "won";
    if (s === "2" && adjHome < awayGames) return "won";
    return "lost";
  },

  ODD_EVEN_GAMES: (r, sel) => {
    if (!r.halfScores) return "void";
    const totalGames =
      r.halfScores.home.reduce((a, b) => a + b, 0) +
      r.halfScores.away.reduce((a, b) => a + b, 0);
    return settleOddEven(totalGames, sel);
  },

  ODD_EVEN_GAMES_SET: (r, sel, _line, setIdx) => {
    if (!r.halfScores) return "void";
    const idx = (setIdx ?? 1) - 1;
    if (idx < 0 || idx >= r.halfScores.home.length) return "void";
    const gamesInSet = r.halfScores.home[idx] + r.halfScores.away[idx];
    return settleOddEven(gamesInSet, sel);
  },

  TIEBREAK_YN: (r, sel) => {
    if (!r.halfScores) return "void";
    const { home, away } = r.halfScores;
    let hasTiebreak = false;
    for (let i = 0; i < home.length; i++) {
      // A tiebreak occurs when both players reach 6 games (score 7-6 or higher)
      if (home[i] >= 7 || away[i] >= 7) {
        if (home[i] >= 6 && away[i] >= 6) {
          hasTiebreak = true;
          break;
        }
      }
    }
    return settleYesNo(hasTiebreak, sel);
  },

  COMBO_SET1_MATCH: (r, sel) => {
    if (!r.halfScores || r.halfScores.home.length === 0) return "void";
    // Who won set 1
    const set1Winner = r.halfScores.home[0] > r.halfScores.away[0] ? "1" : "2";
    // Who won match
    if (r.home === r.away) return "void";
    const matchWinner = r.home > r.away ? "1" : "2";
    const expected = `${set1Winner}/${matchWinner}`;
    const norm = sel.trim().replace(/\s*-\s*/g, "/").replace(/\s+/g, "");
    if (norm === expected) return "won";
    return "lost";
  },

  EXACT_SET_SCORE: (r, sel, _line, setIdx) => {
    if (!r.halfScores) return "void";
    const idx = (setIdx ?? 1) - 1;
    if (idx < 0 || idx >= r.halfScores.home.length) return "void";
    const hGames = r.halfScores.home[idx];
    const aGames = r.halfScores.away[idx];
    const norm = sel.trim().replace(":", "-");
    if (norm === `${hGames}-${aGames}`) return "won";
    return "lost";
  },

  // ─── Tennis additional ───

  ODD_EVEN_SETS: (r, sel) => {
    if (!r.halfScores) return "void";
    const totalSets = r.halfScores.home.length;
    return settleOddEven(totalSets, sel);
  },

  BAGEL_SET: (r, sel) => {
    if (!r.halfScores) return "void";
    const { home, away } = r.halfScores;
    let hasBagel = false;
    for (let i = 0; i < home.length; i++) {
      if ((home[i] === 6 && away[i] === 0) || (home[i] === 0 && away[i] === 6)) {
        hasBagel = true;
        break;
      }
    }
    return settleYesNo(hasBagel, sel);
  },

  "O/U_SETS": (r, sel, line) => {
    if (!r.halfScores) return "void";
    const totalSets = r.halfScores.home.length;
    return settleOU(totalSets, sel, line);
  },

  // ─── Hockey / generic ───

  BOTH_SCORE_N: (r, sel, line) => {
    const n = line ?? 1;
    const condition = r.home >= n && r.away >= n;
    return settleYesNo(condition, sel);
  },

  // ─── Basketball Quarters ───

  "1X2_QUARTER": (r, sel, _line, setIdx) => {
    const qi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[qi] == null) return "void";
    return settle1X2(r.halfScores.home[qi], r.halfScores.away[qi], sel);
  },

  "O/U_QUARTER": (r, sel, line, setIdx) => {
    const qi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[qi] == null) return "void";
    const total = r.halfScores.home[qi] + r.halfScores.away[qi];
    return settleOU(total, sel, line);
  },

  ODD_EVEN_QUARTER: (r, sel, _line, setIdx) => {
    const qi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[qi] == null) return "void";
    const total = r.halfScores.home[qi] + r.halfScores.away[qi];
    return settleOddEven(total, sel);
  },

  DNB_QUARTER: (r, sel, _line, setIdx) => {
    const qi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[qi] == null) return "void";
    const h = r.halfScores.home[qi], a = r.halfScores.away[qi];
    if (h === a) return "void";
    if (sel.trim() === "1" && h > a) return "won";
    if (sel.trim() === "2" && h < a) return "won";
    return "lost";
  },

  HANDICAP_QUARTER: (r, sel, line, setIdx) => {
    const qi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[qi] == null || line == null) return "void";
    const adjHome = r.halfScores.home[qi] + line;
    const away = r.halfScores.away[qi];
    if (adjHome === away) return "push";
    const s = sel.trim();
    if (s === "1" && adjHome > away) return "won";
    if (s === "2" && adjHome < away) return "won";
    return "lost";
  },

  // ─── Hockey Periods ───

  "1X2_PERIOD": (r, sel, _line, setIdx) => {
    const pi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[pi] == null) return "void";
    return settle1X2(r.halfScores.home[pi], r.halfScores.away[pi], sel);
  },

  "O/U_PERIOD": (r, sel, line, setIdx) => {
    const pi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[pi] == null) return "void";
    const total = r.halfScores.home[pi] + r.halfScores.away[pi];
    return settleOU(total, sel, line);
  },

  DC_PERIOD: (r, sel, _line, setIdx) => {
    const pi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[pi] == null) return "void";
    return settleDC(r.halfScores.home[pi], r.halfScores.away[pi], sel);
  },

  GG_NG_PERIOD: (r, sel, _line, setIdx) => {
    const pi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[pi] == null) return "void";
    const h = r.halfScores.home[pi], a = r.halfScores.away[pi];
    const bothScore = h > 0 && a > 0;
    const s = sel.trim().toUpperCase();
    if (s === "GG" || s === "GOL" || isYes(sel)) return bothScore ? "won" : "lost";
    if (s === "NG" || s === "NOGOL" || s === "NO GOL" || isNo(sel)) return bothScore ? "lost" : "won";
    return "void";
  },

  DNB_PERIOD: (r, sel, _line, setIdx) => {
    const pi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[pi] == null) return "void";
    const h = r.halfScores.home[pi], a = r.halfScores.away[pi];
    if (h === a) return "void";
    if (sel.trim() === "1" && h > a) return "won";
    if (sel.trim() === "2" && h < a) return "won";
    return "lost";
  },

  HANDICAP_PERIOD: (r, sel, line, setIdx) => {
    const pi = (setIdx ?? 1) - 1;
    if (!r.halfScores || r.halfScores.home[pi] == null || line == null) return "void";
    const adjHome = r.halfScores.home[pi] + line;
    const away = r.halfScores.away[pi];
    if (adjHome === away) return "push";
    const s = sel.trim();
    if (s === "1" && adjHome > away) return "won";
    if (s === "2" && adjHome < away) return "won";
    return "lost";
  },

  // ─── Corner markets (null = stats not yet available) ───

  "O/U_CORNERS": (r, sel, line) => {
    if (r.corners_total == null) return null;
    return settleOU(r.corners_total, sel, line);
  },

  "1X2_CORNERS": (r, sel) => {
    if (r.corners_home == null || r.corners_away == null) return null;
    return settle1X2(r.corners_home, r.corners_away, sel);
  },

  DC_CORNERS: (r, sel) => {
    if (r.corners_home == null || r.corners_away == null) return null;
    return settleDC(r.corners_home, r.corners_away, sel);
  },

  HANDICAP_CORNERS: (r, sel, line) => {
    if (r.corners_home == null || r.corners_away == null || line == null) return null;
    const adjHome = r.corners_home + line;
    if (adjHome === r.corners_away) return "push";
    const s = sel.trim();
    if (s === "1" && adjHome > r.corners_away) return "won";
    if (s === "2" && adjHome < r.corners_away) return "won";
    return "lost";
  },

  // Family B: handicap corners HT/SH
  HANDICAP_CORNERS_HT: makeHandicap((sr) => sr.ht_corners_home, (sr) => sr.ht_corners_away),
  HANDICAP_CORNERS_SH: makeHandicap((sr) => sr.sh_corners_home, (sr) => sr.sh_corners_away),

  // Family B: DC corners HT/SH
  DC_CORNERS_HT: makeDC((sr) => sr.ht_corners_home, (sr) => sr.ht_corners_away),
  DC_CORNERS_SH: makeDC((sr) => sr.sh_corners_home, (sr) => sr.sh_corners_away),

  // Family B: HT cards (yellow + red total, per team handicap)
  "O/U_CARDS_HT": makeTotalOU((sr) => sr.ht_cards_total),
  HANDICAP_CARDS_HT: makeHandicap((sr) => sr.ht_cards_home, (sr) => sr.ht_cards_away),

  // Family A: O/U corners per team (home or away individually)
  "O/U_CORNER_HOME": makeTeamOU((sr) => sr.corners_home),
  "O/U_CORNER_AWAY": makeTeamOU((sr) => sr.corners_away),

  // Family A: O/U shots per team (total shots + on-target, home or away individually)
  // "Tiri" = shots (total), "Tiri in porta" = shots on target
  "O/U_SHOTS_HOME": makeTeamOU((sr) => sr.shots_total_home),
  "O/U_SHOTS_AWAY": makeTeamOU((sr) => sr.shots_total_away),
  "O/U_SHOTS_ON_TARGET_HOME": makeTeamOU((sr) => sr.shots_on_target_home),
  "O/U_SHOTS_ON_TARGET_AWAY": makeTeamOU((sr) => sr.shots_on_target_away),

  // Family A: team-split goals (sr.home/sr.away are FT scores — always populated when buildResult returns non-null)
  "O/U_GOALS_HOME": makeTeamOU((sr) => sr.home),
  "O/U_GOALS_AWAY": makeTeamOU((sr) => sr.away),

  CORNERS_BAND: (r, sel) => {
    if (r.corners_total == null) return null;
    return settleGoalsBand(r.corners_total, sel);
  },

  // ─── Corner HT/SH markets (null = stats not yet available) ───

  // GAP 2: HT corners
  "O/U_CORNERS_HT": (r, sel, line) => {
    if (r.ht_corners_total == null) return null;
    return settleOU(r.ht_corners_total, sel, line);
  },

  "1X2_CORNERS_HT": (r, sel) => {
    if (r.ht_corners_home == null || r.ht_corners_away == null) return null;
    return settle1X2(r.ht_corners_home, r.ht_corners_away, sel);
  },

  // GAP 2: SH corners — sh_corners = corners_total - ht_corners_total
  "O/U_CORNERS_SH": (r, sel, line) => {
    if (r.corners_total == null || r.ht_corners_total == null) return null;
    const shCornersTotal = r.corners_total - r.ht_corners_total;
    return settleOU(shCornersTotal, sel, line);
  },

  "1X2_CORNERS_SH": (r, sel) => {
    if (r.corners_home == null || r.corners_away == null || r.ht_corners_home == null || r.ht_corners_away == null) return null;
    const shHome = r.corners_home - r.ht_corners_home;
    const shAway = r.corners_away - r.ht_corners_away;
    return settle1X2(shHome, shAway, sel);
  },

  // ─── Card markets (null = stats not yet available) ───

  "1X2_CARDS": (r, sel) => {
    if (r.cards_home == null || r.cards_away == null) return null;
    return settle1X2(r.cards_home, r.cards_away, sel);
  },

  "O/U_CARDS": (r, sel, line) => {
    if (r.cards_total == null) return null;
    return settleOU(r.cards_total, sel, line);
  },

  HANDICAP_CARDS: (r, sel, line) => {
    if (r.cards_home == null || r.cards_away == null || line == null) return null;
    const adjHome = r.cards_home + line;
    if (adjHome === r.cards_away) return "push";
    const s = sel.trim();
    if (s === "1" && adjHome > r.cards_away) return "won";
    if (s === "2" && adjHome < r.cards_away) return "won";
    return "lost";
  },

  // ─── Shot markets (null = stats not yet available) ───

  "O/U_SHOTS": (r, sel, line) => {
    if (r.shots_on_target_home == null || r.shots_on_target_away == null) return null;
    const total = r.shots_on_target_home + r.shots_on_target_away;
    return settleOU(total, sel, line);
  },

  "1X2_SHOTS": (r, sel) => {
    if (r.shots_on_target_home == null || r.shots_on_target_away == null) return null;
    return settle1X2(r.shots_on_target_home, r.shots_on_target_away, sel);
  },
};

// ═══ settleEvent — main orchestrator ═══

/**
 * Convert legacy SettlementResult to Plan D ScoreResult shape.
 * Plan D engine expects a flatter structure with optional stats fields.
 * Note: legacy uses shots_total_home/away and shots_on_target_home/away;
 * Plan D names them shots_home/away. We map shots_total_* -> shots_*.
 * Fields not on legacy (gk_saves, scorers, assists, player_shots) are
 * omitted - Plan D classifiers return null verdict (stats_missing)
 * and the existing legsSkipped logic handles those legs correctly.
 */
function toPlanDScoreResult(r: SettlementResult): PlanDScoreResult {
  return {
    home: r.home,
    away: r.away,
    ht_home: r.ht_home ?? null,
    ht_away: r.ht_away ?? null,
    corners_home: r.corners_home ?? null,
    corners_away: r.corners_away ?? null,
    ht_corners_home: r.ht_corners_home ?? null,
    ht_corners_away: r.ht_corners_away ?? null,
    cards_home: r.cards_home ?? null,
    cards_away: r.cards_away ?? null,
    shots_home: r.shots_total_home ?? null,
    shots_away: r.shots_total_away ?? null,
    shots_on_target_home: r.shots_on_target_home ?? null,
    shots_on_target_away: r.shots_on_target_away ?? null,
  };
}

/**
 * Map Plan D verdict to legacy Verdict.
 * Plan D Verdict (5 values) is now a subset of legacy Verdict (6 values incl. push).
 * Pass through unchanged — bet_selections.result column TEXT accepts all variants
 * (see migration 001_initial_schema.sql:290,329 comment).
 */
function planDVerdictToLegacy(v: PlanDVerdict | null): Verdict | null {
  return v;
}

export async function settleEvent(
  supabase: SupabaseClient,
  eventId: string,
  manualResult?: { home: number; away: number }
): Promise<SettleOutcome> {
  // 1. Fetch event with sport name
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, source, score_home, score_away, status, live_data, settled_at, period, sport_id, sports!inner(name)")
    .eq("id", eventId)
    .single();

  if (evErr || !event) {
    return { error: evErr?.message || "Event not found" };
  }

  // 2. Already settled?
  if (event.settled_at) {
    return { already_settled: true };
  }

  // 3. Cancelled/postponed → void all legs, refund
  if (event.status === "cancelled" || event.status === "postponed") {
    return voidAllLegs(supabase, eventId, event.status);
  }

  // 4. Build result from DB data (or manual override)
  const sport = (event.sports as any)?.name?.toLowerCase() || "";
  const result = buildResult(event, manualResult, sport);
  if (!result) {
    return { skipped_no_scores: true, error: "No scores available" };
  }

  // 5. Optimistic lock — claim this event for settlement
  const { data: locked, error: lockErr } = await supabase
    .from("events")
    .update({ settled_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("settled_at", null)
    .select("id");

  if (lockErr || !locked?.length) {
    return { already_settled: true };
  }

  // 6. Fetch unsettled legs with JOINs
  const { data: legs, error: legsErr } = await supabase
    .from("bet_selections")
    .select(
      `id, bet_id, event_id, market_id, outcome_id, odds_at_placement,
       markets!inner(market_type, line),
       outcomes!inner(name),
       bets!inner(id, user_id, stake, potential_win, total_odds, status)`
    )
    .eq("event_id", eventId)
    .is("result", null);

  if (legsErr) {
    return { error: `Failed to fetch legs: ${legsErr.message}` };
  }

  if (!legs || legs.length === 0) {
    return { success: true, legs_processed: 0, bets_settled: 0, total_payout: 0 };
  }

  // 6b. Pre-load canonical lookup maps for this event (Phase B).
  // Used only when the regex fast-path in resolveSettlerKey misses,
  // which is the common case for non-Kambi-Italian market naming.
  const eventSource = (event as { source?: string | null }).source ?? null;
  const legMarketTypes = legs.map(
    (l) => (l.markets as unknown as { market_type: string }).market_type,
  );
  const legOutcomeNames = legs.map(
    (l) => (l.outcomes as unknown as { name: string }).name,
  );
  let canonicalLookups: CanonicalLookups;
  try {
    canonicalLookups = await loadCanonicalLookups(
      supabase,
      eventSource,
      legMarketTypes,
      legOutcomeNames,
    );
  } catch {
    // Fail-open: settlement still works via regex fast-path only.
    canonicalLookups = makeEmptyLookups();
  }

  // 7. Settle each leg
  let legsProcessed = 0;
  let legsSkipped = 0;
  const affectedBetIds = new Set<string>();
  const useOddsApiEngine = process.env.SETTLE_VIA_ODDS_API === "true";

  for (const leg of legs) {
    const market = leg.markets as unknown as {
      market_type: string;
      line: number | null;
    };
    const outcome = leg.outcomes as unknown as { name: string };

    let verdict: Verdict | null;

    if (useOddsApiEngine) {
      // Plan D path — classifier-based verdict (S6 cutover).
      // Side effects (wallet credits, agent commissions, Telegram alerts,
      // settlement_log writes, event deactivation) remain untouched below.
      const planDResult = toPlanDScoreResult(result);
      const planDLeg = {
        market_type: market.market_type,
        outcome_name: outcome.name,
        line: market.line,
      };
      const { verdict: planDVerdict } = planDClassifyLeg(planDLeg, planDResult);
      verdict = planDVerdictToLegacy(planDVerdict);
    } else {
      // Legacy path — canonical-dispatcher SETTLERS table
      const resolved = resolveSettlerKey(
        market.market_type,
        market.line,
        eventSource,
        canonicalLookups,
      );

      if (!resolved) {
        // Unknown or auto-void market
        verdict = "void";
      } else {
        const settler = SETTLERS[resolved.key];
        if (!settler) {
          verdict = "void";
        } else {
          const line = resolved.line ?? market.line ?? undefined;
          // If dispatch came through canonical fallback, translate the outcome
          // name into a form the settler recognises (e.g. legacy "Si" → "Sì").
          // For regex-resolved markets (Kambi Italian) we pass the raw name —
          // those settlers already understand the native verbose strings.
          const outcomeInput = resolved.canonicalKey
            ? canonicalizeOutcome(
                eventSource ?? "",
                market.market_type,
                outcome.name,
                resolved.canonicalKey,
                canonicalLookups,
              )
            : outcome.name;
          verdict = settler(result, outcomeInput, line, resolved.setIdx);
        }
      }
    }

    // null = stats not available yet — skip this leg for later settlement
    if (verdict === null) {
      legsSkipped++;
      continue;
    }

    // push = void for settlement purposes
    if (verdict === "push") verdict = "void";

    await supabase
      .from("bet_selections")
      .update({ result: verdict, settled_at: new Date().toISOString() })
      .eq("id", leg.id);

    affectedBetIds.add(leg.bet_id);
    legsProcessed++;
  }

  // 8. If legs were skipped (stats not yet available), release the lock
  // so a future settlement attempt (after stats arrive) can process them
  if (legsSkipped > 0) {
    await supabase
      .from("events")
      .update({ settled_at: null })
      .eq("id", eventId);
  }

  // 9. Resolve affected bets
  let betsSettled = 0;
  let totalPayout = 0;

  for (const betId of Array.from(affectedBetIds)) {
    const payout = await resolveBet(supabase, betId);
    if (payout !== null) {
      betsSettled++;
      totalPayout += payout;
    }
  }

  // 10. Settlement log + deactivate only when ALL legs are done
  if (legsSkipped === 0) {
    await supabase.from("settlement_log").insert({
      event_id: eventId,
      action: "auto_settle",
      result: { ...result },
      bets_affected: betsSettled,
      total_payout: totalPayout,
      settled_by: "auto",
    });

    await deactivateEvent(supabase, eventId);
  }

  return {
    success: true,
    legs_processed: legsProcessed,
    bets_settled: betsSettled,
    total_payout: totalPayout,
  };
}

// ═══ resolveBet — check if all legs settled, determine bet outcome ═══

export async function resolveBet(
  supabase: SupabaseClient,
  betId: string
): Promise<number | null> {
  // Fetch all legs for this bet
  const { data: allLegs } = await supabase
    .from("bet_selections")
    .select("result, odds_at_placement")
    .eq("bet_id", betId);

  if (!allLegs) return null;

  // Fetch the bet itself (need stake/user before we can aggregate)
  const { data: bet } = await supabase
    .from("bets")
    .select("id, user_id, stake, potential_win, status, parent_bet_id")
    .eq("id", betId)
    .single();

  if (!bet || bet.status !== "open") return null;

  // Pure aggregation: returns null if waiting on more legs.
  const aggregated = aggregatePayout(
    allLegs.map((l) => ({ result: l.result as any, odds_at_placement: l.odds_at_placement })),
    Number(bet.stake)
  );
  if (aggregated === null) return null;

  const { status: betStatus, payout } = aggregated;

  // Persist bet outcome
  await supabase
    .from("bets")
    .update({
      status: betStatus,
      actual_win: payout,
      settled_at: new Date().toISOString(),
    })
    .eq("id", betId);

  // Wallet credit: always credit the numeric payout (zero is a no-op).
  // The bet status enum just labels the net outcome — the wallet sees money.
  if (payout > 0) {
    const ledgerType = betStatus === "won" ? "win" : "refund";
    await creditWallet(supabase, bet.user_id, betId, payout, ledgerType);
  }

  // Telegram alert only for net wins (status === "won")
  if (betStatus === "won") {
    const { data: winner } = await supabase.from("users").select("username").eq("id", bet.user_id).single();
    sendTelegramMessage(
      `🏆 <b>SCOMMESSA VINTA</b>\n👤 @${winner?.username || bet.user_id}\n💰 +€${payout.toFixed(2)} (stake: €${bet.stake})`
    ).catch(() => {});
  }

  // If this is a child of a sistema bet, check if parent can be resolved
  if (bet.parent_bet_id) {
    await resolveParentBet(supabase, bet.parent_bet_id);
  }

  return payout;
}

// ═══ resolveParentBet — aggregate child combo results into parent ═══

async function resolveParentBet(
  supabase: SupabaseClient,
  parentBetId: string
): Promise<void> {
  // Fetch all child bets
  const { data: children } = await supabase
    .from("bets")
    .select("id, status, actual_win, stake")
    .eq("parent_bet_id", parentBetId);

  if (!children || children.length === 0) return;

  // If any child still open/unsettled → skip
  if (children.some((c) => !c.status || c.status === "open" || c.status === "pending_acceptance")) return;

  // Fetch parent
  const { data: parent } = await supabase
    .from("bets")
    .select("id, status, user_id")
    .eq("id", parentBetId)
    .single();

  if (!parent || (parent.status !== "open" && parent.status !== "pending_acceptance")) return;

  // Calculate aggregates
  const combosWon = children.filter((c) => c.status === "won").length;
  const combosVoid = children.filter((c) => c.status === "void").length;
  const totalPayout = children.reduce((sum, c) => sum + (c.actual_win || 0), 0);
  const allVoid = combosVoid === children.length;

  let parentStatus: string;
  if (allVoid) {
    parentStatus = "void";
  } else if (combosWon > 0) {
    parentStatus = "won";
  } else {
    parentStatus = "lost";
  }

  // Update parent — wallet already credited by each child individually
  await supabase
    .from("bets")
    .update({
      status: parentStatus,
      actual_win: parseFloat(totalPayout.toFixed(2)),
      combos_won: combosWon,
      settled_at: new Date().toISOString(),
    })
    .eq("id", parentBetId);
}

// ═══ creditWallet ═══

async function creditWallet(
  supabase: SupabaseClient,
  userId: string,
  betId: string,
  amount: number,
  type: "win" | "refund"
) {
  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, balance")
    .eq("user_id", userId)
    .single();

  if (!wallet) return;

  const balanceBefore = parseFloat(String(wallet.balance));
  const balanceAfter = parseFloat((balanceBefore + amount).toFixed(2));

  await supabase
    .from("wallets")
    .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
    .eq("id", wallet.id);

  await supabase.from("transactions").insert({
    user_id: userId,
    wallet_id: wallet.id,
    type,
    amount,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    reference_type: "bet",
    reference_id: betId,
    description:
      type === "win"
        ? `Vincita scommessa #${betId.slice(0, 8)}`
        : `Rimborso scommessa annullata #${betId.slice(0, 8)}`,
    status: "completed",
  });
}

// ═══ voidAllLegs — for cancelled/postponed events ═══

async function voidAllLegs(
  supabase: SupabaseClient,
  eventId: string,
  reason: string
): Promise<SettleOutcome> {
  // Lock event
  const { data: locked } = await supabase
    .from("events")
    .update({ settled_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("settled_at", null)
    .select("id");

  if (!locked?.length) return { already_settled: true };

  // Fetch unsettled legs
  const { data: legs } = await supabase
    .from("bet_selections")
    .select("id, bet_id")
    .eq("event_id", eventId)
    .is("result", null);

  if (!legs || legs.length === 0) {
    return { success: true, legs_processed: 0, bets_settled: 0, total_payout: 0 };
  }

  // Void all legs
  const betIds = new Set<string>();
  for (const leg of legs) {
    await supabase
      .from("bet_selections")
      .update({ result: "void", settled_at: new Date().toISOString() })
      .eq("id", leg.id);
    betIds.add(leg.bet_id);
  }

  // Resolve bets
  let betsSettled = 0;
  for (const betId of Array.from(betIds)) {
    const payout = await resolveBet(supabase, betId);
    if (payout !== null) betsSettled++;
  }

  // Log
  await supabase.from("settlement_log").insert({
    event_id: eventId,
    action: `void_${reason}`,
    result: { reason },
    bets_affected: betsSettled,
    total_payout: 0,
    settled_by: "auto",
  });

  // Deactivate markets/outcomes
  await deactivateEvent(supabase, eventId);

  return {
    success: true,
    legs_processed: legs.length,
    bets_settled: betsSettled,
    total_payout: 0,
  };
}

// ═══ deactivateEvent — set ended + deactivate markets/outcomes ═══

export async function deactivateEvent(
  supabase: SupabaseClient,
  eventId: string
) {
  const now = new Date().toISOString();

  // Set event to ended
  await supabase
    .from("events")
    .update({ status: "ended", updated_at: now })
    .eq("id", eventId);

  // Get market IDs for this event
  const { data: markets } = await supabase
    .from("markets")
    .select("id")
    .eq("event_id", eventId)
    .eq("is_active", true);

  if (markets && markets.length > 0) {
    const marketIds = markets.map((m) => m.id);

    // Deactivate markets
    await supabase
      .from("markets")
      .update({ is_active: false, updated_at: now })
      .in("id", marketIds);

    // Deactivate outcomes (batch in chunks of 200 to avoid query limits)
    for (let i = 0; i < marketIds.length; i += 200) {
      const chunk = marketIds.slice(i, i + 200);
      await supabase
        .from("outcomes")
        .update({ is_active: false, updated_at: now })
        .in("market_id", chunk);
    }
  }
}

// Test-only exports — do not use in production code paths
export const __test__buildResult = buildResult;
export const __test__settle = (
  event: Record<string, unknown>,
  marketType: string,
  outcomeName: string,
  line: number | undefined,
  sport: string,
  opts?: { source?: string; lookups?: CanonicalLookups }
): Verdict | null => {
  const sr = buildResult(event, undefined, sport);
  if (!sr) return null;
  const mt = marketType.trim();
  // Mirror production resolveSettlerKey: VOID patterns checked first
  for (const vp of VOID_PATTERNS) {
    if (vp.test(mt)) return "void";
  }
  for (const mp of MARKET_PATTERNS) {
    const m = mt.match(mp.pattern);
    if (!m) continue;
    const settler = SETTLERS[mp.key];
    if (!settler) {
      throw new Error(
        `__test__settle: pattern ${mp.pattern} matched but no settler registered for key "${mp.key}"`
      );
    }
    const resolvedLine =
      mp.lineGroup && m[mp.lineGroup] != null ? parseFloat(m[mp.lineGroup]) : line;
    const resolvedSet =
      mp.setGroup && m[mp.setGroup] != null ? parseInt(m[mp.setGroup], 10) : undefined;
    return settler(sr, outcomeName, resolvedLine, resolvedSet);
  }
  // Canonical fallback — only when explicitly provided by the test harness.
  if (opts?.source && opts.lookups) {
    const canonical = resolveCanonicalSettler(opts.source, mt, line ?? null, opts.lookups);
    if (canonical) {
      const settler = SETTLERS[canonical.key];
      if (!settler) return null;
      const outcomeInput = canonicalizeOutcome(
        opts.source,
        mt,
        outcomeName,
        canonical.canonicalKey,
        opts.lookups,
      );
      return settler(sr, outcomeInput, canonical.line, canonical.setIdx);
    }
  }
  return null;
};
