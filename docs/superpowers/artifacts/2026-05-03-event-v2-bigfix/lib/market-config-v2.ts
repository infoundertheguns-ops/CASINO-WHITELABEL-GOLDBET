// lib/market-config-v2.ts
//
// Tab/sub-pill mapping for event detail v2. Market types MUST match the actual
// `market_type` column emitted by `v_player_markets` (verified via SQL GROUP BY).
// Mig 159 vocabulary canonical (mostly Italian); see docs/superpowers for translation
// table. NEVER invent market_type strings here — if it does not show up in the DB
// for the sport, it will silently render as an empty tab.

export type MarketSpec = string;  // formato "MARKET_TYPE" o "MARKET_TYPE@suffix"

export type SubPillConfig = {
  markets: MarketSpec[];
};

export type TabConfig = {
  markets?: MarketSpec[];
  subPills?: Record<string, SubPillConfig>;
};

export type SportTabConfig = Record<string, TabConfig>;

export const FOOTBALL_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: ["1X2", "DC", "GG/NG", "U/O@2.5", "DNB"],
  },
  "Gol/U/O": {
    markets: [
      "U/O@picker",
      "U/O - 1T@picker",
      "U/O - 2T@picker",
      "Alternative Total Goals@picker",
      "1st Half Goal Line@picker",
      "GG/NG",
      "Both Teams To Score HT",
      "GG/NG - 2T",
      "Exact Total Goals",
      "Number of Goals In Match",
      "To Score 2+ Goals",
      "To Score 3+ Goals",
      "First Team To Score",
    ],
  },
  "Handicap": {
    markets: [
      "Handicap@picker",
      "Handicap - 1T@picker",
      "Alternative Asian Handicap@picker",
    ],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": {
        markets: [
          "1X2 - 1T",
          "U/O - 1T@picker",
          "Handicap - 1T@picker",
          "Both Teams To Score HT",
          "1st Half Goal Line@picker",
        ],
      },
      "2° Tempo": {
        markets: [
          "1X2 - 2T",
          "U/O - 2T@picker",
          "GG/NG - 2T",
        ],
      },
      "Combo HT/FT": {
        markets: ["1T/Finale"],
      },
    },
  },
  "Player": {
    subPills: {
      "Marcatori": {
        markets: ["Marcatore", "Team Goalscorer", "Multi Scorers", "Player To Score or Assist"],
      },
      "Goalkeeper": {
        markets: ["Goalkeeper Saves@picker"],
      },
      "Shots": {
        markets: [
          "Player Shots@picker",
          "Player Shots on Target@picker",
          "Player Shots on Target Outside Box",
          "Player Headed Shots on Target",
        ],
      },
      "Cards": {
        markets: ["Player to be Booked", "Player Cards"],
      },
      "Other": {
        markets: [
          "Player Tackles@picker",
          "Player Fouls Committed@picker",
          "Player To Assist",
          "Player Passes@picker",
          "Player To Be Fouled",
          "Player Fouls@picker",
        ],
      },
    },
  },
  "Stats": {
    subPills: {
      "Cards": {
        markets: [
          "Bookings Totals@picker",
          "Card Handicap@picker",
          "Number of Cards In Match",
          "Bookings Spread@picker",
          "Team Cards Home",
          "Team Cards Away",
        ],
      },
      "Corners": {
        markets: [
          "Totale angoli@picker",
          "Total Corners@picker",
          "Angoli",
          "Angoli 2-Way",
          "Handicap angoli@picker",
          "Corner Handicap@picker",
          "Corners Race",
          "Alternative Corners@picker",
          "Team Corners Home",
          "Team Corners Away",
        ],
      },
      "Shots": {
        markets: [
          "Total Shots@picker",
          "Total Shots on Target@picker",
          "Match Shots",
          "Match Shots on Target",
          "Total Shots Home",
          "Total Shots Away",
          "Total Shots on Target Home",
          "Total Shots on Target Away",
          "Team Shots Home",
          "Team Shots Away",
        ],
      },
    },
  },
};

export const FOOTBALL_TAB_ORDER = ["Principali", "Gol/U/O", "Handicap", "Tempi", "Player", "Stats"];

export const FOOTBALL_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "1° Tempo",
  "Player": "Marcatori",
  "Stats": "Corners",
};

export function parseMarketSpec(spec: MarketSpec): { marketType: string; suffix: string | null } {
  const idx = spec.indexOf("@");
  if (idx === -1) return { marketType: spec, suffix: null };
  return { marketType: spec.substring(0, idx), suffix: spec.substring(idx + 1) };
}
