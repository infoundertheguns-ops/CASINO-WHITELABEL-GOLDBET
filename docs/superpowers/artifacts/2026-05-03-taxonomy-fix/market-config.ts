import type { MarketColumnConfig } from "./types";

// Pre-match list view market columns per sport template
// groupName = Kambi market_type name (used for direct matching)
export const MARKET_COLUMNS: Record<string, MarketColumnConfig[]> = {
  "1x2": [
    { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
    { groupName: "DC", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
    { groupName: "U/O", columns: [{ key: "under", label: "UNDER" }, { key: "_line", label: "" }, { key: "over", label: "OVER" }] },
    { groupName: "GG/NG", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
  ],
  "testa-a-testa": [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  ],
  "set-score": [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Risultato Esatto", columns: [
      { key: "3-0", label: "3-0" }, { key: "3-1", label: "3-1" }, { key: "3-2", label: "3-2" },
      { key: "0-3", label: "0-3" }, { key: "1-3", label: "1-3" }, { key: "2-3", label: "2-3" },
    ]},
    { groupName: "Totale set", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  "outright": [],
  "racing": [],
  "keno": [],
};

// Tennis prematch columns — "Più giochi" removed (0 coverage on 22bet,
// ~25 markets total on Kambi). 22bet uses `u_o_ft` for "Totale giochi"
// (raw: "U/O 16.5"), dispatched via canonical_key fallback.
export const TENNIS_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T Match (Escl. Ritiro)", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "Totale set", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  { groupName: "Totale giochi", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
];

// Basketball prematch columns — basket has BOTH T/T (ML, OT inclusive) and 1X2 Tempo Regolamentare (3-Way Result, regulation only).
export const BASKETBALL_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "1X2 Tempo Regolamentare", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
  { groupName: "U/O Incl. Supp.", columns: [{ key: "under", label: "UNDER" }, { key: "_line", label: "" }, { key: "over", label: "OVER" }] },
  { groupName: "T/T Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
];

// Ice hockey prematch columns — 4 cols with abbreviated "TR" labels
// so all fit without squeezing the event-name section. Full verbose
// Kambi naming (e.g. "Esito Finale 1x2 - Tempo regolamentare") is
// preserved in GROUP_TO_MARKET_PATTERN / GROUP_TO_CANONICAL so the
// short groupName still dispatches canonically.
// Hockey columns — T/T from ML (mig 171), 1X2 TR from 3-Way Result (mig 168).
export const HOCKEY_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "1X2 TR", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
  { groupName: "DC TR", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
  { groupName: "Handicap TR", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
  { groupName: "Gol Tot. TR", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
];

// Rugby prematch columns — rugby ML is 3-way (1X2) per mig 171.
export const RUGBY_COLUMNS: MarketColumnConfig[] = [
  { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
  { groupName: "T/T Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
  { groupName: "U/O Incl. Supp.", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
];

// Handball prematch columns — handball has BOTH 1X2 (3-Way Result, regulation) and T/T (ML, OT inclusive) per mig 171.
export const HANDBALL_COLUMNS: MarketColumnConfig[] = [
  { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "DC", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
  { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
  { groupName: "U/O", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
];

// Baseball prematch columns — baseball ML is T/T per mig 171.
export const BASEBALL_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
  { groupName: "Run totali", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
];

// Tabletennis prematch columns — Totale Set ha 396 markets 22bet
// prematch (vs 0 live), quindi il preset prematch differisce dal live.
export const TABLETENNIS_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "Totale set", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
];

// Cricket prematch columns — cricket ML is 2-way (T/T) per mig 171.
export const CRICKET_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "U/O", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
];

// Volleyball prematch columns — volley ML is 2-way (T/T) per mig 171. odds-api does not provide a 1X2 3-way market for volley.
export const VOLLEYBALL_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "T/T 1° Set", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
];

// MMA prematch columns — MMA ML is T/T per mig 171.
export const MMA_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
];

// Boxing prematch columns
export const BOXING_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
];

// Darts prematch columns
export const DARTS_COLUMNS: MarketColumnConfig[] = [
  { groupName: "T/T", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
];

// E-League prematch columns
export const ELEAGUE_COLUMNS: MarketColumnConfig[] = [
  { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
  { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  { groupName: "GG/NG", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
  { groupName: "U/O", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
];

// Football event detail tab names
export const FOOTBALL_TABS = [
  "Principali", "Goal", "Under/Over", "1\u00b0 Tempo", "2\u00b0 Tempo",
  "Combo", "Supergoal", "Combo Giocatori", "Mix 1\u00b0T. / 2\u00b0T.",
  "Giocatori", "Extra / Special",
];

// Detail tabs per sport
export const SPORT_DETAIL_TABS: Record<string, string[]> = {
  football: FOOTBALL_TABS,
  tennis: ["Principali", "Under/Over Game", "Risultato Esatto", "Set", "Handicap", "Combo"],
  basketball: ["Principali", "Under/Over", "1\u00b0 Tempo", "Squadre", "Quarto 1", "Quarto 2", "Quarto 3", "Quarto 4"],
  icehockey: ["Principali", "Under/Over", "Handicap"],
  rugby: ["Principali", "Under/Over", "Handicap"],
  volleyball: ["Principali", "Set", "Handicap"],
  handball: ["Principali", "Under/Over", "Handicap"],
  default: ["Principali"],
};

export function getDetailTabs(sportId: string): string[] {
  return SPORT_DETAIL_TABS[sportId] ?? SPORT_DETAIL_TABS.default;
}

// Live view columns per sport
// Keys must match the selection names in events-live.json exactly
export const LIVE_COLUMNS: Record<string, MarketColumnConfig[]> = {
  football: [
    { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
    { groupName: "GG/NG", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
    { groupName: "U/O", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
    { groupName: "DC", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
  ],
  tennis: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Totale set", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
    { groupName: "Totale giochi", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  basketball: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "T/T Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "U/O Incl. Supp.", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  eleague: [
    { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "U/O", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  cycling: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
  ],
  darts: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Leg totali", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
    { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
  ],
  icehockey: [
    { groupName: "1X2 TR", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
    { groupName: "DC TR", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
    { groupName: "Handicap TR", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "Gol Tot. TR", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  volleyball: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Totale set", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
    { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
  ],
  // Tabletennis live: bookmakers don't quote `total_sets_ft` in-play
  // (0 markets live vs 396 prematch on prod) — the live column uses
  // `u_o_ft` which represents total points of the match (raw "U/O 100.5").
  // Prematch continues to expose Totale Set via TABLETENNIS_COLUMNS below.
  tabletennis: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "U/O Punti", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
    { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
  ],
  rugby: [
    { groupName: "Tempo regolamentare (1X2)", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
    { groupName: "T/T Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "U/O Incl. Supp.", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  snooker: [
    { groupName: "Testa a Testa", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Frame Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "Frame totali", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  cricket: [
    // U/O removed — canonical `u_o_ft` has 0 markets on cricket for both
    // sources in prod (top 22bet canonicals are cricket-specific like
    // `last_digit_after_overs_ft` and `team_total_run_over_ft`, not
    // fitting in a listing column).
    { groupName: "Esito Finale 1x2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
  ],
  handball: [
    { groupName: "Tempo Regolamentare", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
    { groupName: "DC", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
    { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "U/O", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  baseball: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "Run totali", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  boxing: [
    // 22bet emits both 3-way (1X2) and 2-way (Vincente Incontro) markets
    // for combat sports — the canonical dispatch on this groupName picks
    // whichever is present per-event.
    { groupName: "Esito dell'incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Round totali", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  mma: [
    { groupName: "Esito dell'incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "Round totali", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  amfootball: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "T/T Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "U/O", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  aussierules: [
    { groupName: "Vincente Incontro", columns: [{ key: "1", label: "1" }, { key: "2", label: "2" }] },
    { groupName: "T/T Handicap", columns: [{ key: "1", label: "1" }, { key: "_line", label: "" }, { key: "2", label: "2" }] },
    { groupName: "U/O", columns: [{ key: "UNDER", label: "U" }, { key: "_line", label: "" }, { key: "OVER", label: "O" }] },
  ],
  golf: [
    { groupName: "Miglior punteggio", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
  ],
};

/** Prematch presets — only football gets a dropdown with multiple views */
export const PREMATCH_PRESETS: Record<string, LiveMarketPreset[]> = {
  football: [
    {
      name: "MERCATI PRINCIPALI",
      columns: [
        { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
        { groupName: "DC", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
        { groupName: "U/O", columns: [{ key: "under", label: "UNDER" }, { key: "_line", label: "" }, { key: "over", label: "OVER" }] },
        { groupName: "GG/NG", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
      ],
    },
    {
      name: "U/O",
      columns: [
        { groupName: "U/O", columns: [{ key: "under", label: "UNDER" }, { key: "_line", label: "" }, { key: "over", label: "OVER" }] },
        { groupName: "DC", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
        { groupName: "GG/NG", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
      ],
    },
    {
      name: "1X2 + GG/NG",
      columns: [
        { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
        { groupName: "GG/NG", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
        { groupName: "U/O", columns: [{ key: "under", label: "UNDER" }, { key: "_line", label: "" }, { key: "over", label: "OVER" }] },
      ],
    },
  ],
};

export function getPrematchPresets(sportId: string): LiveMarketPreset[] | null {
  return PREMATCH_PRESETS[sportId] ?? null;
}

export function getMarketColumns(sportId: string, template: string): MarketColumnConfig[] {
  if (sportId === "tennis") return TENNIS_COLUMNS;
  if (sportId === "tabletennis") return TABLETENNIS_COLUMNS;
  if (sportId === "basketball") return BASKETBALL_COLUMNS;
  if (sportId === "icehockey") return HOCKEY_COLUMNS;
  if (sportId === "rugby") return RUGBY_COLUMNS;
  if (sportId === "handball") return HANDBALL_COLUMNS;
  if (sportId === "baseball") return BASEBALL_COLUMNS;
  if (sportId === "eleague") return ELEAGUE_COLUMNS;
  if (sportId === "cricket") return CRICKET_COLUMNS;
  if (sportId === "volleyball") return VOLLEYBALL_COLUMNS;
  if (sportId === "mma") return MMA_COLUMNS;
  if (sportId === "boxing") return BOXING_COLUMNS;
  if (sportId === "darts") return DARTS_COLUMNS;
  // Use LIVE_COLUMNS for sports with dedicated column configs
  if (LIVE_COLUMNS[sportId]) return LIVE_COLUMNS[sportId];
  return MARKET_COLUMNS[template] ?? [];
}

export function getLiveColumns(sportId: string): MarketColumnConfig[] {
  return LIVE_COLUMNS[sportId] ?? LIVE_COLUMNS.football;
}

/** Live market view presets per sport — each preset is a named set of columns */
export interface LiveMarketPreset {
  name: string;
  columns: MarketColumnConfig[];
}

export const LIVE_PRESETS: Record<string, LiveMarketPreset[]> = {
  football: [
    {
      name: "MERCATI PRINCIPALI",
      columns: [
        { groupName: "1X2", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
        { groupName: "GG/NG", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
        { groupName: "U/O", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
        { groupName: "DC", columns: [{ key: "1X", label: "1X" }, { key: "X2", label: "X2" }, { key: "12", label: "12" }] },
      ],
    },
    {
      name: "U/O",
      columns: [
        { groupName: "U/O 0.5", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
        { groupName: "U/O 1.5", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
        { groupName: "U/O 2.5", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
        { groupName: "U/O 3.5", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
      ],
    },
    {
      name: "1° TEMPO",
      columns: [
        { groupName: "1X2 1T", columns: [{ key: "1", label: "1" }, { key: "X", label: "X" }, { key: "2", label: "2" }] },
        { groupName: "U/O 1T", columns: [{ key: "UNDER", label: "UNDER" }, { key: "_line", label: "" }, { key: "OVER", label: "OVER" }] },
        { groupName: "GG/NG 1° Tempo", columns: [{ key: "gg", label: "GG" }, { key: "ng", label: "NG" }] },
      ],
    },
  ],
};

export function getLivePresets(sportId: string): LiveMarketPreset[] {
  return LIVE_PRESETS[sportId] ?? [{ name: "RISULTATO FINALE", columns: getLiveColumns(sportId) }];
}

/* ── Live event detail tabs per sport ── */
export const LIVE_DETAIL_TABS: Record<string, string[]> = {
  football: [
    "Mercati Principali", "1°/2° Tempo", "Risultato Finale",
    "Tempi Supplementari", "Under/Over & Goal", "Cartellini",
    "Corner", "Giocatori", "Altro",
  ],
  tennis: [
    "Mercati Principali", "Set", "Under/Over Giochi",
    "Handicap", "Altro",
  ],
  basketball: [
    "Mercati Principali", "Under/Over", "Handicap",
    "Quarti", "Altro",
  ],
  icehockey: [
    "Mercati Principali", "Under/Over", "Periodi", "Altro",
  ],
  eleague: [
    "Mercati Principali", "Under/Over", "Altro",
  ],
  darts: [
    "Mercati Principali", "Set/Leg", "Altro",
  ],
  mma: [
    "Mercati Principali", "Altro",
  ],
  boxing: [
    "Mercati Principali", "Altro",
  ],
  default: ["Mercati Principali", "Altro"],
};

export function getLiveDetailTabs(sportId: string): string[] {
  return LIVE_DETAIL_TABS[sportId] ?? LIVE_DETAIL_TABS.default;
}

/* ── Categorize flat markets into detail tabs ── */

import type { Market } from "./types";

const FOOTBALL_TAB_PATTERNS: [string, RegExp[]][] = [
  ["Mercati Principali", [/^1X2$/i, /^DC$/i, /^GG\/NG$/i, /^U\/O\s+2\.5$/i, /^DNB$/i, /^Testa a Testa$/i]],
  ["1°/2° Tempo", [/1[°º]\s*tempo/i, /2[°º]\s*tempo/i, /\b1T\b/i, /\b2T\b/i, /\bHT\b/i, /\bSH\b/i]],
  ["Risultato Finale", [/risultato esatto/i, /risultato finale/i, /punteggio/i]],
  ["Tempi Supplementari", [/supplementar/i, /overtime/i, /rigori/i]],
  ["Under/Over & Goal", [/^U\/O\b/i, /under.*over/i, /goal/i, /^GG\/NG/i, /marcator/i, /segna/i]],
  ["Cartellini", [/cartellin/i, /ammonizion/i, /espulsion/i]],
  ["Corner", [/corner/i, /angoli/i, /calcio d'angolo/i]],
  ["Giocatori", [/giocator/i, /player/i, /marcatore/i, /assist/i, /tiri/i]],
];

const TENNIS_TAB_PATTERNS: [string, RegExp[]][] = [
  ["Mercati Principali", [/^Testa a Testa$/i, /^1X2$/i, /vincente/i]],
  ["Set", [/\bset\b/i]],
  ["Under/Over Giochi", [/under|over|U\/O/i, /giochi/i]],
  ["Handicap", [/handicap/i]],
];

const BASKETBALL_TAB_PATTERNS: [string, RegExp[]][] = [
  ["Mercati Principali", [/^Testa a Testa$/i, /^1X2$/i, /vincente/i]],
  ["Under/Over", [/under|over|U\/O/i]],
  ["Handicap", [/handicap/i]],
  ["Quarti", [/quarto/i, /quarter/i, /periodo/i]],
];

const DEFAULT_TAB_PATTERNS: [string, RegExp[]][] = [
  ["Mercati Principali", [
    /^1X2$/i, /^DC$/i, /^GG\/NG$/i, /^Testa a Testa$/i, /vincente/i, /^DNB$/i,
    /^Esito dell'incontro$/i, /^Esito Finale 1x2/i, /^Esito finale/i,
    /^Doppia Chance/i, /^Draw No Bet/i,
    /^Tempo [Rr]egolamentare/i, /^Supplementari Inclusi$/i,
    /^Match Odds$/i,
    /^U\/O\b/i, /^Gol totali/i, /^Totale/i, /^Run totali/i, /^Round totali/i,
    /^Frame totali/i, /^Frame Handicap/i, /^Leg totali/i,
    /^T\/T Handicap/i, /^Handicap/i,
    /^Entrambe le squadre segnano/i,
    /^Risultato esatto/i,
    /^Mappe totali/i, /^Handicap Mappa/i,
  ]],
];

const ICEHOCKEY_TAB_PATTERNS: [string, RegExp[]][] = [
  ["Mercati Principali", [
    /^Esito Finale 1x2/i, /^1X2$/i,
    /^Doppia Chance/i, /^DC$/i,
    /^Entrambe le squadre segnano/i, /^GG\/NG$/i,
    /^Draw No Bet/i, /^DNB$/i,
    /^Testa a Testa$/i, /vincente/i,
    /^Supplementari Inclusi$/i,
    /^Risultato esatto/i,
    /^Handicap - Tempo regolamentare/i,
  ]],
  ["Under/Over", [/^U\/O\b/i, /^Gol totali/i, /^Totale gol/i, /totale.*gol/i]],
  ["Periodi", [/periodo/i, /period/i, /\b1T\b/i, /\b2T\b/i, /\b3T\b/i, /1[°º]\s*(periodo|tempo)/i, /2[°º]\s*(periodo|tempo)/i, /3[°º]\s*(periodo|tempo)/i]],
];

const MMA_TAB_PATTERNS: [string, RegExp[]][] = [
  ["Mercati Principali", [/^Esito dell'incontro$/i, /^Testa a Testa$/i, /vincente/i, /^Round totali/i, /^Metodo di vittoria/i, /^Combinazione Vincente/i]],
];

const BOXING_TAB_PATTERNS: [string, RegExp[]][] = [
  ["Mercati Principali", [/^Esito dell'incontro$/i, /^Testa a Testa$/i, /vincente/i, /^Round totali/i, /^Metodo di vittoria/i]],
];

// Canonical-key → tab mapping. Checked BEFORE the regex patterns so that
// markets with a canonical_key (both Kambi and 22bet via market_normalization)
// are categorized consistently regardless of the raw source naming.
// A market may appear in multiple tabs when its canonical_key is listed
// in several entries (e.g. u_o_ft belongs to both "Mercati Principali" and
// "Under/Over & Goal").
const FOOTBALL_TAB_CANONICALS: Record<string, string[]> = {
  "Mercati Principali": [
    "1x2_ft", "dc_ft", "gg_ng_ft", "u_o_ft", "dnb_ft", "winner_ft", "h2h_ft",
    "htft",
  ],
  "1°/2° Tempo": [
    "1x2_1h", "1x2_2h", "dc_1h", "dc_2h", "u_o_1h", "u_o_2h",
    "gg_ng_1h", "gg_ng_2h", "oe_1h", "cs_1h", "dnb_1h",
  ],
  "Risultato Finale": ["cs_ft", "cs_1h"],
  "Tempi Supplementari": [
    "u_o_etp", "u_o_et", "1x2_et", "1x2_etp", "cs_et", "cs_etp",
    "gg_ng_et", "gg_ng_etp", "dc_etp",
  ],
  "Under/Over & Goal": [
    "u_o_ft", "u_o_1h", "u_o_2h", "gg_ng_ft", "gg_ng_1h", "gg_ng_2h",
    "asian_total_ft", "asian_total_1h", "asian_total_2h",
    "total_team_ft", "total_team_1h", "total_team_2h",
    "exact_goals_ft", "team1_exact_goals_ft", "team2_exact_goals_ft",
  ],
  "Cartellini": ["total_cards_ft"],
  "Corner": ["total_corners_ft", "total_corners_1h", "total_corners_2h", "corner_winner_ft", "corner_1x2_handicap_ft"],
  "Giocatori": [
    "anytime_scorer", "first_scorer", "last_scorer",
    "player_assists_ft", "player_booked_ft", "player_scores_goals_ft",
    "player_shots_on_target_ft",
  ],
};

const TENNIS_TAB_CANONICALS: Record<string, string[]> = {
  "Mercati Principali": ["winner_ft", "h2h_ft", "most_games_won_ft", "most_breaks_ft"],
  Set: ["set_winner_1", "set_winner_2", "result_after_2_sets_ft", "set_match_combo_ft"],
  "Under/Over Giochi": ["u_o_ft", "u_o_1h", "asian_total_ft"],
  Handicap: ["asian_handicap_ft", "2way_handicap_ft", "1x2_h_ft"],
};

const BASKETBALL_TAB_CANONICALS: Record<string, string[]> = {
  "Mercati Principali": ["winner_ft", "h2h_ft", "1x2_ft", "u_o_ft"],
  "Under/Over": ["u_o_ft", "u_o_1h", "u_o_2h", "u_o_3h", "u_o_4h", "asian_total_ft"],
  Handicap: ["asian_handicap_ft", "2way_handicap_ft", "1x2_h_ft"],
  Quarti: ["1x2_3h", "1x2_4h", "u_o_3h", "u_o_4h", "dc_3h", "dc_4h", "oe_3h", "oe_4h"],
};

const ICEHOCKEY_TAB_CANONICALS: Record<string, string[]> = {
  "Mercati Principali": [
    "1x2_ft", "dc_ft", "gg_ng_ft", "dnb_ft", "winner_ft", "h2h_ft",
    "cs_ft", "u_o_ft",
  ],
  "Under/Over": ["u_o_ft", "u_o_1h", "u_o_2h", "u_o_3h", "asian_total_ft"],
  Periodi: ["1x2_1h", "1x2_2h", "1x2_3h", "dc_1h", "dc_2h", "dc_3h", "u_o_1h", "u_o_2h", "u_o_3h"],
};

const DEFAULT_TAB_CANONICALS: Record<string, string[]> = {
  "Mercati Principali": [
    "1x2_ft", "dc_ft", "gg_ng_ft", "dnb_ft", "winner_ft", "h2h_ft",
    "u_o_ft", "asian_total_ft",
    "1x2_h_ft", "asian_handicap_ft", "2way_handicap_ft",
    "cs_ft",
  ],
};

const SPORT_TAB_CANONICALS: Record<string, Record<string, string[]>> = {
  football: FOOTBALL_TAB_CANONICALS,
  tennis: TENNIS_TAB_CANONICALS,
  basketball: BASKETBALL_TAB_CANONICALS,
  icehockey: ICEHOCKEY_TAB_CANONICALS,
};

const SPORT_TAB_PATTERNS: Record<string, [string, RegExp[]][]> = {
  football: FOOTBALL_TAB_PATTERNS,
  tennis: TENNIS_TAB_PATTERNS,
  basketball: BASKETBALL_TAB_PATTERNS,
  icehockey: ICEHOCKEY_TAB_PATTERNS,
  mma: MMA_TAB_PATTERNS,
  boxing: BOXING_TAB_PATTERNS,
};

/**
 * Categorize a flat array of markets into named tabs for the event detail view.
 * Markets that don't match any specific tab go into "Altro".
 * Markets matching "Mercati Principali" also appear in their specific tab if matched.
 */
export function categorizeMarketsToTabs(
  markets: Market[],
  sportId: string,
): Record<string, Market[]> {
  const tabs = getLiveDetailTabs(sportId);
  const patterns = SPORT_TAB_PATTERNS[sportId] ?? DEFAULT_TAB_PATTERNS;
  const canonicals = SPORT_TAB_CANONICALS[sportId] ?? DEFAULT_TAB_CANONICALS;
  const result: Record<string, Market[]> = {};
  for (const tab of tabs) result[tab] = [];

  for (const market of markets) {
    let placed = false;
    const mt = market.type || market.name;
    const ck = market.canonicalKey;

    // 1. Canonical match (source-agnostic, preferred). A market may land
    //    in multiple tabs if its canonical_key is listed in several.
    if (ck) {
      for (const [tabName, keys] of Object.entries(canonicals)) {
        if (keys.includes(ck) && result[tabName]) {
          result[tabName].push(market);
          placed = true;
        }
      }
    }

    // 2. Regex fallback (Kambi retrocompat + markets without canonical mapping)
    if (!placed) {
      for (const [tabName, regexes] of patterns) {
        if (regexes.some((r) => r.test(mt))) {
          if (result[tabName]) {
            result[tabName].push(market);
            placed = true;
          }
        }
      }
    }

    // 3. Not placed anywhere → "Altro"
    if (!placed) {
      if (!result["Altro"]) result["Altro"] = [];
      result["Altro"].push(market);
    }
  }

  return result;
}
