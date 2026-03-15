#!/usr/bin/env tsx
/**
 * Settlement Engine — Full E2E Test Suite
 *
 * Creates synthetic events with known scores, places bets (singola/multi/sistema),
 * triggers settlement via HTTP POST /api/settlement, verifies outcomes, cleans up.
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/test-settlement.ts
 * Requires: Vincitu server running on BASE_URL (default http://localhost:3000)
 */

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.VINCITU_URL || "http://localhost:3000";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

type ExpectedVerdict = "won" | "lost" | "void";

interface TestCase {
  sport: string;
  marketType: string;       // DB market_type string (matches MARKET_PATTERNS)
  line?: number;            // market.line
  outcomeName: string;      // outcome.name — what the bettor picked
  expected: ExpectedVerdict; // expected bet_selections.result
  label?: string;           // human-readable description
}

interface TestResult {
  sport: string;
  marketType: string;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

// Track all created IDs for cleanup
const createdIds = {
  events: [] as string[],
  markets: [] as string[],
  outcomes: [] as string[],
  bets: [] as string[],
  betSelections: [] as string[],
  transactions: [] as string[],
  settlementLogs: [] as string[],
  leagues: [] as string[],
};

let testUserId = "";
let testWalletId = "";
let originalBalance = 0;

// ═══════════════════════════════════════════════════════════
// SPORT FIXTURES — Known scores for deterministic settlement
// ═══════════════════════════════════════════════════════════

interface SportFixture {
  sport: string;         // Sport name in DB
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  halfScoreHome?: number[];  // live_data.halfScoreHome
  halfScoreAway?: number[];  // live_data.halfScoreAway
  period?: string;
  stats?: Array<{ name: string; home: string | number; away: string | number }>;
}

const FIXTURES: Record<string, SportFixture> = {
  calcioA: {
    sport: "Calcio",
    homeTeam: "TEST FC Alpha",
    awayTeam: "TEST FC Beta",
    scoreHome: 3,
    scoreAway: 1,
    halfScoreHome: [1],   // HT 1-0, SH 2-1
    halfScoreAway: [0],
  },
  calcioB: {
    sport: "Calcio",
    homeTeam: "TEST FC Gamma",
    awayTeam: "TEST FC Delta",
    scoreHome: 0,
    scoreAway: 0,
    halfScoreHome: [0],
    halfScoreAway: [0],
  },
  tennis: {
    sport: "Tennis",
    homeTeam: "TEST Player One",
    awayTeam: "TEST Player Two",
    scoreHome: 2,           // sets won
    scoreAway: 1,
    halfScoreHome: [6, 3, 7],  // per-set games
    halfScoreAway: [4, 6, 6],  // set 3 = tiebreak 7-6
  },
  tennisTavolo: {
    sport: "Tennis Tavolo",
    homeTeam: "TEST TT Alpha",
    awayTeam: "TEST TT Beta",
    scoreHome: 3,
    scoreAway: 1,
    halfScoreHome: [11, 8, 11, 11],
    halfScoreAway: [9, 11, 5, 7],
  },
  basket: {
    sport: "Basket",
    homeTeam: "TEST Basket Home",
    awayTeam: "TEST Basket Away",
    scoreHome: 105,
    scoreAway: 98,
    halfScoreHome: [28, 25, 26, 26],  // per-quarter
    halfScoreAway: [24, 28, 22, 24],
  },
  hockey: {
    sport: "Hockey Ghiaccio",
    homeTeam: "TEST Hockey Home",
    awayTeam: "TEST Hockey Away",
    scoreHome: 4,
    scoreAway: 2,
    halfScoreHome: [2, 1, 1],  // per-period scores
    halfScoreAway: [0, 1, 1],
  },
  pallamano: {
    sport: "Pallamano",
    homeTeam: "TEST Handball Home",
    awayTeam: "TEST Handball Away",
    scoreHome: 32,
    scoreAway: 28,
  },
  volley: {
    sport: "Volley",
    homeTeam: "TEST Volley Home",
    awayTeam: "TEST Volley Away",
    scoreHome: 3,
    scoreAway: 2,
    halfScoreHome: [25, 20, 25, 22, 15],
    halfScoreAway: [23, 25, 18, 25, 12],
  },
  baseball: {
    sport: "Baseball",
    homeTeam: "TEST Baseball Home",
    awayTeam: "TEST Baseball Away",
    scoreHome: 5,
    scoreAway: 3,
  },
  esports: {
    sport: "Esports",
    homeTeam: "TEST Esports Home",
    awayTeam: "TEST Esports Away",
    scoreHome: 2,
    scoreAway: 1,
  },
  // Calcio with match stats (corners, cards, shots)
  // Corners: 7-5 (total 12), Cards: 3-2 (total 5), Shots OT: 6-4 (total 10)
  calcioStats: {
    sport: "Calcio",
    homeTeam: "TEST Stats Home",
    awayTeam: "TEST Stats Away",
    scoreHome: 2,
    scoreAway: 1,
    halfScoreHome: [1],
    halfScoreAway: [0],
    stats: [
      { name: "Match: Corner Kicks", home: "7", away: "5" },
      { name: "1st Half: Corner Kicks", home: "4", away: "2" },
      { name: "Match: Yellow Cards", home: "2", away: "1" },
      { name: "Match: Red Cards", home: "1", away: "1" },
      { name: "Match: Shots on Target", home: "6", away: "4" },
    ],
  },
  // Edge case events
  cancelled: {
    sport: "Calcio",
    homeTeam: "TEST Cancelled Home",
    awayTeam: "TEST Cancelled Away",
    scoreHome: 0,
    scoreAway: 0,
  },
  postponed: {
    sport: "Calcio",
    homeTeam: "TEST Postponed Home",
    awayTeam: "TEST Postponed Away",
    scoreHome: 0,
    scoreAway: 0,
  },
};

// ═══════════════════════════════════════════════════════════
// TEST CASE DEFINITIONS
// ═══════════════════════════════════════════════════════════

function buildSingolaTests(): { fixtureKey: string; tests: TestCase[] }[] {
  return [
    // ─── CALCIO A (3-1, HT 1-0, SH 2-1, total 4) ───
    {
      fixtureKey: "calcioA",
      tests: [
        // FT Core
        { sport: "Calcio", marketType: "1X2", outcomeName: "1", expected: "won", label: "1X2 home win" },
        { sport: "Calcio", marketType: "1X2", outcomeName: "X", expected: "lost", label: "1X2 draw" },
        { sport: "Calcio", marketType: "1X2", outcomeName: "2", expected: "lost", label: "1X2 away" },
        { sport: "Calcio", marketType: "U/O 2.5", outcomeName: "Over", expected: "won", label: "O/U 2.5 over" },
        { sport: "Calcio", marketType: "U/O 2.5", outcomeName: "Under", expected: "lost", label: "O/U 2.5 under", line: 2.5 },
        { sport: "Calcio", marketType: "GG/NG", outcomeName: "GG", expected: "won", label: "GG/NG both score" },
        { sport: "Calcio", marketType: "GG/NG", outcomeName: "NG", expected: "lost", label: "GG/NG no goal" },
        { sport: "Calcio", marketType: "DC", outcomeName: "1X", expected: "won", label: "DC 1X" },
        { sport: "Calcio", marketType: "DC", outcomeName: "X2", expected: "lost", label: "DC X2" },
        { sport: "Calcio", marketType: "DC", outcomeName: "12", expected: "won", label: "DC 12" },
        { sport: "Calcio", marketType: "Draw No Bet", outcomeName: "1", expected: "won", label: "DNB home" },
        { sport: "Calcio", marketType: "Draw No Bet", outcomeName: "2", expected: "lost", label: "DNB away" },
        { sport: "Calcio", marketType: "Ris.Esatto", outcomeName: "3-1", expected: "won", label: "Exact 3-1" },
        { sport: "Calcio", marketType: "Ris.Esatto", outcomeName: "2-1", expected: "lost", label: "Exact 2-1 wrong" },
        { sport: "Calcio", marketType: "1X2 H (-1)", outcomeName: "1", expected: "won", label: "Handicap -1 home (3+(-1)=2 vs 1)" },
        { sport: "Calcio", marketType: "1X2 H (-1)", outcomeName: "2", expected: "lost", label: "Handicap -1 away", line: -1 },
        { sport: "Calcio", marketType: "Somma Gol", outcomeName: "4", expected: "won", label: "Goals band 4" },
        { sport: "Calcio", marketType: "Somma Gol", outcomeName: "2-3", expected: "lost", label: "Goals band 2-3" },
        { sport: "Calcio", marketType: "P/D", outcomeName: "Pari", expected: "won", label: "P/D even (4 goals)" },
        { sport: "Calcio", marketType: "P/D", outcomeName: "Dispari", expected: "lost", label: "P/D odd" },
        // HT markets (HT = 1-0)
        { sport: "Calcio", marketType: "1X2 1T", outcomeName: "1", expected: "won", label: "1X2 HT home" },
        { sport: "Calcio", marketType: "1X2 1T", outcomeName: "X", expected: "lost", label: "1X2 HT draw" },
        { sport: "Calcio", marketType: "U/O 1T 0.5", outcomeName: "Over", expected: "won", label: "O/U HT 0.5 over", line: 0.5 },
        { sport: "Calcio", marketType: "DC 1° Tempo", outcomeName: "1X", expected: "won", label: "DC HT 1X" },
        { sport: "Calcio", marketType: "GG/NG 1° Tempo", outcomeName: "NG", expected: "won", label: "GG/NG HT no goal (1-0)" },
        { sport: "Calcio", marketType: "Risultato Esatto 1° Tempo", outcomeName: "1-0", expected: "won", label: "Exact HT 1-0" },
        { sport: "Calcio", marketType: "Somma Gol 1° Tempo", outcomeName: "1", expected: "won", label: "Goals HT 1" },
        { sport: "Calcio", marketType: "Draw No Bet 1T", outcomeName: "1", expected: "won", label: "DNB HT home" },
        { sport: "Calcio", marketType: "Pari/Dispari 1° Tempo", outcomeName: "Dispari", expected: "void", label: "P/D HT void (matches void pattern)" },
        // SH markets (SH = 2-1, total SH = 3)
        { sport: "Calcio", marketType: "1X2 2T", outcomeName: "1", expected: "won", label: "1X2 SH home" },
        { sport: "Calcio", marketType: "U/O 2T 1.5", outcomeName: "Over", expected: "won", label: "O/U SH 1.5 over", line: 1.5 },
        { sport: "Calcio", marketType: "Draw No Bet - 2° tempo", outcomeName: "1", expected: "won", label: "DNB SH home" },
        { sport: "Calcio", marketType: "DC 2° Tempo", outcomeName: "1X", expected: "won", label: "DC SH 1X" },
        { sport: "Calcio", marketType: "Entrambe le squadre segnano - 2° tempo (Gol/No Gol)", outcomeName: "GG", expected: "won", label: "GG/NG SH both (2-1)" },
        { sport: "Calcio", marketType: "Vincente a 0 2T Casa", outcomeName: "No", expected: "won", label: "Win nil SH home No (away scored)" },
        // Team-specific
        { sport: "Calcio", marketType: "U/O Casa 1.5", outcomeName: "Over", expected: "won", label: "O/U home 1.5 over (3)", line: 1.5 },
        { sport: "Calcio", marketType: "U/O Ospite 1.5", outcomeName: "Under", expected: "won", label: "O/U away 1.5 under (1)", line: 1.5 },
        { sport: "Calcio", marketType: "Somma Gol Casa", outcomeName: "3", expected: "won", label: "Goals band home 3" },
        { sport: "Calcio", marketType: "Somma Gol Ospite", outcomeName: "0-1", expected: "won", label: "Goals band away 0-1" },
        { sport: "Calcio", marketType: "Rete Inviolata Casa", outcomeName: "No", expected: "won", label: "Clean sheet home No (away scored 1)" },
        { sport: "Calcio", marketType: "Rete Inviolata Ospite", outcomeName: "No", expected: "won", label: "Clean sheet away No (home scored 3)" },
        { sport: "Calcio", marketType: "Vincente A 0 Squadra Casa", outcomeName: "No", expected: "won", label: "Win nil home No (away scored)" },
        { sport: "Calcio", marketType: "Pari/Dispari Casa", outcomeName: "Dispari", expected: "won", label: "P/D home odd (3)" },
        { sport: "Calcio", marketType: "Pari/Dispari Ospite", outcomeName: "Dispari", expected: "won", label: "P/D away odd (1)" },
        // Combos
        { sport: "Calcio", marketType: "1X2 + U/O 2.5", outcomeName: "1 - Over", expected: "won", label: "Combo 1X2+OU won", line: 2.5 },
        { sport: "Calcio", marketType: "1X2 + U/O 2.5", outcomeName: "X - Over", expected: "lost", label: "Combo 1X2+OU lost (X wrong)", line: 2.5 },
        { sport: "Calcio", marketType: "1X2 + GG/NG", outcomeName: "1 - GG", expected: "won", label: "Combo 1X2+GG won" },
        { sport: "Calcio", marketType: "DC + GG/NG", outcomeName: "1X - GG", expected: "won", label: "Combo DC+GG won" },
        { sport: "Calcio", marketType: "DC + U/O 2.5", outcomeName: "1X - Over", expected: "won", label: "Combo DC+OU won", line: 2.5 },
        { sport: "Calcio", marketType: "GG/NG + U/O 2.5", outcomeName: "GG - Over", expected: "won", label: "Combo GG+OU won", line: 2.5 },
        { sport: "Calcio", marketType: "GG o Over 1.5", outcomeName: "Si", expected: "won", label: "GG or Over 1.5 Si", line: 1.5 },
        { sport: "Calcio", marketType: "1X2 + GG/NG 1° Tempo", outcomeName: "1 - NG", expected: "won", label: "Combo 1X2+GG HT (1-0, NG)" },
        { sport: "Calcio", marketType: "1X2 + U/O 1° Tempo 0.5", outcomeName: "1 - Over", expected: "won", label: "Combo 1X2+OU HT (1-0, Over 0.5)", line: 0.5 },
        // HT/FT
        { sport: "Calcio", marketType: "Parziale/Finale", outcomeName: "1/1", expected: "won", label: "HT/FT 1/1" },
        { sport: "Calcio", marketType: "Parziale/Finale", outcomeName: "X/1", expected: "lost", label: "HT/FT X/1 wrong" },
        { sport: "Calcio", marketType: "Tempo Con Maggior Gol 1X2", outcomeName: "2", expected: "won", label: "Half most goals 2nd (SH 3 > HT 1)" },
        // Props
        { sport: "Calcio", marketType: "Gol In Entrambi I Tempi", outcomeName: "Si", expected: "won", label: "Goal both halves Si (HT 1, SH 3)" },
      ],
    },

    // ─── CALCIO B (0-0, HT 0-0) ───
    {
      fixtureKey: "calcioB",
      tests: [
        { sport: "Calcio", marketType: "GG/NG", outcomeName: "GG", expected: "lost", label: "0-0 GG lost" },
        { sport: "Calcio", marketType: "GG/NG", outcomeName: "NG", expected: "won", label: "0-0 NG won" },
        { sport: "Calcio", marketType: "Draw No Bet", outcomeName: "1", expected: "void", label: "0-0 DNB void (draw)" },
        { sport: "Calcio", marketType: "1X2", outcomeName: "X", expected: "won", label: "0-0 1X2 draw" },
        { sport: "Calcio", marketType: "Gol In Entrambi I Tempi", outcomeName: "Si", expected: "lost", label: "0-0 goal both halves No" },
      ],
    },

    // ─── TENNIS (2-1 sets, games [6,3,7] vs [4,6,6], total 32 games) ───
    {
      fixtureKey: "tennis",
      tests: [
        { sport: "Tennis", marketType: "Vincente Incontro", outcomeName: "1", expected: "won", label: "Match winner home" },
        { sport: "Tennis", marketType: "Vincente Incontro", outcomeName: "2", expected: "lost", label: "Match winner away" },
        { sport: "Tennis", marketType: "Vincente Set 1", outcomeName: "1", expected: "won", label: "Set 1 winner home (6-4)" },
        { sport: "Tennis", marketType: "Vincente Set 2", outcomeName: "2", expected: "won", label: "Set 2 winner away (3-6)" },
        { sport: "Tennis", marketType: "Vincente Set 3", outcomeName: "1", expected: "won", label: "Set 3 winner home (7-6)" },
        { sport: "Tennis", marketType: "Set Betting", outcomeName: "2-1", expected: "won", label: "Set betting 2-1" },
        { sport: "Tennis", marketType: "Set Betting", outcomeName: "2-0", expected: "lost", label: "Set betting 2-0 wrong" },
        { sport: "Tennis", marketType: "U/O Games 31.5", outcomeName: "Over", expected: "won", label: "O/U games 31.5 over (32)", line: 31.5 },
        { sport: "Tennis", marketType: "U/O Games 32.5", outcomeName: "Under", expected: "won", label: "O/U games 32.5 under (32)", line: 32.5 },
        { sport: "Tennis", marketType: "U/O Giochi Set 1 9.5", outcomeName: "Over", expected: "won", label: "O/U games set 1 over (10)", line: 9.5 },
        { sport: "Tennis", marketType: "Numero Esatto Set", outcomeName: "3", expected: "won", label: "Exact sets 3" },
        { sport: "Tennis", marketType: "Set 3 Si/No", outcomeName: "Si", expected: "won", label: "Set 3 played Si" },
        { sport: "Tennis", marketType: "Giocatore 1 Vince Almeno Un Set", outcomeName: "Si", expected: "won", label: "Player 1 wins a set" },
        { sport: "Tennis", marketType: "T/T Handicap Games -1.5", outcomeName: "1", expected: "lost", label: "Handicap games -1.5 home (16-1.5=14.5 < 16)", line: -1.5 },
        { sport: "Tennis", marketType: "Pari/Dispari Games", outcomeName: "Pari", expected: "won", label: "P/D games even (32)" },
        { sport: "Tennis", marketType: "Pari/Dispari Set 1", outcomeName: "Pari", expected: "won", label: "P/D set 1 even (10)" },
        { sport: "Tennis", marketType: "Tiebreak Nel Match Si/No", outcomeName: "Si", expected: "won", label: "Tiebreak in match Si (set 3)" },
        { sport: "Tennis", marketType: "Combo Set 1 & Match", outcomeName: "1/1", expected: "won", label: "Set 1 + match winner 1/1" },
        { sport: "Tennis", marketType: "Pari/Dispari Set", outcomeName: "Dispari", expected: "won", label: "P/D sets odd (3)" },
        { sport: "Tennis", marketType: "Almeno Un Set 6-0 o 0-6", outcomeName: "No", expected: "won", label: "Bagel set No" },
        { sport: "Tennis", marketType: "U/O Set Totali 2.5", outcomeName: "Over", expected: "won", label: "O/U sets 2.5 over (3)", line: 2.5 },
      ],
    },

    // ─── TENNIS TAVOLO (3-1 sets, [11,8,11,11] vs [9,11,5,7], total pts 73) ───
    {
      fixtureKey: "tennisTavolo",
      tests: [
        { sport: "Tennis Tavolo", marketType: "T/T Match", outcomeName: "1", expected: "won", label: "TT match winner home" },
        { sport: "Tennis Tavolo", marketType: "Vincente Set 1", outcomeName: "1", expected: "won", label: "TT set 1 winner (11-9)" },
        { sport: "Tennis Tavolo", marketType: "Vincente Set 2", outcomeName: "2", expected: "won", label: "TT set 2 winner (8-11)" },
        { sport: "Tennis Tavolo", marketType: "Set Betting", outcomeName: "3-1", expected: "won", label: "TT set betting 3-1" },
        { sport: "Tennis Tavolo", marketType: "Numero Esatto Set", outcomeName: "4", expected: "won", label: "TT exact sets 4" },
        { sport: "Tennis Tavolo", marketType: "U/O Games 72.5", outcomeName: "Over", expected: "won", label: "TT O/U games 72.5 over (73)", line: 72.5 },
        { sport: "Tennis Tavolo", marketType: "Set 4 Si/No", outcomeName: "Si", expected: "won", label: "TT set 4 played" },
        { sport: "Tennis Tavolo", marketType: "Pari/Dispari Games", outcomeName: "Dispari", expected: "won", label: "TT P/D games odd (73)" },
      ],
    },

    // ─── BASKET (105-98, total 203) ───
    {
      fixtureKey: "basket",
      tests: [
        { sport: "Basket", marketType: "1X2", outcomeName: "1", expected: "won", label: "Basket 1X2 home" },
        { sport: "Basket", marketType: "U/O Incl. Supp. 202.5", outcomeName: "Over", expected: "won", label: "Basket O/U 202.5 over (203)", line: 202.5 },
        { sport: "Basket", marketType: "T/T Handicap (-3.5)", outcomeName: "1", expected: "won", label: "Basket handicap -3.5 home (105-3.5=101.5>98)", line: -3.5 },
        { sport: "Basket", marketType: "Vincente Incontro", outcomeName: "1", expected: "won", label: "Basket match winner home" },
        { sport: "Basket", marketType: "P/D", outcomeName: "Dispari", expected: "won", label: "Basket P/D odd (203)" },
        { sport: "Basket", marketType: "U/O Punti Casa 104.5", outcomeName: "Over", expected: "won", label: "Basket O/U home 104.5 over (105)", line: 104.5 },
        { sport: "Basket", marketType: "U/O Punti Ospite 98.5", outcomeName: "Under", expected: "won", label: "Basket O/U away 98.5 under (98)", line: 98.5 },
        { sport: "Basket", marketType: "Pari/Dispari Incl. Supp.", outcomeName: "Dispari", expected: "won", label: "Basket P/D incl OT odd (203)" },
        // Quarter markets (Q1: 28-24=52, Q2: 25-28=53, Q3: 26-22=48, Q4: 26-24=50)
        { sport: "Basket", marketType: "1X2 - 1° Quarto", outcomeName: "1", expected: "won", label: "Basket Q1 1X2 home (28>24)" },
        { sport: "Basket", marketType: "1X2 - 2° Quarto", outcomeName: "2", expected: "won", label: "Basket Q2 1X2 away (25<28)" },
        { sport: "Basket", marketType: "Under/Over 1° Quarto 51.5", outcomeName: "Over", expected: "won", label: "Basket Q1 O/U 51.5 over (52)", line: 51.5 },
        { sport: "Basket", marketType: "U/O 3° Quarto 47.5", outcomeName: "Over", expected: "won", label: "Basket Q3 O/U 47.5 over (48)", line: 47.5 },
        { sport: "Basket", marketType: "Pari/Dispari 1° Quarto", outcomeName: "Pari", expected: "won", label: "Basket Q1 P/D even (52)" },
        { sport: "Basket", marketType: "Pari/Dispari 4° Quarto", outcomeName: "Pari", expected: "won", label: "Basket Q4 P/D even (50)" },
        { sport: "Basket", marketType: "Draw No Bet - 1° Quarto", outcomeName: "1", expected: "won", label: "Basket Q1 DNB home (28>24)" },
        { sport: "Basket", marketType: "T/T Handicap 1° Quarto -3.5", outcomeName: "1", expected: "won", label: "Basket Q1 Handicap -3.5 home (28-3.5=24.5>24)", line: -3.5 },
      ],
    },

    // ─── HOCKEY (4-2, total 6) ───
    {
      fixtureKey: "hockey",
      tests: [
        { sport: "Hockey Ghiaccio", marketType: "1X2", outcomeName: "1", expected: "won", label: "Hockey 1X2 home" },
        { sport: "Hockey Ghiaccio", marketType: "U/O 4.5", outcomeName: "Over", expected: "won", label: "Hockey O/U 4.5 over (6)", line: 4.5 },
        { sport: "Hockey Ghiaccio", marketType: "GG/NG", outcomeName: "GG", expected: "won", label: "Hockey GG (both score)" },
        { sport: "Hockey Ghiaccio", marketType: "Vincente Incontro", outcomeName: "1", expected: "won", label: "Hockey match winner home" },
        { sport: "Hockey Ghiaccio", marketType: "Entrambe Segnano Almeno 1 Goal", outcomeName: "Si", expected: "won", label: "Hockey both score 1+" },
        // Period markets (P1: 2-0, P2: 1-1, P3: 1-1)
        { sport: "Hockey Ghiaccio", marketType: "1X2 1° Periodo", outcomeName: "1", expected: "won", label: "Hockey P1 1X2 home (2>0)" },
        { sport: "Hockey Ghiaccio", marketType: "1X2 2° Periodo", outcomeName: "X", expected: "won", label: "Hockey P2 1X2 draw (1=1)" },
        { sport: "Hockey Ghiaccio", marketType: "U/O 1° Periodo 1.5", outcomeName: "Over", expected: "won", label: "Hockey P1 O/U 1.5 over (2)", line: 1.5 },
        { sport: "Hockey Ghiaccio", marketType: "U/O 3° Periodo 1.5", outcomeName: "Over", expected: "won", label: "Hockey P3 O/U 1.5 over (2)", line: 1.5 },
      ],
    },

    // ─── PALLAMANO (32-28, total 60) ───
    {
      fixtureKey: "pallamano",
      tests: [
        { sport: "Pallamano", marketType: "1X2", outcomeName: "1", expected: "won", label: "Handball 1X2 home" },
        { sport: "Pallamano", marketType: "U/O 59.5", outcomeName: "Over", expected: "won", label: "Handball O/U 59.5 over (60)", line: 59.5 },
        { sport: "Pallamano", marketType: "Vincente Incontro", outcomeName: "1", expected: "won", label: "Handball match winner home" },
        { sport: "Pallamano", marketType: "T/T Handicap (-2.5)", outcomeName: "1", expected: "won", label: "Handball handicap -2.5 home (32-2.5=29.5>28)", line: -2.5 },
        { sport: "Pallamano", marketType: "P/D", outcomeName: "Pari", expected: "won", label: "Handball P/D even (60)" },
      ],
    },

    // ─── VOLLEY (3-2 sets, [25,20,25,22,15] vs [23,25,18,25,12], total 80+128=210 pts) ───
    {
      fixtureKey: "volley",
      tests: [
        { sport: "Volley", marketType: "Vincente Incontro", outcomeName: "1", expected: "won", label: "Volley match winner home" },
        { sport: "Volley", marketType: "Set Betting", outcomeName: "3-2", expected: "won", label: "Volley set betting 3-2" },
        { sport: "Volley", marketType: "Numero Esatto Set", outcomeName: "5", expected: "won", label: "Volley exact sets 5" },
        { sport: "Volley", marketType: "U/O Set Totali 4.5", outcomeName: "Over", expected: "won", label: "Volley O/U sets 4.5 over (5)", line: 4.5 },
        { sport: "Volley", marketType: "Set 5 Si/No", outcomeName: "Si", expected: "won", label: "Volley set 5 played" },
      ],
    },

    // ─── BASEBALL (5-3, total 8) ───
    {
      fixtureKey: "baseball",
      tests: [
        { sport: "Baseball", marketType: "1X2", outcomeName: "1", expected: "won", label: "Baseball 1X2 home" },
        { sport: "Baseball", marketType: "U/O 7.5", outcomeName: "Over", expected: "won", label: "Baseball O/U 7.5 over (8)", line: 7.5 },
        { sport: "Baseball", marketType: "Vincente Incontro", outcomeName: "1", expected: "won", label: "Baseball match winner home" },
        { sport: "Baseball", marketType: "T/T Handicap (-1.5)", outcomeName: "1", expected: "won", label: "Baseball handicap -1.5 home (3.5>3)", line: -1.5 },
        { sport: "Baseball", marketType: "P/D", outcomeName: "Pari", expected: "won", label: "Baseball P/D even (8)" },
      ],
    },

    // ─── ESPORTS (2-1 maps) ───
    {
      fixtureKey: "esports",
      tests: [
        { sport: "Esports", marketType: "Vincente Incontro", outcomeName: "1", expected: "won", label: "Esports match winner home" },
        { sport: "Esports", marketType: "1X2", outcomeName: "1", expected: "won", label: "Esports 1X2 home" },
        { sport: "Esports", marketType: "U/O 2.5", outcomeName: "Over", expected: "won", label: "Esports O/U 2.5 over (3)", line: 2.5 },
      ],
    },

    // ─── CALCIO STATS (2-1, corners 7-5, cards 3-2, shots OT 6-4) ───
    {
      fixtureKey: "calcioStats",
      tests: [
        // Corner markets (total 12, home 7, away 5)
        { sport: "Calcio", marketType: "U/O Angoli 10.5", outcomeName: "Over", expected: "won", label: "Corner O/U 10.5 over (12)", line: 10.5 },
        { sport: "Calcio", marketType: "U/O Corner 12.5", outcomeName: "Under", expected: "won", label: "Corner O/U 12.5 under (12)", line: 12.5 },
        { sport: "Calcio", marketType: "1X2 Corner", outcomeName: "1", expected: "won", label: "Corner 1X2 home (7>5)" },
        { sport: "Calcio", marketType: "1X2 Angoli", outcomeName: "2", expected: "lost", label: "Corner 1X2 away lost (5<7)" },
        { sport: "Calcio", marketType: "DC Corner", outcomeName: "1X", expected: "won", label: "Corner DC 1X (home wins)" },
        { sport: "Calcio", marketType: "Handicap Corner (-1.5)", outcomeName: "1", expected: "won", label: "Corner Handicap -1.5 home (7-1.5=5.5>5)", line: -1.5 },
        { sport: "Calcio", marketType: "Fascia Corner", outcomeName: "4", expected: "lost", label: "Corner band 4 (total 12, wrong)" },
        { sport: "Calcio", marketType: "Più calci d'angolo", outcomeName: "1", expected: "won", label: "Più corner home (7>5)" },
        // Card markets (home 3=2Y+1R, away 2=1Y+1R, total 5)
        { sport: "Calcio", marketType: "1X2 Cartellini", outcomeName: "1", expected: "won", label: "Cards 1X2 home (3>2)" },
        { sport: "Calcio", marketType: "U/O Cartellini 4.5", outcomeName: "Over", expected: "won", label: "Cards O/U 4.5 over (5)", line: 4.5 },
        // Shot on target markets (home 6, away 4, total 10)
        { sport: "Calcio", marketType: "U/O Tiri In Porta 9.5", outcomeName: "Over", expected: "won", label: "Shots OT O/U 9.5 over (10)", line: 9.5 },
        { sport: "Calcio", marketType: "1X2 Tiri", outcomeName: "1", expected: "won", label: "Shots OT 1X2 home (6>4)" },
      ],
    },
  ];
}

// ═══════════════════════════════════════════════════════════
// DB HELPERS
// ═══════════════════════════════════════════════════════════

async function findOrCreateSport(name: string): Promise<string> {
  const { data } = await supabase
    .from("sports")
    .select("id")
    .eq("name", name)
    .single();
  if (data) return data.id;

  const { data: created, error } = await supabase
    .from("sports")
    .insert({ name, slug: name.toLowerCase().replace(/\s/g, "-"), is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(`Cannot create sport ${name}: ${error.message}`);
  return created!.id;
}

async function createTestLeague(sportId: string, name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const { data, error } = await supabase
    .from("leagues")
    .insert({
      sport_id: sportId,
      name,
      slug,
      country: "TEST",
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Cannot create league: ${error.message}`);
  createdIds.leagues.push(data!.id);
  return data!.id;
}

async function createEvent(
  leagueId: string,
  sportId: string,
  fixture: SportFixture,
  statusOverride?: string
): Promise<string> {
  const liveData: Record<string, unknown> = {};
  if (fixture.halfScoreHome) liveData.halfScoreHome = fixture.halfScoreHome;
  if (fixture.halfScoreAway) liveData.halfScoreAway = fixture.halfScoreAway;
  if (fixture.stats) liveData.stats = fixture.stats;

  const status = statusOverride || "live";
  const { data, error } = await supabase
    .from("events")
    .insert({
      league_id: leagueId,
      sport_id: sportId,
      home_team: fixture.homeTeam,
      away_team: fixture.awayTeam,
      score_home: fixture.scoreHome,
      score_away: fixture.scoreAway,
      status,
      is_live: status === "live",
      external_id: `test:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      starts_at: new Date(Date.now() - 3600000).toISOString(),
      live_data: liveData,
      period: fixture.period || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Cannot create event: ${error.message}`);
  createdIds.events.push(data!.id);
  return data!.id;
}

async function createMarket(
  eventId: string,
  marketType: string,
  line?: number
): Promise<string> {
  const slug = marketType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    + (line != null ? `-${line}` : "")
    + `-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase
    .from("markets")
    .insert({
      event_id: eventId,
      market_type: marketType,
      name: marketType,
      slug,
      line: line ?? null,
      is_active: true,
      is_suspended: false,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Cannot create market ${marketType}: ${error.message}`);
  createdIds.markets.push(data!.id);
  return data!.id;
}

async function createOutcome(
  marketId: string,
  name: string,
  odds: number = 2.0
): Promise<string> {
  const { data, error } = await supabase
    .from("outcomes")
    .insert({
      market_id: marketId,
      name,
      odds,
      is_active: true,
      is_suspended: false,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Cannot create outcome ${name}: ${error.message}`);
  createdIds.outcomes.push(data!.id);
  return data!.id;
}

async function placeBetDirect(
  userId: string,
  selections: { eventId: string; marketId: string; outcomeId: string; odds: number }[],
  stake: number = 10,
  betType: string = "singola"
): Promise<string> {
  const totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  const { data: bet, error } = await supabase
    .from("bets")
    .insert({
      user_id: userId,
      bet_type: betType,
      stake,
      potential_win: parseFloat((stake * totalOdds).toFixed(2)),
      total_odds: parseFloat(totalOdds.toFixed(4)),
      status: "open",
      selections_count: selections.length,
      risk_score: 0,
    })
    .select("id")
    .single();

  if (error || !bet) throw new Error(`Cannot create bet: ${error?.message}`);
  createdIds.bets.push(bet.id);

  for (const sel of selections) {
    const { data: selData, error: selErr } = await supabase
      .from("bet_selections")
      .insert({
        bet_id: bet.id,
        event_id: sel.eventId,
        market_id: sel.marketId,
        outcome_id: sel.outcomeId,
        odds_at_placement: sel.odds,
      })
      .select("id")
      .single();

    if (selErr) throw new Error(`Cannot create selection: ${selErr.message}`);
    createdIds.betSelections.push(selData!.id);
  }

  return bet.id;
}

async function placeSistemaDirect(
  userId: string,
  selections: { eventId: string; marketId: string; outcomeId: string; odds: number }[],
  comboK: number,
  stake: number = 30
): Promise<{ parentId: string; childIds: string[] }> {
  const totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  const combos = combinations(selections.map((_, i) => i), comboK);
  const numCombos = combos.length;
  const stakePerCombo = Math.floor((stake * 100) / numCombos) / 100;

  // Insert parent
  const { data: parent, error: parentErr } = await supabase
    .from("bets")
    .insert({
      user_id: userId,
      bet_type: "sistema",
      stake: parseFloat((stakePerCombo * numCombos).toFixed(2)),
      total_odds: parseFloat(totalOdds.toFixed(4)),
      potential_win: 0,
      status: "open",
      selections_count: selections.length,
      combo_type: `${comboK}/${selections.length}`,
      combo_count: numCombos,
      combos_won: 0,
      risk_score: 0,
    })
    .select("id")
    .single();

  if (parentErr || !parent) throw new Error(`Cannot create parent bet: ${parentErr?.message}`);
  createdIds.bets.push(parent.id);

  const childIds: string[] = [];
  for (const comboIndices of combos) {
    const comboOdds = comboIndices.reduce((acc, i) => acc * selections[i].odds, 1);
    const { data: child, error: childErr } = await supabase
      .from("bets")
      .insert({
        user_id: userId,
        bet_type: "sistema_combo",
        parent_bet_id: parent.id,
        stake: stakePerCombo,
        total_odds: parseFloat(comboOdds.toFixed(4)),
        potential_win: parseFloat((stakePerCombo * comboOdds).toFixed(2)),
        status: "open",
        selections_count: comboK,
        risk_score: 0,
      })
      .select("id")
      .single();

    if (childErr || !child) throw new Error(`Cannot create child bet: ${childErr?.message}`);
    createdIds.bets.push(child.id);
    childIds.push(child.id);

    for (const idx of comboIndices) {
      const sel = selections[idx];
      const { data: selData, error: selErr } = await supabase
        .from("bet_selections")
        .insert({
          bet_id: child.id,
          event_id: sel.eventId,
          market_id: sel.marketId,
          outcome_id: sel.outcomeId,
          odds_at_placement: sel.odds,
        })
        .select("id")
        .single();
      if (selErr) throw new Error(`Cannot create sistema selection: ${selErr.message}`);
      createdIds.betSelections.push(selData!.id);
    }
  }

  return { parentId: parent.id, childIds };
}

function combinations(arr: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result: number[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const combo of rest) result.push([arr[i], ...combo]);
  }
  return result;
}

async function settleViaHttp(eventId: string, manualResult?: { home: number; away: number }) {
  const body: Record<string, unknown> = { event_id: eventId };
  if (manualResult) body.result = manualResult;

  const res = await fetch(`${BASE_URL}/api/settlement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getBetStatus(betId: string): Promise<{ status: string; actual_win: number; combos_won: number }> {
  const { data } = await supabase
    .from("bets")
    .select("status, actual_win, combos_won")
    .eq("id", betId)
    .single();
  return data || { status: "unknown", actual_win: 0, combos_won: 0 };
}

async function getSelectionResult(betId: string): Promise<string> {
  const { data } = await supabase
    .from("bet_selections")
    .select("result")
    .eq("bet_id", betId)
    .limit(1)
    .single();
  return data?.result || "null";
}

// ═══════════════════════════════════════════════════════════
// SETUP & CLEANUP
// ═══════════════════════════════════════════════════════════

async function setup() {
  console.log("Setting up test environment...\n");

  // Try known test users first, then create one
  const testUsernames = ["settlement_tester", "rec_player_1", "demo_player"];
  let foundUser = false;

  for (const uname of testUsernames) {
    const { data } = await supabase
      .from("users")
      .select("id")
      .eq("username", uname)
      .single();
    if (data) {
      testUserId = data.id;
      foundUser = true;
      console.log(`  Found existing user: ${uname}`);
      break;
    }
  }

  if (!foundUser) {
    // Pick any user from the DB
    const { data: anyUser } = await supabase
      .from("users")
      .select("id, username")
      .limit(1)
      .single();

    if (anyUser) {
      testUserId = anyUser.id;
      console.log(`  Using user: ${anyUser.username}`);
    } else {
      // Last resort: create via auth
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: `settlement-test-${Date.now()}@vincitu.test`,
        password: "TestPassword123!",
        email_confirm: true,
      });
      if (authErr || !authData.user) throw new Error(`Cannot create test user: ${authErr?.message}`);
      testUserId = authData.user.id;

      await supabase.from("users").insert({
        id: testUserId,
        username: "settlement_tester",
        full_name: "Settlement Tester",
        kyc_status: "verified",
      });
      console.log(`  Created new user: settlement_tester`);
    }
  }

  // Ensure wallet exists with enough balance
  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, balance")
    .eq("user_id", testUserId)
    .single();

  if (wallet) {
    testWalletId = wallet.id;
    originalBalance = wallet.balance;
    // Ensure enough balance
    if (wallet.balance < 100000) {
      await supabase.from("wallets").update({ balance: 100000 }).eq("id", wallet.id);
    }
  } else {
    const { data: newWallet, error: wErr } = await supabase
      .from("wallets")
      .insert({ user_id: testUserId, balance: 100000 })
      .select("id")
      .single();
    if (wErr || !newWallet) throw new Error(`Cannot create wallet: ${wErr?.message}`);
    testWalletId = newWallet.id;
    originalBalance = 0;
  }

  console.log(`  User ID: ${testUserId}`);
  console.log(`  Wallet: ${testWalletId} (balance: ${originalBalance})\n`);
}

async function cleanup() {
  console.log("\nCleaning up test data...");

  // Delete in dependency order
  // 1. Settlement logs
  for (const eventId of createdIds.events) {
    await supabase.from("settlement_log").delete().eq("event_id", eventId);
  }

  // 2. Transactions
  for (const betId of createdIds.bets) {
    await supabase.from("transactions").delete().eq("reference_id", betId);
  }

  // 3. Bet selections
  if (createdIds.betSelections.length > 0) {
    for (let i = 0; i < createdIds.betSelections.length; i += 200) {
      const chunk = createdIds.betSelections.slice(i, i + 200);
      await supabase.from("bet_selections").delete().in("id", chunk);
    }
  }

  // 4. Bets — children first (sistema_combo), then parents
  const childBets = [];
  const parentBets = [];
  for (const betId of createdIds.bets) {
    const { data } = await supabase
      .from("bets")
      .select("parent_bet_id")
      .eq("id", betId)
      .single();
    if (data?.parent_bet_id) childBets.push(betId);
    else parentBets.push(betId);
  }

  for (const id of childBets) {
    await supabase.from("bets").delete().eq("id", id);
  }
  for (const id of parentBets) {
    await supabase.from("bets").delete().eq("id", id);
  }

  // 5. Outcomes
  if (createdIds.outcomes.length > 0) {
    for (let i = 0; i < createdIds.outcomes.length; i += 200) {
      const chunk = createdIds.outcomes.slice(i, i + 200);
      await supabase.from("outcomes").delete().in("id", chunk);
    }
  }

  // 6. Markets
  if (createdIds.markets.length > 0) {
    for (let i = 0; i < createdIds.markets.length; i += 200) {
      const chunk = createdIds.markets.slice(i, i + 200);
      await supabase.from("markets").delete().in("id", chunk);
    }
  }

  // 7. Events
  for (const id of createdIds.events) {
    await supabase.from("events").delete().eq("id", id);
  }

  // 8. Leagues
  for (const id of createdIds.leagues) {
    await supabase.from("leagues").delete().eq("id", id);
  }

  // 9. Restore wallet balance
  await supabase.from("wallets").update({ balance: originalBalance }).eq("id", testWalletId);

  console.log("  Done!\n");
}

// ═══════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SETTLEMENT ENGINE — FULL E2E TEST SUITE");
  console.log("═══════════════════════════════════════════════════════\n");

  await setup();

  const results: TestResult[] = [];
  const sportCache = new Map<string, string>();     // sport name → sport_id
  const leagueCache = new Map<string, string>();    // sport name → league_id
  const eventCache = new Map<string, string>();     // fixture key → event_id

  // ── Create sports & leagues ──
  const allSports = new Set<string>();
  Object.values(FIXTURES).forEach(f => allSports.add(f.sport));

  for (const sportName of Array.from(allSports)) {
    const sportId = await findOrCreateSport(sportName);
    sportCache.set(sportName, sportId);
    const leagueId = await createTestLeague(sportId, `TEST League ${sportName}`);
    leagueCache.set(sportName, leagueId);
  }

  // ── Create events ──
  for (const [key, fixture] of Object.entries(FIXTURES)) {
    const sportId = sportCache.get(fixture.sport)!;
    const leagueId = leagueCache.get(fixture.sport)!;
    const statusOverride = key === "cancelled" ? "cancelled" : key === "postponed" ? "postponed" : undefined;
    const eventId = await createEvent(leagueId, sportId, fixture, statusOverride);
    eventCache.set(key, eventId);
  }

  console.log(`Created ${eventCache.size} test events\n`);

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: SINGOLA TESTS
  // ═══════════════════════════════════════════════════════════

  console.log("───────────────────────────────────────────────────────");
  console.log("  PHASE 1: SINGOLA BETS");
  console.log("───────────────────────────────────────────────────────\n");

  const singolaGroups = buildSingolaTests();

  for (const group of singolaGroups) {
    const eventId = eventCache.get(group.fixtureKey)!;
    const fixture = FIXTURES[group.fixtureKey];
    console.log(`[${fixture.sport}] ${fixture.homeTeam} vs ${fixture.awayTeam} (${fixture.scoreHome}-${fixture.scoreAway})`);

    // Create markets and outcomes, place bets
    // Cache market IDs by market_type to avoid unique constraint violations
    const marketCache = new Map<string, string>(); // market_type → market_id
    const betIds: { betId: string; test: TestCase }[] = [];

    for (const tc of group.tests) {
      try {
        // Parse line from market_type if present (e.g. "U/O 2.5" → 2.5)
        let marketLine = tc.line;
        if (marketLine == null) {
          const lineMatch = tc.marketType.match(/\s+([\d.]+)$/);
          if (lineMatch) marketLine = parseFloat(lineMatch[1]);
        }

        // Reuse existing market if same market_type for this event
        let marketId = marketCache.get(tc.marketType);
        if (!marketId) {
          marketId = await createMarket(eventId, tc.marketType, marketLine);
          marketCache.set(tc.marketType, marketId);
        }

        const outcomeId = await createOutcome(marketId, tc.outcomeName, 2.0);
        const betId = await placeBetDirect(testUserId, [
          { eventId, marketId, outcomeId, odds: 2.0 },
        ]);
        betIds.push({ betId, test: tc });
      } catch (err: any) {
        results.push({
          sport: tc.sport,
          marketType: tc.marketType,
          label: tc.label || tc.marketType,
          expected: tc.expected,
          actual: `ERROR: ${err.message}`,
          pass: false,
        });
      }
    }

    // Settle event
    const settleResult = await settleViaHttp(eventId);
    if (settleResult.error) {
      console.log(`  Settlement error: ${settleResult.error}`);
    }

    // Verify results
    let passed = 0;
    let failed = 0;
    for (const { betId, test: tc } of betIds) {
      const selResult = await getSelectionResult(betId);
      // "push" gets converted to "void" in settlement engine
      const expectedResult = tc.expected === "void" ? "void" : tc.expected;
      const actualResult = selResult === "push" ? "void" : selResult;
      const pass = actualResult === expectedResult;

      if (pass) passed++;
      else failed++;

      results.push({
        sport: tc.sport,
        marketType: tc.marketType,
        label: tc.label || tc.marketType,
        expected: expectedResult,
        actual: actualResult,
        pass,
      });

      if (!pass) {
        console.log(`  FAIL: ${tc.label} — expected=${expectedResult}, got=${actualResult}`);
      }
    }
    console.log(`  ${passed} passed, ${failed} failed out of ${betIds.length}\n`);
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: MULTI BETS
  // ═══════════════════════════════════════════════════════════

  console.log("───────────────────────────────────────────────────────");
  console.log("  PHASE 2: MULTI BETS");
  console.log("───────────────────────────────────────────────────────\n");

  // Create fresh events for multi tests (need unsettled events)
  const multiCalcioA = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioA, homeTeam: "MULTI FC Alpha", awayTeam: "MULTI FC Beta" }
  );
  const multiCalcioB = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioB, homeTeam: "MULTI FC Gamma", awayTeam: "MULTI FC Delta" }
  );
  const multiTennis = await createEvent(
    leagueCache.get("Tennis")!, sportCache.get("Tennis")!,
    { ...FIXTURES.tennis, homeTeam: "MULTI Player One", awayTeam: "MULTI Player Two" }
  );
  const multiHockey = await createEvent(
    leagueCache.get("Hockey Ghiaccio")!, sportCache.get("Hockey Ghiaccio")!,
    { ...FIXTURES.hockey, homeTeam: "MULTI Hockey Home", awayTeam: "MULTI Hockey Away" }
  );

  // Create markets & outcomes for multi legs
  const mCalcioA_1x2_mkt = await createMarket(multiCalcioA, "1X2");
  const mCalcioA_1x2_out = await createOutcome(mCalcioA_1x2_mkt, "1", 1.80);

  const mCalcioB_1x2_mkt = await createMarket(multiCalcioB, "1X2");
  const mCalcioB_1x2_out1 = await createOutcome(mCalcioB_1x2_mkt, "1", 2.50); // will lose (0-0)

  const mCalcioB_dnb_mkt = await createMarket(multiCalcioB, "Draw No Bet");
  const mCalcioB_dnb_out1 = await createOutcome(mCalcioB_dnb_mkt, "1", 2.00); // will void (draw)
  const mCalcioB_dnb_out2 = await createOutcome(mCalcioB_dnb_mkt, "2", 1.90); // will void (draw)

  const mTennis_mw_mkt = await createMarket(multiTennis, "Vincente Incontro");
  const mTennis_mw_out = await createOutcome(mTennis_mw_mkt, "1", 1.50);

  const mHockey_1x2_mkt = await createMarket(multiHockey, "1X2");
  const mHockey_1x2_out = await createOutcome(mHockey_1x2_mkt, "1", 2.10);

  // Multi A: All won (Calcio A 1X2→1, Tennis MW→1, Hockey 1X2→1)
  const multiA = await placeBetDirect(testUserId, [
    { eventId: multiCalcioA, marketId: mCalcioA_1x2_mkt, outcomeId: mCalcioA_1x2_out, odds: 1.80 },
    { eventId: multiTennis, marketId: mTennis_mw_mkt, outcomeId: mTennis_mw_out, odds: 1.50 },
    { eventId: multiHockey, marketId: mHockey_1x2_mkt, outcomeId: mHockey_1x2_out, odds: 2.10 },
  ], 10, "multi");

  // Multi B: One lost (Calcio A 1X2→1 won, Calcio B 1X2→1 lost)
  const multiB = await placeBetDirect(testUserId, [
    { eventId: multiCalcioA, marketId: mCalcioA_1x2_mkt, outcomeId: mCalcioA_1x2_out, odds: 1.80 },
    { eventId: multiCalcioB, marketId: mCalcioB_1x2_mkt, outcomeId: mCalcioB_1x2_out1, odds: 2.50 },
  ], 10, "multi");

  // Multi C: Won + void (Calcio A 1X2→1 won, Calcio B DNB→1 void)
  const multiC = await placeBetDirect(testUserId, [
    { eventId: multiCalcioA, marketId: mCalcioA_1x2_mkt, outcomeId: mCalcioA_1x2_out, odds: 1.80 },
    { eventId: multiCalcioB, marketId: mCalcioB_dnb_mkt, outcomeId: mCalcioB_dnb_out1, odds: 2.00 },
  ], 10, "multi");

  // Multi D: All void (Calcio B DNB→1, Calcio B DNB→2 — both void)
  // Need separate bets with separate selections
  const mCalcioB_dnb_mkt2 = await createMarket(multiCalcioB, "Draw No Bet - Tempo regolamentare");
  const mCalcioB_dnb_out2b = await createOutcome(mCalcioB_dnb_mkt2, "2", 1.85);
  const multiD = await placeBetDirect(testUserId, [
    { eventId: multiCalcioB, marketId: mCalcioB_dnb_mkt, outcomeId: mCalcioB_dnb_out2, odds: 1.90 },
    { eventId: multiCalcioB, marketId: mCalcioB_dnb_mkt2, outcomeId: mCalcioB_dnb_out2b, odds: 1.85 },
  ], 10, "multi");

  // Settle all multi events
  await settleViaHttp(multiCalcioA);
  await settleViaHttp(multiCalcioB);
  await settleViaHttp(multiTennis);
  await settleViaHttp(multiHockey);

  // Verify Multi A: all won → payout = 10 × 1.80 × 1.50 × 2.10 = 56.70
  const multiAStatus = await getBetStatus(multiA);
  const multiAExpectedPayout = parseFloat((10 * 1.80 * 1.50 * 2.10).toFixed(2));
  results.push({
    sport: "Multi", marketType: "All Won", label: "Multi A: all legs won",
    expected: "won", actual: multiAStatus.status,
    pass: multiAStatus.status === "won" && Math.abs(multiAStatus.actual_win - multiAExpectedPayout) < 0.02,
  });
  if (multiAStatus.status !== "won" || Math.abs(multiAStatus.actual_win - multiAExpectedPayout) >= 0.02) {
    console.log(`  FAIL Multi A: status=${multiAStatus.status}, payout=${multiAStatus.actual_win} (expected ${multiAExpectedPayout})`);
  }

  // Verify Multi B: one lost → lost, payout = 0
  const multiBStatus = await getBetStatus(multiB);
  results.push({
    sport: "Multi", marketType: "One Lost", label: "Multi B: one leg lost",
    expected: "lost", actual: multiBStatus.status,
    pass: multiBStatus.status === "lost" && multiBStatus.actual_win === 0,
  });
  if (multiBStatus.status !== "lost") {
    console.log(`  FAIL Multi B: status=${multiBStatus.status}`);
  }

  // Verify Multi C: won + void → won, payout = 10 × 1.80 (void removed)
  const multiCStatus = await getBetStatus(multiC);
  const multiCExpectedPayout = parseFloat((10 * 1.80).toFixed(2));
  results.push({
    sport: "Multi", marketType: "Won+Void", label: "Multi C: won + void leg",
    expected: "won", actual: multiCStatus.status,
    pass: multiCStatus.status === "won" && Math.abs(multiCStatus.actual_win - multiCExpectedPayout) < 0.02,
  });
  if (multiCStatus.status !== "won" || Math.abs(multiCStatus.actual_win - multiCExpectedPayout) >= 0.02) {
    console.log(`  FAIL Multi C: status=${multiCStatus.status}, payout=${multiCStatus.actual_win} (expected ${multiCExpectedPayout})`);
  }

  // Verify Multi D: all void → void, stake refunded
  const multiDStatus = await getBetStatus(multiD);
  results.push({
    sport: "Multi", marketType: "All Void", label: "Multi D: all legs void",
    expected: "void", actual: multiDStatus.status,
    pass: multiDStatus.status === "void",
  });
  if (multiDStatus.status !== "void") {
    console.log(`  FAIL Multi D: status=${multiDStatus.status}`);
  }

  const multiPassed = results.filter(r => r.sport === "Multi" && r.pass).length;
  const multiFailed = results.filter(r => r.sport === "Multi" && !r.pass).length;
  console.log(`\n  Multi: ${multiPassed} passed, ${multiFailed} failed\n`);

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: SISTEMA BETS
  // ═══════════════════════════════════════════════════════════

  console.log("───────────────────────────────────────────────────────");
  console.log("  PHASE 3: SISTEMA BETS");
  console.log("───────────────────────────────────────────────────────\n");

  // Create fresh events for sistema
  const sysCalcioA = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioA, homeTeam: "SYS FC Alpha", awayTeam: "SYS FC Beta" }
  );
  const sysCalcioB = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioB, homeTeam: "SYS FC Gamma", awayTeam: "SYS FC Delta" }
  );
  const sysTennis = await createEvent(
    leagueCache.get("Tennis")!, sportCache.get("Tennis")!,
    { ...FIXTURES.tennis, homeTeam: "SYS Player One", awayTeam: "SYS Player Two" }
  );

  // Markets for sistema legs
  const sCalcioA_mkt = await createMarket(sysCalcioA, "1X2");
  const sCalcioA_out = await createOutcome(sCalcioA_mkt, "1", 1.80);

  const sCalcioB_mkt = await createMarket(sysCalcioB, "1X2");
  const sCalcioB_out_X = await createOutcome(sCalcioB_mkt, "X", 3.20); // will win (0-0)
  const sCalcioB_out_1 = await createOutcome(sCalcioB_mkt, "1", 2.50); // will lose

  const sTennis_mkt = await createMarket(sysTennis, "Vincente Incontro");
  const sTennis_out = await createOutcome(sTennis_mkt, "1", 1.50);

  // Sistema A: 2/3 — all 3 winning legs
  const sysA = await placeSistemaDirect(testUserId, [
    { eventId: sysCalcioA, marketId: sCalcioA_mkt, outcomeId: sCalcioA_out, odds: 1.80 },
    { eventId: sysCalcioB, marketId: sCalcioB_mkt, outcomeId: sCalcioB_out_X, odds: 3.20 },
    { eventId: sysTennis, marketId: sTennis_mkt, outcomeId: sTennis_out, odds: 1.50 },
  ], 2, 30);

  // Sistema B: 2/3 — 2 won (CalcioA, Tennis) + 1 lost (CalcioB→1)
  // Need separate CalcioB event for losing leg
  const sysCalcioB2 = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioB, homeTeam: "SYS FC Epsilon", awayTeam: "SYS FC Zeta" }
  );
  const sCalcioB2_mkt = await createMarket(sysCalcioB2, "1X2");
  const sCalcioB2_out_1 = await createOutcome(sCalcioB2_mkt, "1", 2.50);

  // Need separate calcioA and tennis events too
  const sysCalcioA2 = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioA, homeTeam: "SYS FC Alpha2", awayTeam: "SYS FC Beta2" }
  );
  const sCalcioA2_mkt = await createMarket(sysCalcioA2, "1X2");
  const sCalcioA2_out = await createOutcome(sCalcioA2_mkt, "1", 1.80);

  const sysTennis2 = await createEvent(
    leagueCache.get("Tennis")!, sportCache.get("Tennis")!,
    { ...FIXTURES.tennis, homeTeam: "SYS Player One2", awayTeam: "SYS Player Two2" }
  );
  const sTennis2_mkt = await createMarket(sysTennis2, "Vincente Incontro");
  const sTennis2_out = await createOutcome(sTennis2_mkt, "1", 1.50);

  const sysB = await placeSistemaDirect(testUserId, [
    { eventId: sysCalcioA2, marketId: sCalcioA2_mkt, outcomeId: sCalcioA2_out, odds: 1.80 },
    { eventId: sysCalcioB2, marketId: sCalcioB2_mkt, outcomeId: sCalcioB2_out_1, odds: 2.50 },
    { eventId: sysTennis2, marketId: sTennis2_mkt, outcomeId: sTennis2_out, odds: 1.50 },
  ], 2, 30);

  // Sistema C: 2/3 — all losing
  const sysCalcioA3 = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioB, homeTeam: "SYS FC Lose1", awayTeam: "SYS FC Lose2" }
  );
  const sCalcioA3_mkt = await createMarket(sysCalcioA3, "1X2");
  const sCalcioA3_out = await createOutcome(sCalcioA3_mkt, "1", 1.80); // 0-0, "1" loses

  const sysCalcioB3 = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioB, homeTeam: "SYS FC Lose3", awayTeam: "SYS FC Lose4" }
  );
  const sCalcioB3_mkt = await createMarket(sysCalcioB3, "1X2");
  const sCalcioB3_out = await createOutcome(sCalcioB3_mkt, "1", 2.50); // 0-0, "1" loses

  const sysCalcioC3 = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioB, homeTeam: "SYS FC Lose5", awayTeam: "SYS FC Lose6" }
  );
  const sCalcioC3_mkt = await createMarket(sysCalcioC3, "1X2");
  const sCalcioC3_out = await createOutcome(sCalcioC3_mkt, "1", 2.00); // 0-0, "1" loses

  const sysC = await placeSistemaDirect(testUserId, [
    { eventId: sysCalcioA3, marketId: sCalcioA3_mkt, outcomeId: sCalcioA3_out, odds: 1.80 },
    { eventId: sysCalcioB3, marketId: sCalcioB3_mkt, outcomeId: sCalcioB3_out, odds: 2.50 },
    { eventId: sysCalcioC3, marketId: sCalcioC3_mkt, outcomeId: sCalcioC3_out, odds: 2.00 },
  ], 2, 30);

  // Settle all sistema events
  await settleViaHttp(sysCalcioA);
  await settleViaHttp(sysCalcioB);
  await settleViaHttp(sysTennis);
  await settleViaHttp(sysCalcioA2);
  await settleViaHttp(sysCalcioB2);
  await settleViaHttp(sysTennis2);
  await settleViaHttp(sysCalcioA3);
  await settleViaHttp(sysCalcioB3);
  await settleViaHttp(sysCalcioC3);

  // Verify Sistema A: all 3 won → combos_won=3, parent=won
  const sysAStatus = await getBetStatus(sysA.parentId);
  results.push({
    sport: "Sistema", marketType: "2/3 All Won", label: "Sistema A: 3 winning legs, combos_won=3",
    expected: "won", actual: sysAStatus.status,
    pass: sysAStatus.status === "won" && sysAStatus.combos_won === 3,
  });
  if (sysAStatus.status !== "won" || sysAStatus.combos_won !== 3) {
    console.log(`  FAIL Sistema A: status=${sysAStatus.status}, combos_won=${sysAStatus.combos_won}`);
  }

  // Verify Sistema B: 2 won + 1 lost → combos_won=1 (only combo with 2 winners)
  const sysBStatus = await getBetStatus(sysB.parentId);
  results.push({
    sport: "Sistema", marketType: "2/3 Mixed", label: "Sistema B: 2 won + 1 lost, combos_won=1",
    expected: "won", actual: sysBStatus.status,
    pass: sysBStatus.status === "won" && sysBStatus.combos_won === 1,
  });
  if (sysBStatus.status !== "won" || sysBStatus.combos_won !== 1) {
    console.log(`  FAIL Sistema B: status=${sysBStatus.status}, combos_won=${sysBStatus.combos_won}`);
  }

  // Verify Sistema C: all lost → combos_won=0, parent=lost
  const sysCStatus = await getBetStatus(sysC.parentId);
  results.push({
    sport: "Sistema", marketType: "2/3 All Lost", label: "Sistema C: 3 losing legs",
    expected: "lost", actual: sysCStatus.status,
    pass: sysCStatus.status === "lost" && sysCStatus.combos_won === 0,
  });
  if (sysCStatus.status !== "lost" || sysCStatus.combos_won !== 0) {
    console.log(`  FAIL Sistema C: status=${sysCStatus.status}, combos_won=${sysCStatus.combos_won}`);
  }

  const sisPassed = results.filter(r => r.sport === "Sistema" && r.pass).length;
  const sisFailed = results.filter(r => r.sport === "Sistema" && !r.pass).length;
  console.log(`\n  Sistema: ${sisPassed} passed, ${sisFailed} failed\n`);

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: EDGE CASES
  // ═══════════════════════════════════════════════════════════

  console.log("───────────────────────────────────────────────────────");
  console.log("  PHASE 4: EDGE CASES");
  console.log("───────────────────────────────────────────────────────\n");

  // Edge 1: Cancelled event → all void
  const cancelledEventId = eventCache.get("cancelled")!;
  const canMkt = await createMarket(cancelledEventId, "1X2");
  const canOut = await createOutcome(canMkt, "1", 2.00);
  const cancelledBet = await placeBetDirect(testUserId, [
    { eventId: cancelledEventId, marketId: canMkt, outcomeId: canOut, odds: 2.00 },
  ]);
  await settleViaHttp(cancelledEventId);
  const cancelledStatus = await getBetStatus(cancelledBet);
  results.push({
    sport: "Edge", marketType: "Cancelled", label: "Cancelled event → void",
    expected: "void", actual: cancelledStatus.status,
    pass: cancelledStatus.status === "void",
  });
  if (cancelledStatus.status !== "void") {
    console.log(`  FAIL Cancelled: status=${cancelledStatus.status}`);
  }

  // Edge 2: Postponed event → all void
  const postponedEventId = eventCache.get("postponed")!;
  const ppMkt = await createMarket(postponedEventId, "1X2");
  const ppOut = await createOutcome(ppMkt, "1", 2.00);
  const postponedBet = await placeBetDirect(testUserId, [
    { eventId: postponedEventId, marketId: ppMkt, outcomeId: ppOut, odds: 2.00 },
  ]);
  await settleViaHttp(postponedEventId);
  const postponedStatus = await getBetStatus(postponedBet);
  results.push({
    sport: "Edge", marketType: "Postponed", label: "Postponed event → void",
    expected: "void", actual: postponedStatus.status,
    pass: postponedStatus.status === "void",
  });
  if (postponedStatus.status !== "void") {
    console.log(`  FAIL Postponed: status=${postponedStatus.status}`);
  }

  // Edge 3: Push (U/O line = total) → void
  const pushEvent = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioA, homeTeam: "PUSH FC Home", awayTeam: "PUSH FC Away" }
  );
  const pushMkt = await createMarket(pushEvent, "U/O 4.0", 4.0); // total = 4
  const pushOut = await createOutcome(pushMkt, "Over", 1.90);
  const pushBet = await placeBetDirect(testUserId, [
    { eventId: pushEvent, marketId: pushMkt, outcomeId: pushOut, odds: 1.90 },
  ]);
  await settleViaHttp(pushEvent);
  const pushStatus = await getBetStatus(pushBet);
  results.push({
    sport: "Edge", marketType: "Push", label: "Push (line = total) → void",
    expected: "void", actual: pushStatus.status,
    pass: pushStatus.status === "void",
  });
  if (pushStatus.status !== "void") {
    console.log(`  FAIL Push: status=${pushStatus.status}`);
  }

  // Edge 4: Already settled → skip
  const alreadySettledResult = await settleViaHttp(pushEvent); // try to settle again
  results.push({
    sport: "Edge", marketType: "Already Settled", label: "Already settled → skip",
    expected: "already_settled", actual: alreadySettledResult.already_settled ? "already_settled" : "unexpected",
    pass: alreadySettledResult.already_settled === true,
  });

  // Edge 5: Auto-void market (e.g. Corner successivo — in-play only, always voided)
  const autoVoidEvent = await createEvent(
    leagueCache.get("Calcio")!, sportCache.get("Calcio")!,
    { ...FIXTURES.calcioA, homeTeam: "VOID FC Home", awayTeam: "VOID FC Away" }
  );
  const avMkt = await createMarket(autoVoidEvent, "Corner successivo");
  const avOut = await createOutcome(avMkt, "Casa", 1.85);
  const autoVoidBet = await placeBetDirect(testUserId, [
    { eventId: autoVoidEvent, marketId: avMkt, outcomeId: avOut, odds: 1.85 },
  ]);
  await settleViaHttp(autoVoidEvent);
  const avStatus = await getBetStatus(autoVoidBet);
  results.push({
    sport: "Edge", marketType: "Auto-Void", label: "Auto-void market (corners) → void",
    expected: "void", actual: avStatus.status,
    pass: avStatus.status === "void",
  });
  if (avStatus.status !== "void") {
    console.log(`  FAIL Auto-Void: status=${avStatus.status}`);
  }

  const edgePassed = results.filter(r => r.sport === "Edge" && r.pass).length;
  const edgeFailed = results.filter(r => r.sport === "Edge" && !r.pass).length;
  console.log(`\n  Edge cases: ${edgePassed} passed, ${edgeFailed} failed\n`);

  // ═══════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════

  console.log("═══════════════════════════════════════════════════════");
  console.log("  FINAL REPORT");
  console.log("═══════════════════════════════════════════════════════\n");

  // Group by sport
  const sports = Array.from(new Set(results.map(r => r.sport)));
  for (const sport of sports) {
    const sportResults = results.filter(r => r.sport === sport);
    const passed = sportResults.filter(r => r.pass).length;
    const failed = sportResults.filter(r => !r.pass).length;
    const icon = failed === 0 ? "OK" : "FAIL";
    console.log(`  [${icon}] ${sport}: ${passed}/${sportResults.length} passed`);
  }

  const totalPassed = results.filter(r => r.pass).length;
  const totalFailed = results.filter(r => !r.pass).length;
  console.log(`\n  TOTAL: ${totalPassed} passed, ${totalFailed} failed out of ${results.length} tests`);

  if (totalFailed > 0) {
    console.log("\n  FAILURES:");
    for (const r of results.filter(r => !r.pass)) {
      console.log(`    [${r.sport}] ${r.label}: expected=${r.expected}, got=${r.actual}`);
    }
  }

  // Cleanup
  await cleanup();

  // Exit with appropriate code
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  cleanup().then(() => process.exit(2));
});
