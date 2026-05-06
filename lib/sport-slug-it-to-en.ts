// lib/sport-slug-it-to-en.ts
//
// Mirror (inverse) of postgres _sport_slug_en_to_it (mig 175).
// Used by /api/flashscore/live to translate the FS-scraper-supplied
// Italian sport name to events_v2.sport_slug (English).
//
// Returns array because Italian aliases collapse to a single English slug
// (e.g. "boxe" / "pugilato" → "boxing"). Returns [] for unknown sports.

// Coverage = full intersection of FS-scraper SPORT_MAP keys (lib/flashscore.ts)
// AND events_v2.sport_slug values (15 distinct slugs as of 2026-05-06).
// IT keys not present here (australian rules, rugby league, badminton, golf,
// tennis tavolo, automobilismo / formula 1 / ..., ciclismo) have no odds-api
// equivalent in events_v2 → caller returns reason='unknown_sport'.
const IT_TO_EN: Record<string, string> = {
  "calcio":              "football",
  "basket":              "basketball",
  "pallamano":           "handball",
  "volley":              "volleyball",
  "hockey ghiaccio":     "ice-hockey",
  "hockey-ghiaccio":     "ice-hockey",
  "tennis":              "tennis",
  "baseball":            "baseball",
  "rugby":               "rugby",
  "cricket":             "cricket",
  "football americano":  "american-football",
  "football-americano":  "american-football",
  "freccette":           "darts",
  "boxe":                "boxing",
  "pugilato":            "boxing",
  "mma":                 "mma",
  "arti marziali":       "mma",
  "arti-marziali":       "mma",
  "snooker":             "snooker",
  "esports":             "esports",
  "counter_strike":      "esports",
  "league of legends":   "esports",
  "valorant":            "esports",
  "dota 2":              "esports",
  "dota":                "esports",
};

export function getSportSlugsEn(sportIt: string): string[] {
  const norm = sportIt.trim().toLowerCase();
  const en = IT_TO_EN[norm];
  return en ? [en] : [];
}
