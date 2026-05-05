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
      "First Team To Score",
      "P/D",
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
        markets: [
          "Marcatore",
          "Team Goalscorer",
          "Multi Scorers",
          "Player To Score or Assist",
          "To Score 2+ Goals",
          "To Score 3+ Goals",
        ],
      },
      "Goalkeeper": {
        markets: ["Goalkeeper Saves@flat"],
      },
      "Shots": {
        markets: [
          "Player Shots@flat",
          "Player Shots on Target@flat",
          "Player Shots on Target Outside Box@flat",
          "Player Headed Shots on Target@flat",
        ],
      },
      "Cards": {
        markets: ["Player to be Booked", "Player Cards"],
      },
      "Other": {
        markets: [
          "Player Tackles@flat",
          "Player Fouls Committed@flat",
          "Player To Assist@flat",
          "Player Passes@flat",
          "Player To Be Fouled@flat",
          "Player Fouls@flat",
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
          "Bookings Totals Home@picker",
          "Bookings Totals Away@picker",
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
          "Total Shots Home@picker",
          "Total Shots Away@picker",
          "Total Shots on Target Home@picker",
          "Total Shots on Target Away@picker",
          "Team Shots Home@picker",
          "Team Shots Away@picker",
          "Team Shots on Target Home@picker",
          "Team Shots on Target Away@picker",
        ],
      },
      "Tackles": {
        markets: [
          "Match Tackles@picker",
          "Team Tackles Home@picker",
          "Team Tackles Away@picker",
        ],
      },
    },
  },
  "Altri": {
    markets: [],  // catch-all: rendered specially in page-v2 (uncategorized markets)
  },
};

export const FOOTBALL_TAB_ORDER = ["Principali", "Gol/U/O", "Handicap", "Tempi", "Player", "Stats", "Altri"];

export const FOOTBALL_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "1° Tempo",
  "Player": "Marcatori",
  "Stats": "Corners",
};



export const TENNIS_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T Match (Escl. Ritiro)",
      "Totale set@2.5",
      "Totale giochi@22.5",
      "Handicap@-1.5",
    ],
  },
  "Set": {
    markets: [
      "1X2 - 1T",
      "Totals 1st Set@picker",
      "T/T 1° Set",
      "T/T 2° Set",
    ],
  },
  "U/O Giochi": {
    markets: ["Totale giochi@picker"],
  },
  "Handicap": {
    markets: ["Handicap@picker"],
  },
  "Altri": {
    markets: [],
  },
};

export const TENNIS_TAB_ORDER = ["Principali", "Set", "U/O Giochi", "Handicap", "Altri"];

export const TENNIS_DEFAULT_SUB_PILL: Record<string, string> = {};

export const BASKET_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (basket-only, see page-v2 isHero ext)
      "1X2 Tempo Regolamentare",      // compact, auto-hide if absent
      "U/O Incl. Supp.@picker",
      "T/T Handicap@picker",
      "DNB",
      "P/D",
    ],
  },
  "U/O": {
    markets: [
      "U/O Incl. Supp.@picker",
      "Alternative Totals@picker",
    ],
  },
  "Handicap": {
    markets: [
      "T/T Handicap@picker",
      "Alternative Spread@picker",
    ],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": {
        markets: [
          "1X2 - 1T",
          "U/O - 1T@picker",
          "Handicap - 1T@picker",
          "3-Way Result HT",
        ],
      },
      "2° Tempo": {
        markets: ["1X2 - 2T"],
      },
    },
  },
  "Quarti": {
    subPills: {
      "Q1": { markets: ["1X2 - 1Q", "ML 1Q", "U/O - 1Q@picker", "Handicap - 1Q@picker", "Spread 1Q@picker"] },
      "Q2": { markets: ["ML 2Q", "U/O - 2Q@picker", "Spread 2Q@picker"] },
      "Q3": { markets: ["ML 3Q", "U/O - 3Q@picker", "Spread 3Q@picker"] },
      "Q4": { markets: ["ML 4Q", "U/O - 4Q@picker", "Spread 4Q@picker"] },
    },
  },
  "Player": {
    subPills: {
      "Punti":    { markets: ["Player Points Milestones@flat"] },
      "Rimbalzi": { markets: ["Player Rebounds Milestones@flat"] },
      "Triple":   { markets: ["Player Threes Milestones@flat"] },
      "Assist":   { markets: ["Player Assists Milestones@flat"] },
      "First":    { markets: ["Player First Basket", "Player First Assist", "Player First Rebound"] },
      "Altro":    { markets: ["Double Double", "Player Props@over-under-flat"] },
    },
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const BASKET_TAB_ORDER = [
  "Principali", "U/O", "Handicap", "Tempi", "Quarti", "Player", "Altri",
];

export const BASKET_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "1° Tempo",
  "Quarti": "Q1",
  "Player": "Punti",
};


