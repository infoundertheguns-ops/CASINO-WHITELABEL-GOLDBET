import type { CanonicalMarket, Source, StageResult } from "./types";

// Kambi-specific: italian form → base_key. Period is detected from trailing fragment via caller.
// Entries must be lowercased for matching.
const KAMBI_ITALIAN_MAP: Record<string, string> = {
  "1x2": "1x2",
  "dc": "dc",
  "gg/ng": "gg_ng",
  "pari/dispari": "odd_even",
  "risultato esatto": "correct_score",
  "draw no bet": "dnb",
  "esito 1t/finale": "htft",
  "testa a testa": "h2h",
};

// 22bet twobet_g code → base_key map (from Kambi API documentation + 22bet twobet_market_groups).
// These are the most common mappings; the DB table is authoritative for lookup.
const TWOBET_G_MAP: Record<number, string> = {
  1: "1x2",
  8: "dc",
  14: "odd_even",
  15: "total_team",
  27: "asian_handicap",
  62: "total_team",
  99: "asian_total",
  136: "correct_score",
  2854: "asian_handicap",
};

export interface LookupArgs {
  source: Source;
  source_market_type: string;
  canonicals: CanonicalMarket[];
  twobetGroups: Array<{ twobet_g: number; name_it: string }>;
}

export function lookupDictionary(args: LookupArgs): StageResult | null {
  const { source, source_market_type, canonicals, twobetGroups } = args;
  const needle = source_market_type.trim().toLowerCase();

  let base_key: string | undefined;

  if (source === "22bet") {
    // Exact match on name_it (case-insensitive)
    const group = twobetGroups.find((g) => g.name_it.toLowerCase() === needle);
    if (group) base_key = TWOBET_G_MAP[group.twobet_g];
  } else if (source === "kambi") {
    base_key = KAMBI_ITALIAN_MAP[needle];
  }

  if (!base_key) return null;

  // Default period = ft. Dictionary stage does NOT attempt to parse period suffixes —
  // that's stage 1's job. Dictionary matches only when the full string matches a known base.
  const canonical = canonicals.find((c) => c.base_key === base_key && c.period === "ft");
  if (!canonical) return null;

  return {
    canonical_key: canonical.canonical_key,
    canonical_line: null,
    canonical_name_it: canonical.canonical_name_it,
    confidence: 90,
    extracted_by: "dictionary",
  };
}
