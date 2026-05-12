// lib/sport-slug-en-to-it.ts
//
// Inverse of lib/sport-slug-it-to-en.ts. Maps events_v2.sport_slug (English,
// odds-api stable) to the kiosk-style Italian slug used by the player UI sport
// filter + UI labels. Mirror of postgres `_sport_slug_en_to_it` (mig 175) for
// client-side usage where SQL function call is awkward.
//
// Returns the input unchanged if no mapping exists — caller can decide whether
// to skip the row or display the English slug verbatim.

const EN_TO_IT: Record<string, string> = {
  football: "calcio",
  basketball: "basket",
  handball: "pallamano",
  volleyball: "volley",
  "ice-hockey": "hockey-ghiaccio",
  tennis: "tennis",
  baseball: "baseball",
  rugby: "rugby",
  cricket: "cricket",
  "american-football": "football-americano",
  darts: "freccette",
  boxing: "boxe",
  mma: "mma",
  snooker: "snooker",
  esports: "esports",
};

export function getSportSlugIt(sportEn: string | null | undefined): string {
  if (!sportEn) return "";
  return EN_TO_IT[sportEn.trim().toLowerCase()] || sportEn;
}
