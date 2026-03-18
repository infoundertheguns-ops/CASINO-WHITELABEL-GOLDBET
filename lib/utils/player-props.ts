// ═══ PLAYER PROPS UTILITIES ═══
// Player markets are regular markets inside normal events.
// Each market (e.g. "Primo Marcatore") has runners = player names with odds.

import type { Market } from "@/lib/hooks/use-sportsbook";

// Regex patterns to identify player-related markets
const PLAYER_MARKET_PATTERNS = [
  /marcatore/i,
  /goalscorer/i,
  /scorer/i,
  /hat.?trick/i,
  /tripletta/i,
  /doppietta/i,
  /assist/i,
  /fornisce/i,
  /shots?.on.target/i,
  /tiri?.in.porta/i,
  /saves/i,
  /parate/i,
  /headed.shot/i,
  /colpo.di.testa/i,
  /defensive.tackle/i,
  /falli/i,
  /cartellini/i,
  /cartellino\b/i,
  /ammonito/i,
  /espulso/i,
  /to.score/i,
  /^segna\b/i,
  /player/i,
  /giocatore/i,
  /rimbalzi/i,
  /rebounds/i,
  /first.basket/i,
  /man.of.the.match/i,
  /mvp/i,
];

/** Check if a market name is player-related */
export function isPlayerMarket(name: string): boolean {
  return PLAYER_MARKET_PATTERNS.some((p) => p.test(name));
}

/** Category grouping for player markets */
const CATEGORY_MAP: [RegExp, string][] = [
  [/^primo\s+marcatore|^first\s+goal\s*scorer/i, "Primo Marcatore"],
  [/^ultimo\s+marcatore|^last\s+goal\s*scorer/i, "Ultimo Marcatore"],
  [/^marcatore$|^anytime\s+goal\s*scorer|^to\s+score\s+anytime/i, "Marcatore"],
  [/doppietta|to\s+score\s+2\+/i, "Doppietta"],
  [/tripletta|hat.?trick/i, "Tripletta"],
  [/assist|fornisce/i, "Assist"],
  [/tiri|shots?.on.target|giocatore.*specchio/i, "Tiri"],
  [/cartellini|cartellino|ammonito|yellow/i, "Cartellini"],
  [/parate|saves/i, "Parate"],
  [/punti.*giocatore|points.*player|first.basket/i, "Punti"],
  [/rimbalzi|rebounds/i, "Rimbalzi"],
  [/^segna\b/i, "Marcatore"],
];

/** Get display category for a player market */
export function getPlayerCategory(name: string): string {
  for (const [pattern, label] of CATEGORY_MAP) {
    if (pattern.test(name)) return label;
  }
  return "Altro";
}

/** Player market category with its markets */
export interface PlayerMarketCategory {
  category: string;
  markets: Market[];
  totalRunners: number;
}

/** Match with its player markets grouped by category */
export interface PlayerMatch {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  leagueSlug: string;
  sportName: string;
  sportSlug: string;
  sportIcon: string;
  startsAt: string;
  isLive: boolean;
  categories: PlayerMarketCategory[];
  totalRunners: number;
}

/** Group player markets from a set of events into PlayerMatch[] */
export function buildPlayerMatches(
  events: Array<{
    id: string;
    home: string;
    away: string;
    league: string;
    leagueSlug?: string;
    sportName?: string;
    sportSlug?: string;
    leagueIcon: string;
    time: string;
    live: boolean;
    markets: Market[];
    startsAt?: string;
  }>
): PlayerMatch[] {
  const matches: PlayerMatch[] = [];

  for (const event of events) {
    // Filter only player markets
    const playerMarkets = event.markets.filter((m) => isPlayerMarket(m.name));
    if (playerMarkets.length === 0) continue;

    // Group by category
    const categoryMap = new Map<string, Market[]>();
    for (const market of playerMarkets) {
      const cat = getPlayerCategory(market.name);
      const arr = categoryMap.get(cat) || [];
      arr.push(market);
      categoryMap.set(cat, arr);
    }

    const categories: PlayerMarketCategory[] = [];
    let totalRunners = 0;
    for (const [category, markets] of categoryMap) {
      const runners = markets.reduce((sum, m) => sum + m.selections.length, 0);
      categories.push({ category, markets, totalRunners: runners });
      totalRunners += runners;
    }

    // Sort categories: Primo Marcatore first, then alphabetically
    const CATEGORY_ORDER = ["Primo Marcatore", "Ultimo Marcatore", "Marcatore", "Doppietta", "Tripletta", "Assist", "Tiri", "Cartellini", "Punti", "Rimbalzi", "Parate"];
    categories.sort((a, b) => {
      const aIdx = CATEGORY_ORDER.indexOf(a.category);
      const bIdx = CATEGORY_ORDER.indexOf(b.category);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.category.localeCompare(b.category);
    });

    matches.push({
      eventId: event.id,
      homeTeam: event.home,
      awayTeam: event.away,
      league: event.league,
      leagueSlug: event.leagueSlug || "",
      sportName: event.sportName || "",
      sportSlug: event.sportSlug || "",
      sportIcon: event.leagueIcon,
      startsAt: event.startsAt || event.time,
      isLive: event.live,
      categories,
      totalRunners,
    });
  }

  // Sort by start time
  matches.sort((a, b) => {
    const aTime = new Date(a.startsAt).getTime() || 0;
    const bTime = new Date(b.startsAt).getTime() || 0;
    return aTime - bTime;
  });

  return matches;
}

// Keep old exports for backward compatibility (unused but safe)
export type ParsedPlayerEvent = never;
export type PlayerEventRow = never;
export type MatchGroup = never;
export type TeamNameMap = never;
export type RegularEventRef = never;
export function parsePlayerPrefix(): null { return null; }
export function groupEventsByMatch(): never[] { return []; }
export function buildTeamNameMap(): Map<string, string> { return new Map(); }
