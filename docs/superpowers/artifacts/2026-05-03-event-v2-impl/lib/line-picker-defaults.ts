// lib/line-picker-defaults.ts

const SENTINEL_FAMILIES = new Set([
  "AH",
  "AH - 1T",
  "Hcap Corners",
  "European Hcap",
]);

const DEFAULTS: Record<string, Record<string, number>> = {
  calcio: {
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
  },
};

export function getDefaultLine(sportSlug: string, marketType: string): number | null {
  return DEFAULTS[sportSlug]?.[marketType] ?? null;
}

export function isSentinelLine(sportSlug: string, marketType: string): boolean {
  return SENTINEL_FAMILIES.has(marketType) && getDefaultLine(sportSlug, marketType) !== null;
}
