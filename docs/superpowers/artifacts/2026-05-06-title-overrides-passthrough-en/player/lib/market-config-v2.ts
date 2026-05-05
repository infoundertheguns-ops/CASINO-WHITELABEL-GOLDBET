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
      "Q1": { markets: ["ML 1Q", "U/O - 1Q@picker", "Handicap - 1Q@picker", "Spread 1Q@picker"] },
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
      "Altri":    { markets: ["Double Double", "Player Props@over-under-flat"] },
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


// === Baseball ===
// Survey: 10 market_types in v_player_markets (sport_slug=baseball).
// Top: Handicap 7679 (Run Line), Run totali 6289 (Totals), 1X2 746, T/T 731,
// Alternative Run Line 476, GG/NG 277, P/D 217, DNB 181, Total Bases O/U 108,
// First Team To Score 102. No per-inning markets and no individual player props
// surfaced in the view, so Innings/Player tabs are intentionally omitted —
// uncategorized markets fall through to "Altri".
export const BASEBALL_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (2-way moneyline, no draw)
      "1X2",                          // 3-way when bookmakers expose draw
      "Run totali@picker",
      "Handicap@picker",              // Run Line
      "DNB",
      "GG/NG",
      "P/D",
    ],
  },
  "Run Line": {
    markets: [
      "Handicap@picker",
      "Alternative Run Line@picker",
    ],
  },
  "U/O": {
    markets: [
      "Run totali@picker",
      "Total Bases O/U@picker",
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized (incl. First Team To Score and any new types)
  },
};

export const BASEBALL_TAB_ORDER = ["Principali", "Run Line", "U/O", "Altri"];

export const BASEBALL_DEFAULT_SUB_PILL: Record<string, string> = {};


// === Esports ===
// Survey: 3 market_types in v_player_markets (sport_slug=esports).
// Handicap 1406 (Map Handicap), U/O 717 (Total Maps Over/Under), T/T 533 (Match Winner 2-way).
// No per-map markets, no player props surfaced. Mirrors legacy LIVE_DETAIL_TABS.eleague
// minimal 3-tab structure ["Principali", "Under/Over", "Altri"]. Registered for
// populated slugs only: esports (26890 events), honor-of-kings (16), rainbow-six (37).
// Other esports slugs (dota/csgo/valorant/lol/cod/e-basketball) have 0 events in legacy
// table — fall back to calcio default; can be added later if events appear.
export const ESPORTS_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (2-way match winner, no draw)
      "Handicap@picker",              // map handicap
      "U/O@picker",                   // total maps over/under
    ],
  },
  "Under/Over": {
    markets: ["U/O@picker"],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const ESPORTS_TAB_ORDER = ["Principali", "Under/Over", "Altri"];

export const ESPORTS_DEFAULT_SUB_PILL: Record<string, string> = {};


// === Handball ===
// Survey: 11 market_types in v_player_markets (sport_slug=handball, 322 events, 10028 rows).
// Handicap 4700, U/O 3989, 1X2 315, DC 276, T/T 245, P/D 119, DNB 118,
// Handicap - 1T 109, U/O - 1T 88, 3-Way Result HT 42, 1X2 - 1T 27.
// No 2T markets, no T/T 1T, no `1X2 Tempo Regolamentare`. Hero is plain 1X2 (3-way ball
// sport per mig 171/172). T/T (2-way) coexists when bookmakers expose DNB-style line.
// "3-Way Result HT" is the half-time 3-way variant — surfaced in Tempi sub-pill.
// Aliases: handball (events_v2 slug, 322), pallamano (legacy events.sport.slug, 3319).
export const HANDBALL_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "1X2",                          // hero (3-way)
      "T/T",                          // 2-way alt when present
      "U/O@picker",
      "Handicap@picker",
      "DC",
      "DNB",
      "P/D",
    ],
  },
  "U/O": {
    markets: ["U/O@picker"],
  },
  "Handicap": {
    markets: ["Handicap@picker"],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": {
        markets: [
          "1X2 - 1T",
          "3-Way Result HT",
          "U/O - 1T@picker",
          "Handicap - 1T@picker",
        ],
      },
    },
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const HANDBALL_TAB_ORDER = ["Principali", "U/O", "Handicap", "Tempi", "Altri"];

export const HANDBALL_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "1° Tempo",
};


