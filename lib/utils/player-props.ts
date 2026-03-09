// ═══ PLAYER PROPS UTILITIES ═══
// Parsing & grouping for Giocatori events (player markets scraped as separate events)

export interface ParsedPlayerEvent {
  matchKey: string;       // "LAZ-SAS"
  playerName: string;     // "Mattia Zaccagni"
  playerTeam: string;     // "LAZ"
  opponentTeam: string;   // "SAS"
  side: "home" | "away";  // home = team with *, away = other
}

export interface PlayerEventRow {
  id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: string;
  league_name: string;
  league_slug: string;
  sport_name: string;
  sport_slug: string;
  sport_icon: string;
  parsed: ParsedPlayerEvent;
}

export interface MatchGroup {
  matchKey: string;       // "LAZ-SAS"
  homeTeam: string;       // "LAZ"
  awayTeam: string;       // "SAS"
  league: string;         // "Serie A"
  leagueSlug: string;
  sportName: string;
  sportSlug: string;
  sportIcon: string;
  startsAt: string;
  homePlayers: PlayerEventRow[];
  awayPlayers: PlayerEventRow[];
  totalPlayers: number;
}

/**
 * Parse "(LAZ*-SAS) Mattia Zaccagni" → structured player info
 * The * indicates the player's team (home side of the real match)
 */
export function parsePlayerPrefix(homeTeam: string): ParsedPlayerEvent | null {
  // Pattern: (TEAM1*-TEAM2) Player Name  OR  (TEAM1-TEAM2*) Player Name
  const m = homeTeam.match(/^\(([^)]+)\)\s+(.+)$/);
  if (!m) return null;

  const bracketContent = m[1]; // "LAZ*-SAS" or "LAZ-SAS*"
  const playerName = m[2].trim();

  const parts = bracketContent.split("-");
  if (parts.length !== 2) return null;

  const t1 = parts[0].trim();
  const t2 = parts[1].trim();
  const t1Star = t1.endsWith("*");
  const t2Star = t2.endsWith("*");

  const team1 = t1.replace("*", "");
  const team2 = t2.replace("*", "");
  const matchKey = `${team1}-${team2}`;

  if (t1Star) {
    return { matchKey, playerName, playerTeam: team1, opponentTeam: team2, side: "home" };
  } else if (t2Star) {
    return { matchKey, playerName, playerTeam: team2, opponentTeam: team1, side: "away" };
  }

  // No star — default home
  return { matchKey, playerName, playerTeam: team1, opponentTeam: team2, side: "home" };
}

/**
 * Group parsed player events by match + league
 */
export function groupEventsByMatch(events: PlayerEventRow[]): MatchGroup[] {
  const groupMap = new Map<string, MatchGroup>();

  for (const ev of events) {
    const key = `${ev.parsed.matchKey}|${ev.league_slug}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        matchKey: ev.parsed.matchKey,
        homeTeam: ev.parsed.matchKey.split("-")[0],
        awayTeam: ev.parsed.matchKey.split("-")[1],
        league: ev.league_name,
        leagueSlug: ev.league_slug,
        sportName: ev.sport_name,
        sportSlug: ev.sport_slug,
        sportIcon: ev.sport_icon,
        startsAt: ev.starts_at,
        homePlayers: [],
        awayPlayers: [],
        totalPlayers: 0,
      };
      groupMap.set(key, group);
    }

    if (ev.parsed.side === "home") {
      group.homePlayers.push(ev);
    } else {
      group.awayPlayers.push(ev);
    }
    group.totalPlayers++;

    // Keep earliest start time
    if (ev.starts_at < group.startsAt) {
      group.startsAt = ev.starts_at;
    }
  }

  // Sort groups by start time, then by league
  return Array.from(groupMap.values()).sort((a, b) => {
    const timeDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.league.localeCompare(b.league);
  });
}
