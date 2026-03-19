// Maps Kambi sport slugs to Midas SVG filenames (exact names from kiosk)
// Usage: getMidasSportIcon(slug, "white") → "/midas/svg/sports/white/football.svg"

const SLUG_TO_MIDAS: Record<string, string> = {
  // === Football ===
  calcio: "football",
  football: "football",
  // === Tennis ===
  tennis: "tennis",
  // === Table Tennis ===
  "tennis-tavolo": "tabletennis",
  "table-tennis": "tabletennis",
  // === Basketball ===
  basket: "basketball",
  basketball: "basketball",
  // === Hockey / Ice Hockey ===
  hockey: "icehockey",
  "ice-hockey": "icehockey",
  // === Esports ===
  esports: "E-Leagues-Football",
  // === MMA / Martial Arts ===
  "arti-marziali": "mma",
  "ufc-mma": "mma",
  // === Boxing ===
  boxe: "boxing",
  boxing: "boxing",
  // === Darts ===
  freccette: "darts",
  darts: "darts",
  // === Snooker ===
  snooker: "snooker",
  // === American Football ===
  "football-americano": "americanfootball",
  "american-football": "americanfootball",
  // === Baseball ===
  baseball: "baseball",
  // === Rugby ===
  rugby: "rugby",
  // === Cricket ===
  cricket: "cricket",
  // === Aussie Rules ===
  "australian-rules": "aussierules",
  // === Cycling ===
  ciclismo: "cycling",
  cycling: "cycling",
  // === Golf ===
  golf: "golf",
  // === Volleyball ===
  volley: "volleyball",
  volleyball: "volleyball",
  // === Handball ===
  pallamano: "handball",
  handball: "handball",
  // === Speedway ===
  speedway: "speedway",
  // === Motorsport ===
  nascar: "motorsport",
  indycar: "motorsport",
  "v8-supercars": "motorsport",
  "formula-1": "formula1",
  motociclismo: "motogp",
};

// Maps slug to sport hero image (PNG in /midas/sport/)
const SLUG_TO_HERO: Record<string, string> = {
  calcio: "football",
  football: "football",
  tennis: "tennis",
  "tennis-tavolo": "tabletennis",
  basket: "basketball",
  basketball: "basketball",
  hockey: "icehockey",
  "ice-hockey": "icehockey",
  esports: "E-Leagues-Football",
  snooker: "snooker",
  "football-americano": "football", // no dedicated hero
  baseball: "football", // no dedicated hero
  rugby: "football", // no dedicated hero
  golf: "golf",
  volley: "volleyball",
  volleyball: "volleyball",
  pallamano: "handball",
  handball: "handball",
  speedway: "speedway",
  nascar: "motorsports",
  "formula-1": "formula1",
  motociclismo: "motogp",
  ciclismo: "football", // no dedicated hero
  boxe: "football", // no dedicated hero
  freccette: "football", // no dedicated hero
  cricket: "football", // no dedicated hero
};

export function getMidasSportFile(slug: string): string {
  return SLUG_TO_MIDAS[slug] || "football";
}

export function getMidasSportIcon(slug: string, variant: "white" | "black" = "white"): string {
  return `/midas/svg/sports/${variant}/${getMidasSportFile(slug)}.svg`;
}

export function getMidasSportHero(slug: string): string {
  const file = SLUG_TO_HERO[slug] || SLUG_TO_MIDAS[slug] || "football";
  return `/midas/sport/${file}.png`;
}

// Sport colors — EXACT RGB values from Midas sports.xml
export const MIDAS_SPORT_COLORS: Record<string, string> = {
  calcio: "rgb(141,198,63)",
  football: "rgb(141,198,63)",
  tennis: "rgb(238,220,0)",
  "tennis-tavolo": "rgb(0,66,122)",
  "table-tennis": "rgb(0,66,122)",
  basket: "rgb(250,166,26)",
  basketball: "rgb(250,166,26)",
  hockey: "rgb(0,104,166)",
  "ice-hockey": "rgb(0,104,166)",
  esports: "rgb(141,198,63)",
  "arti-marziali": "rgb(104,77,159)",
  "ufc-mma": "rgb(104,77,159)",
  boxe: "rgb(177,179,182)",
  boxing: "rgb(177,179,182)",
  freccette: "rgb(197,140,247)",
  darts: "rgb(197,140,247)",
  snooker: "rgb(0,107,105)",
  "football-americano": "rgb(64,186,141)",
  "american-football": "rgb(64,186,141)",
  baseball: "rgb(232,172,154)",
  rugby: "rgb(98,167,141)",
  cricket: "rgb(196,217,165)",
  "australian-rules": "rgb(229,193,1)",
  ciclismo: "rgb(67,103,155)",
  cycling: "rgb(67,103,155)",
  golf: "rgb(0,152,213)",
  volley: "rgb(224,0,133)",
  volleyball: "rgb(224,0,133)",
  pallamano: "rgb(167,36,40)",
  handball: "rgb(167,36,40)",
  speedway: "rgb(207,156,112)",
  nascar: "rgb(88,89,91)",
  indycar: "rgb(88,89,91)",
  "v8-supercars": "rgb(88,89,91)",
  "formula-1": "rgb(215,25,32)",
  motociclismo: "rgb(88,89,91)",
};