// === Ice-Hockey ===
// Survey (sport_slug=ice-hockey, 6467 rows, 17 types, ~27 events with v2 data):
// Gol Tot. TR 2440, Handicap TR 2194, 3-Way 374, Handicap 283, T/T 174, 1X2 TR 159,
// DC TR 147, GG/NG 143, DNB 103, To Score 2+ Goals 94, Exact Total Goals 79,
// Player Points Milestones 76, Player Shots 66, Player Assists Milestones 57,
// To Score 3+ Goals 36, Marcatore 22, Player Props 20.
// Hero is `1X2 TR` (3-way regular time per mig 167-169). The `TR` suffix = Tempo
// Regolamentare (excludes overtime/shootout). T/T (2-way) coexists when bookmakers
// expose moneyline incl. OT. NO per-period market_types surfaced in the view —
// "Periodi" tab is reserved but auto-hides via empty-tab filter for now.
// Aliases: ice-hockey (events_v2 slug, 182 events; only this slug populated in
// v_player_markets) + hockey-ghiaccio (legacy events.sport.slug, 4894 events)
// registered defensively.
export const ICE_HOCKEY_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "1X2 TR",                       // hero (3-way regular time)
      "T/T",                          // 2-way alt (incl. OT)
      "Gol Tot. TR@picker",
      "Handicap TR@picker",
      "DNB",
      "GG/NG",
      "DC TR",
    ],
  },
  "Under/Over": {
    markets: [
      "Gol Tot. TR@picker",
      "Exact Total Goals",
    ],
  },
  "Periodi": {
    // No per-period market_types observed in v_player_markets for ice-hockey;
    // tab auto-hides via empty-tab filter. Slot reserved for forward-compat.
    markets: [],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const ICE_HOCKEY_TAB_ORDER = ["Principali", "Under/Over", "Periodi", "Altri"];

export const ICE_HOCKEY_DEFAULT_SUB_PILL: Record<string, string> = {};


// === Volleyball ===
// Survey (sport_slug=volleyball, 2990 rows, 7 types):
// U/O 1595, Handicap 1059, T/T 174, T/T 1° Set 137, T/T 2° Set 18, DC 6, DNB 1.
// Other slug candidates queried (volley, pallavolo) returned 0 rows — only
// `volleyball` is populated in v_player_markets, but legacy events.sport.slug
// uses `volley` (6570 events) so register both. `pallavolo` registered defensively
// for future-proofing (zero rows today).
// Hero is `T/T` (2-way match winner) — volley has no draw outcome and the
// memory caveat notes odds-api does NOT provide 3-Way Result for volleyball
// ("Esito Finale 1X2" source gap), so 1X2 is absent. Sport is set-based
// (best-of-5 indoor / best-of-3 beach); Handicap is on sets, U/O on points.
// Per-set markets exposed: T/T 1° Set, T/T 2° Set (others may surface as
// data accumulates — auto-hide via empty filter when missing).
export const VOLLEYBALL_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (2-way match winner)
      "T/T 1° Set",
      "U/O@picker",
      "Handicap@picker",
      "DC",
      "DNB",
    ],
  },
  "Set": {
    markets: [
      "T/T 1° Set",
      "T/T 2° Set",
      "T/T 3° Set",
      "T/T 4° Set",
      "T/T 5° Set",
    ],
  },
  "U/O Punti": {
    markets: [
      "U/O@picker",
    ],
  },
  "Handicap": {
    markets: [
      "Handicap@picker",
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const VOLLEYBALL_TAB_ORDER = ["Principali", "Set", "U/O Punti", "Handicap", "Altri"];

export const VOLLEYBALL_DEFAULT_SUB_PILL: Record<string, string> = {};


// === Darts ===
// Survey (sport_slug=darts, 1262 rows, 5 types):
// Handicap 420 (Set/Leg handicap), Alternative Spread 391, U/O 225 (Total Legs O/U),
// T/T 131 (Match Winner 2-way), Total Legs 95.
// Other slug candidates queried (freccette) returned 0 rows in v_player_markets,
// but legacy events.sport.slug uses `freccette` (1037 events) so register both
// defensively. Hero is `T/T` (2-way match winner — darts has no draw outcome).
// Mirrors legacy LIVE_DETAIL_TABS.darts 3-tab structure
// ["Principali", "Set/Leg", "Altri"]. The set/leg distinction is implicit
// in DB market_type names (Total Legs explicit; U/O is set-based). Per-set/per-leg
// markets (e.g. "Most 180s", "Highest Checkout") not yet surfaced in the view —
// "Set/Leg" tab auto-hides via empty filter when all member markets are missing.
export const DARTS_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (2-way match winner)
      "Handicap@picker",
      "U/O@picker",
      "DNB",
    ],
  },
  "Set/Leg": {
    markets: [
      "Total Legs@picker",
      "Alternative Spread@picker",
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const DARTS_TAB_ORDER = ["Principali", "Set/Leg", "Altri"];

export const DARTS_DEFAULT_SUB_PILL: Record<string, string> = {};


// === Rugby ===
// Survey (sport_slug=rugby, 4530 rows, 17 types):
// T/T Handicap 1566, U/O Incl. Supp. 1422, U/O - 1T 445, Handicap - 1T 436,
// Handicap 148, 1X2 109, 1st Half Team Total Points Away 64, 1X2 - 1T 57,
// 1st Half Team Total Points Home 54, 1st Half Team Total Tries Away 49,
// 1st Half Total Tries 49, 1st Half Team Total Tries Home 48, Total Tries 2-Way 31,
// First Team To Score 19, DNB 13, P/D 12, DC 8.
// Other slug candidates queried (rugby-union, rugby-league, rugby-sevens) returned
// 0 rows in v_player_markets and 0 events in events_v2 — registered defensively for
// forward-compat. Hero is `1X2` when bookmakers expose 3-way (109 rows present),
// else `T/T Handicap`. Mig 171 notes rugby ML stays 2-way per odds-api source, but
// 1X2 IS surfaced via classifier — page-v2 isHero handles both. NO Player Try Scorer
// markets surfaced in the view (no `Player First Try`, `Try Scorer`, `Marca Try`),
// so Player tab is intentionally omitted. The 1st-half try/point totals are the
// distinguishing rugby props — surfaced in Tempi sub-pill 1° Tempo.
export const RUGBY_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "1X2",                          // hero (3-way when present)
      "T/T Handicap",                 // 2-way moneyline (rugby standard)
      "U/O Incl. Supp.@picker",
      "Handicap@picker",
      "DC",
      "DNB",
      "GG/NG",
      "P/D",
    ],
  },
  "U/O Punti": {
    markets: [
      "U/O Incl. Supp.@picker",
      "Total Tries 2-Way",
    ],
  },
  "Handicap": {
    markets: [
      "Handicap@picker",
      "T/T Handicap",
    ],
  },
  "Tempi": {
    subPills: {
      "1° Tempo": {
        markets: [
          "1X2 - 1T",
          "U/O - 1T@picker",
          "Handicap - 1T@picker",
          "1st Half Total Tries",
          "1st Half Team Total Tries Home",
          "1st Half Team Total Tries Away",
          "1st Half Team Total Points Home",
          "1st Half Team Total Points Away",
        ],
      },
    },
  },
  "Altri": {
    markets: [],  // catch-all uncategorized (incl. First Team To Score)
  },
};

export const RUGBY_TAB_ORDER = ["Principali", "U/O Punti", "Handicap", "Tempi", "Altri"];

export const RUGBY_DEFAULT_SUB_PILL: Record<string, string> = {
  "Tempi": "1° Tempo",
};


