// lib/line-picker-defaults.ts
//
// Default line per (sport, market_type) used by the LinePicker component
// when picking the initial visible variant. Sentinel families use 0 as a
// placeholder meaning "pick the variant with line closest to 0" (i.e. the
// most balanced AH/Hcap line).

// Sentinel — never collides with real lines (real lines bounded by ±200 across all sports).
export const MEDIAN_LINE = -1e9;

const SENTINEL_FAMILIES = new Set([
  // legacy invented names — keep for backward compat in case anything still references
  "AH",
  "AH - 1T",
  "Hcap Corners",
  "European Hcap",
  // real DB market_types (mig 159 vocabulary)
  "Handicap",
  "Handicap - 1T",
  "Alternative Asian Handicap",
  "Card Handicap",
  "Bookings Spread",
  "Handicap angoli",
  "Corner Handicap",
  "Spread 1Q",
  "Spread 2Q",
  "Spread 3Q",
  "Spread 4Q",
]);

const DEFAULTS: Record<string, Record<string, number>> = {
  calcio: {
    // Existing keys
    "U/O": 2.5,
    "U/O - 1T": 0.5,
    "U/O - 2T": 1.5,
    "Total Home": 1.5,
    "Total Away": 1.5,
    "AH": 0,
    "AH - 1T": 0,
    "European Hcap": -1,
    "Total Cards": 3.5,
    "Cards 1T": 1.5,
    "Cards 2T": 1.5,
    "Total Corners": 9.5,
    "Corners 1T": 4.5,
    "Corners 2T": 4.5,
    "Hcap Corners": 0,
    "Goalkeeper Saves": 3.5,
    "Player Shots": 1.5,
    // New entries — real DB market_types
    "Handicap": 0,                       // sentinel — nearest to 0
    "Handicap - 1T": 0,                  // sentinel
    "Alternative Asian Handicap": 0,     // sentinel
    "Alternative Total Goals": 2.5,
    "1st Half Goal Line": 0.5,
    "Bookings Totals": 3.5,
    "Card Handicap": 0,                  // sentinel
    "Bookings Spread": 0,                // sentinel
    "Totale angoli": 9.5,
    "Handicap angoli": 0,                // sentinel
    "Corner Handicap": 0,                // sentinel
    "Alternative Corners": 9.5,
    "Total Shots": 24.5,
    "Total Shots on Target": 8.5,
    "Player Shots on Target": 1.5,
    "Player Tackles": 1.5,
    "Player Fouls Committed": 1.5,
    "Player Passes": 25.5,
    "Player Fouls": 1.5,
  },
  basket: {
    // Sentinel 0 → LinePicker pesca la linea più vicina a 0 (= più bilanciata per handicap/spread)
    "T/T Handicap": 0,
    "Alternative Spread": 0,
    "Handicap - 1T": 0,
    "Handicap - 1Q": 0,
    "Spread 1Q": 0,
    "Spread 2Q": 0,
    "Spread 3Q": 0,
    "Spread 4Q": 0,
    // U/O totals: median sentinel — line range varies per league (NBA ~220, Euroleague ~165, NCAA ~130)
    "U/O Incl. Supp.": MEDIAN_LINE,
    "Alternative Totals": MEDIAN_LINE,
    "U/O - 1T": MEDIAN_LINE,
    "U/O - 1Q": MEDIAN_LINE,
    "U/O - 2Q": MEDIAN_LINE,
    "U/O - 3Q": MEDIAN_LINE,
    "U/O - 4Q": MEDIAN_LINE,
  },
};

export function getDefaultLine(sportSlug: string, marketType: string): number | null {
  return DEFAULTS[sportSlug]?.[marketType] ?? null;
}

export function isSentinelLine(sportSlug: string, marketType: string): boolean {
  return SENTINEL_FAMILIES.has(marketType) && getDefaultLine(sportSlug, marketType) !== null;
}