// Per-sport lookup maps. Defaults fall back to calcio so an unconfigured sport_slug
// still renders something (the availableTabs filter then strips empty tabs, leaving
// at most Altri with all markets visible).
export const TAB_MARKETS_BY_SPORT: Record<string, SportTabConfig> = {
  calcio: FOOTBALL_TAB_MARKETS_V2,
  tennis: TENNIS_TAB_MARKETS_V2,
  basket: BASKET_TAB_MARKETS_V2,
};

export const TAB_ORDER_BY_SPORT: Record<string, string[]> = {
  calcio: FOOTBALL_TAB_ORDER,
  tennis: TENNIS_TAB_ORDER,
  basket: BASKET_TAB_ORDER,
};

export const DEFAULT_SUB_PILL_BY_SPORT: Record<string, Record<string, string>> = {
  calcio: FOOTBALL_DEFAULT_SUB_PILL,
  tennis: TENNIS_DEFAULT_SUB_PILL,
  basket: BASKET_DEFAULT_SUB_PILL,
};

export function parseMarketSpec(spec: MarketSpec): { marketType: string; suffix: string | null } {
  const idx = spec.indexOf("@");
  if (idx === -1) return { marketType: spec, suffix: null };
  return { marketType: spec.substring(0, idx), suffix: spec.substring(idx + 1) };
}

// === Title overrides per-sport ===
// Keyed on the sport_slug as it arrives in titleFor(m, sportSlug). Returns the
// IT-friendly label for a given DB market_type, or null when no override exists.
// Migrated from page-v2.tsx (was BASKET_TITLE_OVERRIDES + resolveBasketOverride).

export const TITLE_OVERRIDES_BY_SPORT: Record<string, Record<string, string>> = {
  basket: {
    "1X2 Tempo Regolamentare": "Vincente Tempi Regolamentari",
    "U/O Incl. Supp.": "Under/Over (con OT)",
    "ML 1Q": "Vincente 1° Quarto",
    "ML 2Q": "Vincente 2° Quarto",
    "ML 3Q": "Vincente 3° Quarto",
    "ML 4Q": "Vincente 4° Quarto",
    "Spread 1Q": "Handicap 1° Quarto",
    "Spread 2Q": "Handicap 2° Quarto",
    "Spread 3Q": "Handicap 3° Quarto",
    "Spread 4Q": "Handicap 4° Quarto",
    "1X2 - 1Q": "1X2 1° Quarto",
    "Player Points Milestones": "Punti Giocatore - Oltre",
    "Player Rebounds Milestones": "Rimbalzi Giocatore - Oltre",
    "Player Threes Milestones": "Triple Giocatore - Oltre",
    "Player Assists Milestones": "Assist Giocatore - Oltre",
    "Player First Basket": "Primo Canestro",
    "Player First Assist": "Primo Assist",
    "Player First Rebound": "Primo Rimbalzo",
  },
  // 12 new sports populated by tasks 6-17.
};

export function resolveTitleOverride(
  sportSlug: string,
  marketType: string,
): string | null {
  const map = TITLE_OVERRIDES_BY_SPORT[sportSlug];
  return map?.[marketType] ?? null;
}