// === Cricket ===
// Survey: 6 market_types in v_player_markets (sport_slug=cricket, 204 rows total).
// T/T 106 (2-way Match Winner — T20/ODI rarely draw, classifier maps Match Winner→T/T),
// To Win the Toss 37 (binary toss-winner side market), Total Match Runs 21 (total runs O/U,
// surfaced as fixed bands not @picker since few rows), U/O 20 (generic O/U fallback),
// Player of the Match 13 (single award market — rendered as compact list, no per-player
// over/under), DNB 7. NO per-innings markets, NO Top Batsman/Bowler/Highest Opening
// Partnership in this view, so the Player tab is intentionally OMITTED. Hero is `T/T`
// (2-way match winner). 3-tab structure: Principali / U/O Runs / Altri. Single alias
// (`cricket`) — events_v2.sport_slug and legacy events.sport.slug both use this slug.
export const CRICKET_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (2-way match winner, no draw in T20/ODI)
      "Total Match Runs@picker",
      "U/O@picker",
      "To Win the Toss",
      "Player of the Match",
      "DNB",
    ],
  },
  "U/O Runs": {
    markets: [
      "Total Match Runs@picker",
      "U/O@picker",
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const CRICKET_TAB_ORDER = ["Principali", "U/O Runs", "Altri"];

export const CRICKET_DEFAULT_SUB_PILL: Record<string, string> = {};


// === Boxing ===
// Survey: 1 market_type in v_player_markets (sport_slug=boxing, 54 rows total).
// T/T 54 only — Method of Victory / Total Rounds / Round Betting / Will the Fight
// Go the Distance NOT exposed in v_player_markets (odds-api maps these to other
// classifier outputs, none currently surface). Slugs `boxe` (307 events legacy)
// and `pugilato` (defensive register, 0 rows) both empty in v2 view today, but
// registered for forward-compat. Hero is `T/T` (2-way fight winner). Minimal
// 2-tab structure mirrors legacy `LIVE_DETAIL_TABS.boxing = ["Principali",
// "Altri"]`. Title overrides cover the surveyed type plus 5 forward-compat
// boxing-specific markets if classifier later surfaces them.
export const BOXING_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (2-way fight winner)
      "Method of Victory",            // forward-compat (KO/TKO/Decision)
      "Total Rounds@picker",          // forward-compat
      "Round Betting@picker",         // forward-compat
      "Will the Fight Go the Distance",
      "DNB",                          // forward-compat
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const BOXING_TAB_ORDER = ["Principali", "Altri"];

export const BOXING_DEFAULT_SUB_PILL: Record<string, string> = {};


// === MMA / Arti Marziali ===
// Survey: 4 market_types in v_player_markets (sport_slug=mma, 136 rows total).
// T/T 49, Total Rounds 50, U/O 23, Handicap 14. Slugs `arti-marziali` (508
// events legacy, 0 in v2 today) and `martial-arts` (0 rows, defensive register)
// both empty in v2 view, but registered for forward-compat. Hero is `T/T`
// (2-way fight winner). Minimal 2-tab structure mirrors legacy
// `LIVE_DETAIL_TABS.mma = ["Principali", "Altri"]`. Method of Victory /
// Round Betting / Will the Fight Go the Distance / DNB included for forward-compat.
export const MMA_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                          // hero (2-way fight winner)
      "Method of Victory",            // forward-compat (KO/Submission/Decision)
      "Total Rounds@picker",          // surveyed (50 rows)
      "U/O@picker",                   // surveyed (23 rows) — total rounds O/U
      "Handicap@picker",              // surveyed (14 rows) — round handicap
      "Round Betting@picker",         // forward-compat
      "Will the Fight Go the Distance",
      "DNB",                          // forward-compat
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const MMA_TAB_ORDER = ["Principali", "Altri"];

export const MMA_DEFAULT_SUB_PILL: Record<string, string> = {};


// === American Football / Football Americano ===
// Survey: 8 market_types in v_player_markets (sport_slug=american-football,
// 721 rows total across 8 events; sport_slug=football-americano 0 rows).
//   Handicap 497 (Spread), U/O 167 (Total Points), U/O - 1T 37, T/T 8 (hero),
//   1X2 - 1T 4, ML 1Q 4, Handicap - 1T 2, Touchdown Scorers 2 (player prop seed).
// Tier C low-volume: skeleton 4-tab structure with forward-compat per-quarter
// markets. Hero is `T/T` (2-way moneyline winner). Spread@picker dominates so
// gets dedicated tab. Per-quarter markets (ML 1Q surveyed; ML 2Q/3Q/4Q,
// Spread 1Q-4Q, U/O 1Q-4Q forward-compat) grouped under "Quarti". Player props
// (Touchdown Scorers surveyed; Passing Yards / Rushing Yards / Receiving Yards
// forward-compat) grouped under "Player". Empty tabs auto-hide.
export const AMERICAN_FOOTBALL_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                       // hero (2-way ML winner) — surveyed 8
      "Handicap@picker",           // surveyed 497 (Spread)
      "U/O@picker",                // surveyed 167 (Total Points)
      "1X2 - 1T",                  // surveyed 4 (1H 3-way w/ tie)
      "U/O - 1T@picker",           // surveyed 37 (1H Total)
      "Handicap - 1T@picker",      // surveyed 2 (1H Spread)
      "GG/NG",                     // forward-compat
      "DNB",                       // forward-compat
    ],
  },
  "Quarti": {
    markets: [
      "ML 1Q",                     // surveyed 4
      "ML 2Q",                     // forward-compat
      "ML 3Q",                     // forward-compat
      "ML 4Q",                     // forward-compat
      "Handicap 1Q@picker",        // forward-compat
      "Handicap 2Q@picker",        // forward-compat
      "Handicap 3Q@picker",        // forward-compat
      "Handicap 4Q@picker",        // forward-compat
      "U/O 1Q@picker",             // forward-compat
      "U/O 2Q@picker",             // forward-compat
      "U/O 3Q@picker",             // forward-compat
      "U/O 4Q@picker",             // forward-compat
    ],
  },
  "Player": {
    markets: [
      "Touchdown Scorers",         // surveyed 2 (player prop seed)
      "Passing Yards@picker",      // forward-compat
      "Rushing Yards@picker",      // forward-compat
      "Receiving Yards@picker",    // forward-compat
      "TD Scorer",                 // forward-compat (singular variant)
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const AMERICAN_FOOTBALL_TAB_ORDER = ["Principali", "Quarti", "Player", "Altri"];

export const AMERICAN_FOOTBALL_DEFAULT_SUB_PILL: Record<string, string> = {};


// === Snooker ===
// Survey: 1 market_type in v_player_markets (sport_slug=snooker, 3 rows total
// across 3 events — Tier C very low volume).
//   T/T 3 (hero, 2-way match winner — "Vincente Match").
// Skeleton 3-tab structure with forward-compat frame markets. Hero is `T/T`
// (2-way: only 2 players, no draw possible). Frame Handicap (Handicap@picker)
// + Frame Total (U/O@picker) forward-compat for whenever bookmakers expose
// them. "Highest Break" + "DNB" forward-compat. Empty tabs auto-hide so users
// see only "Principali" with the live T/T market until Phase 4 dummy
// seeds widen coverage.
export const SNOOKER_TAB_MARKETS_V2: SportTabConfig = {
  "Principali": {
    markets: [
      "T/T",                       // hero (2-way match winner) — surveyed 3
      "Handicap@picker",           // forward-compat (Frame Handicap)
      "U/O@picker",                // forward-compat (Total Frames)
      "Highest Break",             // forward-compat
      "DNB",                       // forward-compat (rarely applicable, kept for symmetry)
    ],
  },
  "U/O Frame": {
    markets: [
      "U/O@picker",                // forward-compat (dedicated tab for frame totals once populated)
    ],
  },
  "Altri": {
    markets: [],  // catch-all uncategorized
  },
};

export const SNOOKER_TAB_ORDER = ["Principali", "U/O Frame", "Altri"];

export const SNOOKER_DEFAULT_SUB_PILL: Record<string, string> = {};


// Per-sport lookup maps. Defaults fall back to calcio so an unconfigured sport_slug
// still renders something (the availableTabs filter then strips empty tabs, leaving
// at most Altri with all markets visible).
export const TAB_MARKETS_BY_SPORT: Record<string, SportTabConfig> = {
  calcio: FOOTBALL_TAB_MARKETS_V2,
  tennis: TENNIS_TAB_MARKETS_V2,
  basket: BASKET_TAB_MARKETS_V2,
  baseball: BASEBALL_TAB_MARKETS_V2,
  esports: ESPORTS_TAB_MARKETS_V2,
  "honor-of-kings": ESPORTS_TAB_MARKETS_V2,
  "rainbow-six": ESPORTS_TAB_MARKETS_V2,
  handball: HANDBALL_TAB_MARKETS_V2,
  pallamano: HANDBALL_TAB_MARKETS_V2,
  "ice-hockey": ICE_HOCKEY_TAB_MARKETS_V2,
  "hockey-ghiaccio": ICE_HOCKEY_TAB_MARKETS_V2,
  volleyball: VOLLEYBALL_TAB_MARKETS_V2,
  volley: VOLLEYBALL_TAB_MARKETS_V2,
  pallavolo: VOLLEYBALL_TAB_MARKETS_V2,
  darts: DARTS_TAB_MARKETS_V2,
  freccette: DARTS_TAB_MARKETS_V2,
  rugby: RUGBY_TAB_MARKETS_V2,
  "rugby-union": RUGBY_TAB_MARKETS_V2,
  "rugby-league": RUGBY_TAB_MARKETS_V2,
  "rugby-sevens": RUGBY_TAB_MARKETS_V2,
  cricket: CRICKET_TAB_MARKETS_V2,
  boxing: BOXING_TAB_MARKETS_V2,
  boxe: BOXING_TAB_MARKETS_V2,
  pugilato: BOXING_TAB_MARKETS_V2,
  mma: MMA_TAB_MARKETS_V2,
  "arti-marziali": MMA_TAB_MARKETS_V2,
  "martial-arts": MMA_TAB_MARKETS_V2,
  "american-football": AMERICAN_FOOTBALL_TAB_MARKETS_V2,
  "football-americano": AMERICAN_FOOTBALL_TAB_MARKETS_V2,
  snooker: SNOOKER_TAB_MARKETS_V2,
};

export const TAB_ORDER_BY_SPORT: Record<string, string[]> = {
  calcio: FOOTBALL_TAB_ORDER,
  tennis: TENNIS_TAB_ORDER,
  basket: BASKET_TAB_ORDER,
  baseball: BASEBALL_TAB_ORDER,
  esports: ESPORTS_TAB_ORDER,
  "honor-of-kings": ESPORTS_TAB_ORDER,
  "rainbow-six": ESPORTS_TAB_ORDER,
  handball: HANDBALL_TAB_ORDER,
  pallamano: HANDBALL_TAB_ORDER,
  "ice-hockey": ICE_HOCKEY_TAB_ORDER,
  "hockey-ghiaccio": ICE_HOCKEY_TAB_ORDER,
  volleyball: VOLLEYBALL_TAB_ORDER,
  volley: VOLLEYBALL_TAB_ORDER,
  pallavolo: VOLLEYBALL_TAB_ORDER,
  darts: DARTS_TAB_ORDER,
  freccette: DARTS_TAB_ORDER,
  rugby: RUGBY_TAB_ORDER,
  "rugby-union": RUGBY_TAB_ORDER,
  "rugby-league": RUGBY_TAB_ORDER,
  "rugby-sevens": RUGBY_TAB_ORDER,
  cricket: CRICKET_TAB_ORDER,
  boxing: BOXING_TAB_ORDER,
  boxe: BOXING_TAB_ORDER,
  pugilato: BOXING_TAB_ORDER,
  mma: MMA_TAB_ORDER,
  "arti-marziali": MMA_TAB_ORDER,
  "martial-arts": MMA_TAB_ORDER,
  "american-football": AMERICAN_FOOTBALL_TAB_ORDER,
  "football-americano": AMERICAN_FOOTBALL_TAB_ORDER,
  snooker: SNOOKER_TAB_ORDER,
};

export const DEFAULT_SUB_PILL_BY_SPORT: Record<string, Record<string, string>> = {
  calcio: FOOTBALL_DEFAULT_SUB_PILL,
  tennis: TENNIS_DEFAULT_SUB_PILL,
  basket: BASKET_DEFAULT_SUB_PILL,
  baseball: BASEBALL_DEFAULT_SUB_PILL,
  esports: ESPORTS_DEFAULT_SUB_PILL,
  "honor-of-kings": ESPORTS_DEFAULT_SUB_PILL,
  "rainbow-six": ESPORTS_DEFAULT_SUB_PILL,
  handball: HANDBALL_DEFAULT_SUB_PILL,
  pallamano: HANDBALL_DEFAULT_SUB_PILL,
  "ice-hockey": ICE_HOCKEY_DEFAULT_SUB_PILL,
  "hockey-ghiaccio": ICE_HOCKEY_DEFAULT_SUB_PILL,
  volleyball: VOLLEYBALL_DEFAULT_SUB_PILL,
  volley: VOLLEYBALL_DEFAULT_SUB_PILL,
  pallavolo: VOLLEYBALL_DEFAULT_SUB_PILL,
  darts: DARTS_DEFAULT_SUB_PILL,
  freccette: DARTS_DEFAULT_SUB_PILL,
  rugby: RUGBY_DEFAULT_SUB_PILL,
  "rugby-union": RUGBY_DEFAULT_SUB_PILL,
  "rugby-league": RUGBY_DEFAULT_SUB_PILL,
  "rugby-sevens": RUGBY_DEFAULT_SUB_PILL,
  cricket: CRICKET_DEFAULT_SUB_PILL,
  boxing: BOXING_DEFAULT_SUB_PILL,
  boxe: BOXING_DEFAULT_SUB_PILL,
  pugilato: BOXING_DEFAULT_SUB_PILL,
  mma: MMA_DEFAULT_SUB_PILL,
  "arti-marziali": MMA_DEFAULT_SUB_PILL,
  "martial-arts": MMA_DEFAULT_SUB_PILL,
  "american-football": AMERICAN_FOOTBALL_DEFAULT_SUB_PILL,
  "football-americano": AMERICAN_FOOTBALL_DEFAULT_SUB_PILL,
  snooker: SNOOKER_DEFAULT_SUB_PILL,
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
  calcio: {
    // Calcio passthrough EN — tradotti SOLO la label visibile (market_type DB resta inglese
    // per match con FOOTBALL_TAB_MARKETS_V2). Coverage ~96% del volume passthrough calcio.
    // === Goals / Result ===
    "First Team To Score":          "Prima Squadra a Segnare",
    "Both Teams To Score HT":       "Entrambe Segnano 1° Tempo",
    "Exact Total Goals":            "Numero Esatto Gol",
    "Number of Goals In Match":     "Numero Gol nel Match",
    "Alternative Total Goals":      "Totale Gol (alt.)",
    "To Score 2+ Goals":            "Segnare 2+ Gol",
    "To Score 3+ Goals":            "Segnare 3+ Gol",
    "1st Half Goal Line":           "Linea Gol 1° Tempo",
    // === Handicap ===
    "Alternative Asian Handicap":   "Handicap Asiatico (alt.)",
    // === Corners ===
    "Total Corners":                "Totale Calci d'Angolo",
    "Alternative Corners":          "Calci d'Angolo (alt.)",
    "Corner Handicap":              "Handicap Calci d'Angolo",
    "Corners Race":                 "Race Calci d'Angolo",
    "Team Corners Home":            "Calci d'Angolo Casa",
    "Team Corners Away":            "Calci d'Angolo Trasferta",
    // === Cards / Bookings ===
    "Bookings Totals":              "Totale Cartellini",
    "Bookings Totals Home":         "Totale Cartellini Casa",
    "Bookings Totals Away":         "Totale Cartellini Trasferta",
    "Bookings Spread":              "Handicap Cartellini",
    // === Shots ===
    "Total Shots on Target":        "Totale Tiri in Porta",
    "Total Shots on Target Home":   "Totale Tiri in Porta Casa",
    "Total Shots on Target Away":   "Totale Tiri in Porta Trasferta",
    "Total Shots":                  "Totale Tiri",
    "Total Shots Home":             "Totale Tiri Casa",
    "Total Shots Away":             "Totale Tiri Trasferta",
    "Most Shots on Target":         "Squadra con Più Tiri in Porta",
    "Total Offsides":               "Totale Fuorigioco",
    // === Player props ===
    "Goalkeeper Saves":             "Parate Portiere",
    "Goalkeeper Saves Home":        "Parate Portiere Casa",
    "Goalkeeper Saves Away":        "Parate Portiere Trasferta",
    "Player Shots":                 "Tiri Giocatore",
    "Player Shots on Target":       "Tiri in Porta Giocatore",
    "Player Shots on Target Outside Box": "Tiri in Porta da Fuori Area",
    "Player Headed Shots on Target": "Tiri di Testa in Porta",
    "Player To Score or Assist":    "Marca o Assist",
    "Player To Assist":             "Fornisce Assist",
    "Team Goalscorer":              "Marcatore di Squadra",
    "Multi Scorers":                "Marcatori Multipli",
    // === Cards / Tackles / Fouls (player + team) ===
    "Card Handicap":                "Handicap Cartellini",
    "Number of Cards In Match":     "Numero Cartellini nel Match",
    "Team Cards Home":              "Cartellini Casa",
    "Team Cards Away":              "Cartellini Trasferta",
    "Player Cards":                 "Cartellini Giocatore",
    "Player to be Booked":          "Giocatore Ammonito",
    "Player Tackles":               "Contrasti Giocatore",
    "Match Tackles":                "Totale Contrasti Match",
    "Team Tackles Home":            "Contrasti Casa",
    "Team Tackles Away":            "Contrasti Trasferta",
    "Total Fouls":                  "Totale Falli",
    "Total Fouls Home":             "Totale Falli Casa",
    "Total Fouls Away":             "Totale Falli Trasferta",
    "Player Fouls":                 "Falli Giocatore",
    "Player Fouls Committed":       "Falli Commessi (Giocatore)",
    "Player To Be Fouled":          "Falli Subiti (Giocatore)",
    // === Shots (team / match level) ===
    "Match Shots":                  "Totale Tiri Match",
    "Match Shots on Target":        "Totale Tiri in Porta Match",
    "Team Shots Home":              "Tiri Casa",
    "Team Shots Away":              "Tiri Trasferta",
    "Team Shots on Target Home":    "Tiri in Porta Casa",
    "Team Shots on Target Away":    "Tiri in Porta Trasferta",
    "Player Passes":                "Passaggi Giocatore",
    // === Offsides ===
    "Match Offsides":               "Totale Fuorigioco Match",
    "Team Offsides Home":           "Fuorigioco Casa",
    "Team Offsides Away":           "Fuorigioco Trasferta",
  },
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
    "1X2 - 1Q": "Vincente 1° Quarto",
    "Player Points Milestones": "Punti Giocatore - Oltre",
    "Player Rebounds Milestones": "Rimbalzi Giocatore - Oltre",
    "Player Threes Milestones": "Triple Giocatore - Oltre",
    "Player Assists Milestones": "Assist Giocatore - Oltre",
    "Player First Basket": "Primo Canestro",
    "Player First Assist": "Primo Assist",
    "Player First Rebound": "Primo Rimbalzo",
    // === Aggiunte audit 2026-05-06 — gap residui ===
    "Alternative Spread":           "Handicap Alternativo",
    "Alternative Totals":           "Totale Punti (alt.)",
    "3-Way Result HT":              "1X2 1° Tempo",
    "Player Props":                 "Mercati Giocatore",
    "Points O/U":                   "Totale Punti Giocatore",
    "Assists O/U":                  "Totale Assist Giocatore",
    "Rebounds O/U":                 "Totale Rimbalzi Giocatore",
    "Threes Made O/U":              "Totale Triple Giocatore",
    "Field Goals Made O/U":         "Totale Tiri da Campo",
    "Steals O/U":                   "Totale Rubate Giocatore",
    "Blocks O/U":                   "Totale Stoppate Giocatore",
    "Triple Double":                "Tripla Doppia",
    "Double Double":                "Doppia Doppia",
    "Points & Assists O/U":         "Totale Punti+Assist",
    "Points & Rebounds O/U":        "Totale Punti+Rimbalzi",
    "Points, Assists & Rebounds O/U": "Totale Punti+Assist+Rimbalzi",
    "Steals & Blocks O/U":          "Totale Rubate+Stoppate",
    "Assists & Rebounds O/U":       "Totale Assist+Rimbalzi",
  },
  baseball: {
    // Italian-friendly labels for ugly DB market_types. Markets already in
    // Italian (Handicap, Run totali, GG/NG, P/D) are intentionally untouched.
    "T/T": "Vincente Match",
    "Handicap": "Run Line",
    "Alternative Run Line": "Run Line Alternative",
    "Total Bases O/U": "Totale Basi (Under/Over)",
    "First Team To Score": "Prima Squadra a Segnare",
    "DNB": "Draw No Bet",
    // === Aggiunte audit 2026-05-06 — gap residui ===
    "First 5 Innings Totals":       "Totale Run Primi 5 Inning",
    "First 5 Innings ML":           "Vincente Primi 5 Inning",
    "Player Props":                 "Mercati Giocatore",
    "Stolen Bases O/U":             "Totale Basi Rubate",
    "Pitcher Walks Issued O/U":     "Totale Walks Concessi (Pitcher)",
    "Batter Walks O/U":             "Totale Walks (Battitore)",
    "Total Hits, Runs and RBIs O/U": "Totale Hits+Run+RBI",
    "Doubles O/U":                  "Totale Doppi",
    "Runs O/U":                     "Totale Run Giocatore",
    "Pitcher Strikeouts O/U":       "Totale Strikeout (Pitcher)",
    "Hits O/U":                     "Totale Hits Giocatore",
    "Home Runs O/U":                "Totale Fuoricampo",
    "Runs Batted In O/U":           "Totale RBI",
    "Pitcher Hits Allowed O/U":     "Totale Hits Concessi (Pitcher)",
    "Batter Strikeouts O/U":        "Totale Strikeout (Battitore)",
    "Triples O/U":                  "Totale Tripli",
    "Singles O/U":                  "Totale Singoli",
    "Pitcher Outs O/U":             "Totale Out (Pitcher)",
  },
  esports: {
    // Esports survey: 3 market types only (T/T, Handicap, U/O).
    // T/T → 2-way match winner; Handicap → map handicap; U/O → total maps over/under.
    "T/T": "Vincente Match",
    "Handicap": "Handicap Mappe",
    "U/O": "Totale Mappe",
  },
  "honor-of-kings": {
    "T/T": "Vincente Match",
    "Handicap": "Handicap Mappe",
    "U/O": "Totale Mappe",
  },
  "rainbow-six": {
    "T/T": "Vincente Match",
    "Handicap": "Handicap Mappe",
    "U/O": "Totale Mappe",
  },
  handball: {
    // Handball: most market_types are already IT (Handicap, U/O, DC, GG/NG, P/D, DNB).
    // Override only the ugly anglosaxon ones.
    "T/T": "Vincente Match",
    "DNB": "Draw No Bet",
    "3-Way Result HT": "1X2 1° Tempo",  // alt half-time 3-way (mig 171/172 variant)
  },
  pallamano: {
    "T/T": "Vincente Match",
    "DNB": "Draw No Bet",
    "3-Way Result HT": "1X2 1° Tempo",
  },
  "ice-hockey": {
    // Ice-hockey: most market_types use the `TR` (Tempo Regolamentare) suffix
    // marking regular-time variants. Override anglosaxon labels + clarify TR.
    "1X2 TR": "Vincente Tempi Regolamentari",
    "T/T": "Vincente Match (incl. OT)",
    "Gol Tot. TR": "Totale Gol (Tempi Reg.)",
    "Handicap TR": "Handicap (Tempi Reg.)",
    "DC TR": "Doppia Chance (Tempi Reg.)",
    "DNB": "Draw No Bet",
    "3-Way": "1X2 (3-Way)",
    "Exact Total Goals": "Numero Esatto Gol",
    // === Aggiunte audit 2026-05-06 — gap residui ===
    "To Score 2+ Goals":            "Segnare 2+ Gol",
    "To Score 3+ Goals":            "Segnare 3+ Gol",
    "Player Shots":                 "Tiri Giocatore",
    "Points":                       "Punti Totali (Gol+Assist)",
    "Points O/U":                   "Totale Punti Giocatore",
    "Assists O/U":                  "Totale Assist Giocatore",
    "Power Play Points O/U":        "Totale Punti in Power Play",
    "Player Points Milestones":     "Punti Giocatore - Oltre",
    "Player Assists Milestones":    "Assist Giocatore - Oltre",
    "Shots on Goal O/U":            "Totale Tiri in Porta",
    "Player Props":                 "Mercati Giocatore",
  },
  "hockey-ghiaccio": {
    "1X2 TR": "Vincente Tempi Regolamentari",
    "T/T": "Vincente Match (incl. OT)",
    "Gol Tot. TR": "Totale Gol (Tempi Reg.)",
    "Handicap TR": "Handicap (Tempi Reg.)",
    "DC TR": "Doppia Chance (Tempi Reg.)",
    "DNB": "Draw No Bet",
    "3-Way": "1X2 (3-Way)",
    "Exact Total Goals": "Numero Esatto Gol",
    // === Aggiunte audit 2026-05-06 — gap residui ===
    "To Score 2+ Goals":            "Segnare 2+ Gol",
    "To Score 3+ Goals":            "Segnare 3+ Gol",
    "Player Shots":                 "Tiri Giocatore",
    "Points":                       "Punti Totali (Gol+Assist)",
    "Points O/U":                   "Totale Punti Giocatore",
    "Assists O/U":                  "Totale Assist Giocatore",
    "Power Play Points O/U":        "Totale Punti in Power Play",
    "Player Points Milestones":     "Punti Giocatore - Oltre",
    "Player Assists Milestones":    "Assist Giocatore - Oltre",
    "Shots on Goal O/U":            "Totale Tiri in Porta",
    "Player Props":                 "Mercati Giocatore",
  },
  volleyball: {
    // Volley is set-based, 2-way (no draw). Translate set + match labels +
    // clarify that Handicap is on sets and U/O on points.
    "T/T": "Vincente Match",
    "T/T 1° Set": "Vincente 1° Set",
    "T/T 2° Set": "Vincente 2° Set",
    "T/T 3° Set": "Vincente 3° Set",
    "T/T 4° Set": "Vincente 4° Set",
    "T/T 5° Set": "Vincente 5° Set",
    "U/O": "Totale Punti Match",
    "Handicap": "Handicap Set",
    "DNB": "Draw No Bet",
  },
  volley: {
    "T/T": "Vincente Match",
    "T/T 1° Set": "Vincente 1° Set",
    "T/T 2° Set": "Vincente 2° Set",
    "T/T 3° Set": "Vincente 3° Set",
    "T/T 4° Set": "Vincente 4° Set",
    "T/T 5° Set": "Vincente 5° Set",
    "U/O": "Totale Punti Match",
    "Handicap": "Handicap Set",
    "DNB": "Draw No Bet",
  },
  pallavolo: {
    "T/T": "Vincente Match",
    "T/T 1° Set": "Vincente 1° Set",
    "T/T 2° Set": "Vincente 2° Set",
    "T/T 3° Set": "Vincente 3° Set",
    "T/T 4° Set": "Vincente 4° Set",
    "T/T 5° Set": "Vincente 5° Set",
    "U/O": "Totale Punti Match",
    "Handicap": "Handicap Set",
    "DNB": "Draw No Bet",
  },
  darts: {
    // Darts: 5 market types (T/T, Handicap, Alternative Spread, U/O, Total Legs).
    // Most labels are anglosaxon — translate to IT-friendly equivalents. Handicap
    // and U/O are leg-based in darts (sets are matches of legs), Total Legs is the
    // explicit total-legs O/U variant.
    "T/T": "Vincente Match",
    "Handicap": "Handicap Leg",
    "Alternative Spread": "Handicap Leg Alternativo",
    "U/O": "Totale Leg",
    "Total Legs": "Totale Leg (Esatto)",
    "DNB": "Draw No Bet",
  },
  freccette: {
    "T/T": "Vincente Match",
    "Handicap": "Handicap Leg",
    "Alternative Spread": "Handicap Leg Alternativo",
    "U/O": "Totale Leg",
    "Total Legs": "Totale Leg (Esatto)",
    "DNB": "Draw No Bet",
  },
  rugby: {
    // Rugby: 17 market types from survey. Most use anglosaxon/internal labels —
    // translate to IT-friendly equivalents. `T/T Handicap` is the dominant 2-way
    // moneyline format in rugby (no draw); `U/O Incl. Supp.` is total points incl.
    // overtime; `Total Tries 2-Way` is the dedicated total-tries O/U. The 1st-half
    // try/point totals are rugby-specific props — clarify the home/away split.
    "T/T": "Vincente Match",
    "T/T Handicap": "Vincente con Handicap",
    "U/O Incl. Supp.": "Totale Punti (incl. OT)",
    "Total Tries 2-Way": "Totale Mete (Under/Over)",
    "1st Half Total Tries": "Totale Mete 1° Tempo",
    "1st Half Team Total Tries Home": "Totale Mete Casa 1° Tempo",
    "1st Half Team Total Tries Away": "Totale Mete Trasferta 1° Tempo",
    "1st Half Team Total Points Home": "Totale Punti Casa 1° Tempo",
    "1st Half Team Total Points Away": "Totale Punti Trasferta 1° Tempo",
    "First Team To Score": "Prima Squadra a Segnare",
    "DNB": "Draw No Bet",
    "Player First Try": "Primo Marcatore Try",
    "Player To Score": "Marcatore Try",
    "Try Scorer": "Marcatore Try",
  },
  "rugby-union": {
    "T/T": "Vincente Match",
    "T/T Handicap": "Vincente con Handicap",
    "U/O Incl. Supp.": "Totale Punti (incl. OT)",
    "Total Tries 2-Way": "Totale Mete (Under/Over)",
    "1st Half Total Tries": "Totale Mete 1° Tempo",
    "1st Half Team Total Tries Home": "Totale Mete Casa 1° Tempo",
    "1st Half Team Total Tries Away": "Totale Mete Trasferta 1° Tempo",
    "1st Half Team Total Points Home": "Totale Punti Casa 1° Tempo",
    "1st Half Team Total Points Away": "Totale Punti Trasferta 1° Tempo",
    "First Team To Score": "Prima Squadra a Segnare",
    "DNB": "Draw No Bet",
    "Player First Try": "Primo Marcatore Try",
    "Player To Score": "Marcatore Try",
    "Try Scorer": "Marcatore Try",
  },
  "rugby-league": {
    "T/T": "Vincente Match",
    "T/T Handicap": "Vincente con Handicap",
    "U/O Incl. Supp.": "Totale Punti (incl. OT)",
    "Total Tries 2-Way": "Totale Mete (Under/Over)",
    "1st Half Total Tries": "Totale Mete 1° Tempo",
    "1st Half Team Total Tries Home": "Totale Mete Casa 1° Tempo",
    "1st Half Team Total Tries Away": "Totale Mete Trasferta 1° Tempo",
    "1st Half Team Total Points Home": "Totale Punti Casa 1° Tempo",
    "1st Half Team Total Points Away": "Totale Punti Trasferta 1° Tempo",
    "First Team To Score": "Prima Squadra a Segnare",
    "DNB": "Draw No Bet",
    "Player First Try": "Primo Marcatore Try",
    "Player To Score": "Marcatore Try",
    "Try Scorer": "Marcatore Try",
  },
  "rugby-sevens": {
    "T/T": "Vincente Match",
    "T/T Handicap": "Vincente con Handicap",
    "U/O Incl. Supp.": "Totale Punti (incl. OT)",
    "Total Tries 2-Way": "Totale Mete (Under/Over)",
    "1st Half Total Tries": "Totale Mete 1° Tempo",
    "1st Half Team Total Tries Home": "Totale Mete Casa 1° Tempo",
    "1st Half Team Total Tries Away": "Totale Mete Trasferta 1° Tempo",
    "1st Half Team Total Points Home": "Totale Punti Casa 1° Tempo",
    "1st Half Team Total Points Away": "Totale Punti Trasferta 1° Tempo",
    "First Team To Score": "Prima Squadra a Segnare",
    "DNB": "Draw No Bet",
    "Player First Try": "Primo Marcatore Try",
    "Player To Score": "Marcatore Try",
    "Try Scorer": "Marcatore Try",
  },
  cricket: {
    // Cricket: 6 market types. T/T is 2-way Match Winner (T20/ODI rarely draw).
    // Total Match Runs is the canonical total-runs O/U; U/O is the generic O/U
    // fallback. To Win the Toss is the binary toss-winner side market. Player of
    // the Match is the single award market (compact list, no per-player O/U).
    // Top Batsman/Top Bowler/Highest Opening Partnership not surfaced in the view
    // — translations included for forward-compat if classifier later exposes them.
    "T/T": "Vincente Match",
    "Total Match Runs": "Totale Runs Match",
    "U/O": "Totale Runs",
    "To Win the Toss": "Vincitore Sorteggio",
    "Player of the Match": "Giocatore del Match",
    "DNB": "Draw No Bet",
    "Top Batsman": "Top Battitore",
    "Top Bowler": "Top Lanciatore",
    "Highest Opening Partnership": "Maggiore Partnership Iniziale",
  },
  boxing: {
    // Boxing: only T/T (54 rows) currently surfaced in v_player_markets. Other
    // boxing-specific markets (Method of Victory, Total Rounds, Round Betting,
    // Will the Fight Go the Distance) included for forward-compat once classifier
    // exposes them. Hero is `T/T` (2-way fight winner — no draw outcome typical
    // for pro boxing). DNB included defensively for rare draw-allowed bouts.
    "T/T": "Vincente Match",
    "Method of Victory": "Modo di Vittoria",
    "Total Rounds": "Totale Round",
    "Round Betting": "Round di Conclusione",
    "DNB": "Draw No Bet",
    "Will the Fight Go the Distance": "Il Match Va Alla Distanza",
  },
  boxe: {
    "T/T": "Vincente Match",
    "Method of Victory": "Modo di Vittoria",
    "Total Rounds": "Totale Round",
    "Round Betting": "Round di Conclusione",
    "DNB": "Draw No Bet",
    "Will the Fight Go the Distance": "Il Match Va Alla Distanza",
  },
  pugilato: {
    "T/T": "Vincente Match",
    "Method of Victory": "Modo di Vittoria",
    "Total Rounds": "Totale Round",
    "Round Betting": "Round di Conclusione",
    "DNB": "Draw No Bet",
    "Will the Fight Go the Distance": "Il Match Va Alla Distanza",
  },
  mma: {
    // MMA: 4 market types surveyed (T/T 49, Total Rounds 50, U/O 23, Handicap 14).
    // T/T is the 2-way fight winner. U/O in MMA context is total rounds O/U.
    // Handicap is round-handicap (rare). Method of Victory / Round Betting / Will
    // the Fight Go the Distance / DNB included for forward-compat once classifier
    // exposes them.
    "T/T": "Vincente Match",
    "Method of Victory": "Modo di Vittoria",
    "Total Rounds": "Totale Round",
    "U/O": "Totale Round (Under/Over)",
    "Handicap": "Handicap Round",
    "Round Betting": "Round di Conclusione",
    "DNB": "Draw No Bet",
    "Will the Fight Go the Distance": "Il Match Va Alla Distanza",
  },
  "arti-marziali": {
    "T/T": "Vincente Match",
    "Method of Victory": "Modo di Vittoria",
    "Total Rounds": "Totale Round",
    "U/O": "Totale Round (Under/Over)",
    "Handicap": "Handicap Round",
    "Round Betting": "Round di Conclusione",
    "DNB": "Draw No Bet",
    "Will the Fight Go the Distance": "Il Match Va Alla Distanza",
  },
  "martial-arts": {
    "T/T": "Vincente Match",
    "Method of Victory": "Modo di Vittoria",
    "Total Rounds": "Totale Round",
    "U/O": "Totale Round (Under/Over)",
    "Handicap": "Handicap Round",
    "Round Betting": "Round di Conclusione",
    "DNB": "Draw No Bet",
    "Will the Fight Go the Distance": "Il Match Va Alla Distanza",
  },
  "american-football": {
    // American Football: 8 market types surveyed (Handicap 497, U/O 167,
    // U/O - 1T 37, T/T 8, 1X2 - 1T 4, ML 1Q 4, Handicap - 1T 2,
    // Touchdown Scorers 2). T/T is 2-way ML winner. Handicap is Spread (Punti).
    // U/O is Total Points. Per-quarter ML 1Q-4Q + Spread/U-O 1Q-4Q forward-compat.
    // Player props (yards / TD scorer) forward-compat.
    "T/T": "Vincente Match",
    "Handicap": "Handicap (Punti)",
    "U/O": "Totale Punti",
    "1X2 - 1T": "1X2 1° Tempo",
    "U/O - 1T": "Totale Punti 1° Tempo",
    "Handicap - 1T": "Handicap (Punti) 1° Tempo",
    "ML 1Q": "Vincente 1° Quarto",
    "ML 2Q": "Vincente 2° Quarto",
    "ML 3Q": "Vincente 3° Quarto",
    "ML 4Q": "Vincente 4° Quarto",
    "Handicap 1Q": "Handicap 1° Quarto",
    "Handicap 2Q": "Handicap 2° Quarto",
    "Handicap 3Q": "Handicap 3° Quarto",
    "Handicap 4Q": "Handicap 4° Quarto",
    "U/O 1Q": "Totale Punti 1° Quarto",
    "U/O 2Q": "Totale Punti 2° Quarto",
    "U/O 3Q": "Totale Punti 3° Quarto",
    "U/O 4Q": "Totale Punti 4° Quarto",
    "Touchdown Scorers": "Marcatori Touchdown",
    "TD Scorer": "Marcatore Touchdown",
    "Passing Yards": "Yard Lanciate",
    "Rushing Yards": "Yard di Corsa",
    "Receiving Yards": "Yard di Ricezione",
    "GG/NG": "Entrambe Segnano",
    "DNB": "Draw No Bet",
  },
  "football-americano": {
    "T/T": "Vincente Match",
    "Handicap": "Handicap (Punti)",
    "U/O": "Totale Punti",
    "1X2 - 1T": "1X2 1° Tempo",
    "U/O - 1T": "Totale Punti 1° Tempo",
    "Handicap - 1T": "Handicap (Punti) 1° Tempo",
    "ML 1Q": "Vincente 1° Quarto",
    "ML 2Q": "Vincente 2° Quarto",
    "ML 3Q": "Vincente 3° Quarto",
    "ML 4Q": "Vincente 4° Quarto",
    "Handicap 1Q": "Handicap 1° Quarto",
    "Handicap 2Q": "Handicap 2° Quarto",
    "Handicap 3Q": "Handicap 3° Quarto",
    "Handicap 4Q": "Handicap 4° Quarto",
    "U/O 1Q": "Totale Punti 1° Quarto",
    "U/O 2Q": "Totale Punti 2° Quarto",
    "U/O 3Q": "Totale Punti 3° Quarto",
    "U/O 4Q": "Totale Punti 4° Quarto",
    "Touchdown Scorers": "Marcatori Touchdown",
    "TD Scorer": "Marcatore Touchdown",
    "Passing Yards": "Yard Lanciate",
    "Rushing Yards": "Yard di Corsa",
    "Receiving Yards": "Yard di Ricezione",
    "GG/NG": "Entrambe Segnano",
    "DNB": "Draw No Bet",
  },
  snooker: {
    // Snooker: 1 market type surveyed (T/T 3 — 2-way match winner). Tier C
    // very low volume, frame-based markets (Frame Handicap, Total Frames,
    // Highest Break) forward-compat for Phase 4 dummy-data seed expansion.
    "T/T": "Vincente Match",
    "Handicap": "Handicap Frame",
    "U/O": "Totale Frame",
    "Highest Break": "Break più Alto",
    "DNB": "Draw No Bet",
  },
  tennis: {
    // Tennis: T/T Match (Escl. Ritiro), Totale set, U/O - 1° Set, ecc. già tradotti via DB
    // (mig 165 / 171). Resta passthrough EN solo:
    "Set Betting":                  "Vincente per Set (Esatto)",
    "Totals 1st Set":               "Totale Game 1° Set",
  },
  // 12 new sports populated (tasks 6-17 complete) — Phase 2 done.
};

export function resolveTitleOverride(
  sportSlug: string,
  marketType: string,
): string | null {
  const map = TITLE_OVERRIDES_BY_SPORT[sportSlug];
  return map?.[marketType] ?? null;
}

// === Excluded market types per-sport ===
// Markets in this set are filtered out BEFORE categorization — they will not appear
// in any tab (not even Altri). Use for upstream-translation duplicates that cannot
// be cleanly fixed at the SQL layer (e.g. basket Bet365 ML Q1 mistranslated to
// '1X2 - 1Q' which duplicates ML 1Q from other bookmakers with same outcomes).
export const EXCLUDE_MARKETS_BY_SPORT: Record<string, Set<string>> = {
  basket: new Set(["1X2 - 1Q"]),
};
