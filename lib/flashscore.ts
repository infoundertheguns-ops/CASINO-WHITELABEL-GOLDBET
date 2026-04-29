// ═══════════════════════════════════════════════════════════
// Flashscore.it Feed API Client — Verified Settlement
// Parses pipe-delimited feed from local-global.flashscore.ninja
// for cross-source matching + settlement verification.
// ═══════════════════════════════════════════════════════════

import {
  normalizeTeamName,
  teamMatchScore,
  teamMatchScoreDetailed,
  buildHalfScores,
  delay,
} from "@/lib/betexplorer";

// Re-export utilities for consumers
export { normalizeTeamName, teamMatchScore, teamMatchScoreDetailed, buildHalfScores, delay };

// ═══ TYPES ═══

export interface FlashscoreResult {
  matchId: string; // 8-char alphanumeric (e.g. "tIOlBi9Q")
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  periods: number[][]; // [[homeP1, awayP1], [homeP2, awayP2], ...]
  status: "finished" | "live" | "not_started" | "cancelled" | "interrupted";
  timestamp: number; // Unix timestamp
  country: string;
  league: string;
  sport: string;
}

export interface FlashscoreFixture {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  timestamp: number;
  country: string;
  league: string;
  sport: string;
}

export interface FlashscoreLive {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
  periods: number[][]; // partial per-period breakdown
  stageCode: string;
  timestamp: number;
  country: string;
  league: string;
  sport: string;
}

export interface FlashscoreMatchDetail {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  scoreHome: number | null;
  scoreAway: number | null;
  periods: number[][];
  status: string;
  timestamp: number;
  stats: FlashscoreStat[];
}

export interface FlashscoreStat {
  name: string;
  home: string | number;
  away: string | number;
}

export interface MatchedEvent {
  eventId: string;
  externalId: string;
  flashscoreId: string;
  fsResult: FlashscoreResult;
  matchScore: number;
  dbHomeTeam: string;
  dbAwayTeam: string;
}

interface DbEvent {
  id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  score_home: number | null;
  score_away: number | null;
  starts_at: string;
  live_data: Record<string, unknown> | null;
  sport_name: string;
  flashscore_id?: string | null;
}

// ═══ CONSTANTS ═══

const NINJA_BASE = "https://local-global.flashscore.ninja";
const PROJECT_ID = "6";
const FEED_BASE = `${NINJA_BASE}/${PROJECT_ID}/x/feed`;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  Accept: "*/*",
  "Accept-Language": "it-IT,it;q=0.9",
  Referer: "https://www.flashscore.it/",
  "x-fsign": "SW9D1eZo",
  Origin: "https://www.flashscore.it",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
};

// Sport IDs on Flashscore
const SPORT_IDS: Record<string, number> = {
  calcio: 1,
  football: 1,
  tennis: 2,
  basket: 3,
  basketball: 3,
  "hockey ghiaccio": 4,
  hockey: 4,
  "football americano": 5,
  pallamano: 6,
  handball: 6,
  rugby: 8,
  baseball: 11,
  volley: 12,
  volleyball: 12,
  cricket: 13,
  freccette: 14,
  snooker: 15,
  boxe: 16,
  pugilato: 16,
  "australian rules": 18,
  "rugby league": 19,
  badminton: 21,
  golf: 23,
  "tennis tavolo": 25,
  mma: 28,
  "arti marziali": 28,
  automobilismo: 32,
  "formula 1": 32,
  nascar: 32,
  indycar: 32,
  motociclismo: 32,
  ciclismo: 34,
  esports: 36,
  counter_strike: 36,
  "league of legends": 36,
  valorant: 36,
  "dota 2": 36,
  dota: 36,
};

// ═══ FEED FORMAT FIELD CODES ═══
// Records separated by ~ (tilde)
// Fields within record separated by ¬ (not sign)
// Key-value pairs separated by ÷ (division sign) or · (middle dot)

// Results/fixtures feed (f_ endpoint) — verified 2026-03-03:
const F = {
  MATCH_ID: "AA",
  STAGE: "AB", // 1=not started, 2=live, 3=finished
  TIMESTAMP: "AD", // unix timestamp (seconds) — NOT AC
  HOME_TEAM: "AE",
  AWAY_TEAM: "AF",
  SCORE_HOME: "AG", // FT home score (or sets won in tennis)
  SCORE_AWAY: "AH", // FT away score (or sets won in tennis)
  // Period scores — field codes depend on sport:
  // Football: BC/BD = 1st half only
  // Tennis: BA/BB=set1, BC/BD=set2, BE/BF=set3, BG/BH=set4, BI/BJ=set5
  // Basketball: BA/BB=Q1, BC/BD=Q2, BE/BF=Q3, BG/BH=Q4, BI/BJ=OT
  // Hockey: BA/BB=P1, BC/BD=P2, BE/BF=P3, BG/BH=OT
  PERIOD_FIELDS: [
    ["BA", "BB"],
    ["BC", "BD"],
    ["BE", "BF"],
    ["BG", "BH"],
    ["BI", "BJ"],
  ] as [string, string][],
  COUNTRY_ID: "ZA",
  COUNTRY_NAME: "ZY", // verified — ZY not ZB
  LEAGUE_NAME: "ZA", // league is in the ZA text after country name
};

// Detail endpoint (dc_1_) field codes:
const D = {
  STATUS: "DA", // 1=Not started, 2=Live, 3=Ended
  LIVE_DETAIL: "DB", // 38=Half Time, 12=1st half, 13=2nd half
  TIMESTAMP: "DC",
  LIVE_START: "DD",
  SCORE_HOME: "DE",
  SCORE_AWAY: "DF",
};

// Stats endpoint (df_st_1_) field codes:
const S = {
  SECTION: "SE", // "Match", "1st Half", "2nd Half"
  NAME: "SG",
  HOME: "SH",
  AWAY: "SI",
};

// ═══ PIPE-DELIMITED PARSER ═══

interface FeedRecord {
  [key: string]: string;
}

export function parseFeed(raw: string): FeedRecord[] {
  const items = raw.split("~");
  const result: FeedRecord[] = [];

  for (const item of items) {
    if (!item || item.trim() === "") continue;

    const fields = item.split("¬");
    const record: FeedRecord = {};

    for (const field of fields) {
      if (!field || field.trim() === "") continue;

      let key: string;
      let value: string;

      const divIdx = field.indexOf("÷");
      const dotIdx = field.indexOf("·");

      if (divIdx >= 0) {
        key = field.substring(0, divIdx);
        value = field.substring(divIdx + 1);
      } else if (dotIdx >= 0) {
        key = field.substring(0, dotIdx);
        value = field.substring(dotIdx + 1);
      } else {
        continue;
      }

      if (!record[key]) {
        record[key] = value;
      } else {
        // Handle duplicate keys (e.g. second player in events)
        record[`${key}_2`] = value;
      }
    }

    if (Object.keys(record).length > 0) {
      result.push(record);
    }
  }

  return result;
}

// ═══ HTTP CLIENT ═══

async function fetchFeed(
  path: string,
  retries = 2
): Promise<string | null> {
  const url = `${FEED_BASE}/${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 403) {
        console.warn(`[flashscore] 403 Forbidden: ${url} — may need browser fallback`);
        return null;
      }

      if (!res.ok) {
        console.warn(`[flashscore] fetch ${url} → ${res.status}`);
        if (attempt < retries) {
          await delay(1000 * (attempt + 1));
          continue;
        }
        return null;
      }

      return await res.text();
    } catch (err) {
      if (attempt < retries) {
        await delay(1000 * (attempt + 1));
        continue;
      }
      console.warn(`[flashscore] fetch error ${url}:`, err);
      return null;
    }
  }

  return null;
}

// ═══ FETCH RESULTS ═══

/**
 * Fetch finished match results for a sport on a given date.
 * dayOffset: 0 = today, -1 = yesterday, -2 = day before, etc.
 */
export async function fetchResults(
  sport: string,
  date: Date
): Promise<FlashscoreResult[]> {
  const sportId = SPORT_IDS[sport.toLowerCase()];
  if (!sportId) return [];

  // Calculate day offset from today (CET timezone)
  const now = new Date();
  const todayCET = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Rome" })
  );
  const dateCET = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const dayDiff = Math.round(
    (dateCET.setHours(0, 0, 0, 0) - todayCET.setHours(0, 0, 0, 0)) /
      (24 * 60 * 60 * 1000)
  );

  // Feed path: f_{sportId}_{dayOffset}_3_it-it_1
  const path = `f_${sportId}_${dayDiff}_3_it-it_1`;
  const raw = await fetchFeed(path);
  if (!raw) return [];

  return parseResultsFeed(raw, sport);
}

/**
 * Parse the results feed response into FlashscoreResult objects.
 */
export function parseResultsFeed(
  raw: string,
  sport: string
): FlashscoreResult[] {
  const records = parseFeed(raw);
  const results: FlashscoreResult[] = [];

  let currentCountry = "";
  let currentLeague = "";

  for (const rec of records) {
    // League/tournament header record — has ZA (country ID) but no AA (match ID)
    if (rec["ZA"] && !rec[F.MATCH_ID]) {
      currentCountry = rec["ZY"] || currentCountry;
      // League name is in ZA field text (e.g., "ITALIA: Serie A")
      const zaText = rec["ZA"] || "";
      if (zaText.includes(":")) {
        currentLeague = zaText.split(":").slice(1).join(":").trim();
      } else {
        currentLeague = zaText;
      }
      continue;
    }

    // Match record — must have match ID and team names
    const matchId = rec[F.MATCH_ID];
    const homeTeam = rec[F.HOME_TEAM];
    const awayTeam = rec[F.AWAY_TEAM];
    if (!matchId || !homeTeam || !awayTeam) continue;

    // Parse status
    const stageCode = rec[F.STAGE] || "";
    const status = parseStatus(stageCode);

    // Parse scores
    const scoreHome = safeInt(rec[F.SCORE_HOME]);
    const scoreAway = safeInt(rec[F.SCORE_AWAY]);

    // Only include finished matches for settlement
    if (status !== "finished") continue;
    if (scoreHome === null || scoreAway === null) continue;

    // Parse period scores from B-fields
    const periods: number[][] = [];
    for (const [homeKey, awayKey] of F.PERIOD_FIELDS) {
      const h = safeInt(rec[homeKey]);
      const a = safeInt(rec[awayKey]);
      if (h !== null && a !== null) {
        periods.push([h, a]);
      }
    }

    // Parse timestamp (AD field, not AC)
    const timestamp = safeInt(rec[F.TIMESTAMP]) || 0;

    results.push({
      matchId,
      homeTeam,
      awayTeam,
      scoreHome,
      scoreAway,
      periods,
      status,
      timestamp,
      country: currentCountry,
      league: currentLeague,
      sport,
    });
  }

  return results;
}

// ═══ PARSE LIVE FEED ═══

export function parseLiveFeed(raw: string, sport: string): FlashscoreLive[] {
  const records = parseFeed(raw);
  const live: FlashscoreLive[] = [];
  let currentCountry = "";
  let currentLeague = "";

  for (const rec of records) {
    if (rec["ZA"] && !rec[F.MATCH_ID]) {
      currentCountry = rec["ZY"] || currentCountry;
      const zaText = rec["ZA"] || "";
      currentLeague = zaText.includes(":") ? zaText.split(":").slice(1).join(":").trim() : zaText;
      continue;
    }

    const matchId = rec[F.MATCH_ID];
    const homeTeam = rec[F.HOME_TEAM];
    const awayTeam = rec[F.AWAY_TEAM];
    if (!matchId || !homeTeam || !awayTeam) continue;

    const stageCode = (rec[F.STAGE] || "").trim();
    const status = parseStatus(stageCode);
    if (status !== "live") continue;

    const periods: number[][] = [];
    for (const [hk, ak] of F.PERIOD_FIELDS) {
      const h = safeInt(rec[hk]);
      const a = safeInt(rec[ak]);
      if (h !== null && a !== null) periods.push([h, a]);
    }

    live.push({
      matchId,
      homeTeam,
      awayTeam,
      scoreHome: safeInt(rec[F.SCORE_HOME]),
      scoreAway: safeInt(rec[F.SCORE_AWAY]),
      periods,
      stageCode,
      timestamp: safeInt(rec[F.TIMESTAMP]) || 0,
      country: currentCountry,
      league: currentLeague,
      sport,
    });
  }

  return live;
}

/**
 * Italian period label for a sport from the number of periods seen in the feed.
 * Flashscore emits periods as they complete (so `periodCount` is the current period index).
 * Returns undefined if the sport has no meaningful period concept.
 */
export function derivePeriodLabel(sport: string, periodCount: number): string | undefined {
  if (periodCount <= 0) return undefined;
  const s = sport.toLowerCase();
  if (s === "tennis" || s === "tennis_tavolo" || s === "tennis tavolo" || s === "volley" || s === "volleyball" || s === "badminton") {
    return `${periodCount}° Set`;
  }
  if (s === "basket" || s === "basketball") {
    return periodCount > 4 ? "OT" : `${periodCount}Q`;
  }
  if (s === "hockey" || s === "hockey ghiaccio") {
    return periodCount > 3 ? "OT" : `${periodCount}P`;
  }
  if (s === "baseball") {
    return `Inn ${periodCount}`;
  }
  if (s === "freccette" || s === "darts") {
    return `Leg ${periodCount}`;
  }
  if (s === "snooker") {
    return `Frame ${periodCount}`;
  }
  if (s === "calcio" || s === "football") {
    return periodCount === 1 ? "1T" : periodCount === 2 ? "2T" : undefined;
  }
  if (s === "pallamano" || s === "handball") {
    return periodCount === 1 ? "1T" : "2T";
  }
  if (s === "rugby" || s === "rugby league" || s === "rugby_league") {
    return periodCount === 1 ? "1T" : "2T";
  }
  if (s === "football americano" || s === "football_americano") {
    return periodCount > 4 ? "OT" : `${periodCount}Q`;
  }
  if (s === "australian rules" || s === "australian_rules") {
    return `${periodCount}Q`;
  }
  return undefined;
}

// ═══ FETCH FIXTURES (upcoming matches) ═══

export async function fetchFixtures(
  sport: string,
  date: Date
): Promise<FlashscoreFixture[]> {
  const sportId = SPORT_IDS[sport.toLowerCase()];
  if (!sportId) return [];

  const now = new Date();
  const todayCET = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Rome" })
  );
  const dateCET = new Date(date.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const dayDiff = Math.round(
    (dateCET.setHours(0, 0, 0, 0) - todayCET.setHours(0, 0, 0, 0)) /
      (24 * 60 * 60 * 1000)
  );

  const path = `f_${sportId}_${dayDiff}_3_it-it_1`;
  const raw = await fetchFeed(path);
  if (!raw) return [];

  return parseFixturesFeed(raw, sport);
}

export function parseFixturesFeed(
  raw: string,
  sport: string
): FlashscoreFixture[] {
  const records = parseFeed(raw);
  const fixtures: FlashscoreFixture[] = [];

  let currentCountry = "";
  let currentLeague = "";

  for (const rec of records) {
    // League header — has ZA but no AA
    if (rec["ZA"] && !rec[F.MATCH_ID]) {
      currentCountry = rec["ZY"] || currentCountry;
      const zaText = rec["ZA"] || "";
      if (zaText.includes(":")) {
        currentLeague = zaText.split(":").slice(1).join(":").trim();
      } else {
        currentLeague = zaText;
      }
      continue;
    }

    const matchId = rec[F.MATCH_ID];
    const homeTeam = rec[F.HOME_TEAM];
    const awayTeam = rec[F.AWAY_TEAM];
    if (!matchId || !homeTeam || !awayTeam) continue;

    const stageCode = rec[F.STAGE] || "";
    const status = parseStatus(stageCode);

    // Only include not-started matches for fixtures
    if (status !== "not_started") continue;

    const timestamp = safeInt(rec[F.TIMESTAMP]) || 0;

    fixtures.push({
      matchId,
      homeTeam,
      awayTeam,
      timestamp,
      country: currentCountry,
      league: currentLeague,
      sport,
    });
  }

  return fixtures;
}

// ═══ FETCH MATCH DETAIL ═══

export async function fetchMatchDetail(
  matchId: string
): Promise<FlashscoreMatchDetail | null> {
  // General info: dc_1_{matchId}
  const generalRaw = await fetchFeed(`dc_1_${matchId}`);
  if (!generalRaw) return null;

  const records = parseFeed(generalRaw);
  if (records.length === 0) return null;

  const rec = records[0];

  const statusCode = rec[D.STATUS] || "1";
  const status =
    statusCode === "3"
      ? "finished"
      : statusCode === "2"
        ? "live"
        : "not_started";

  const scoreHome = safeInt(rec[D.SCORE_HOME]);
  const scoreAway = safeInt(rec[D.SCORE_AWAY]);
  const timestamp = safeInt(rec[D.TIMESTAMP]) || 0;

  // Period scores from B-fields
  const periods: number[][] = [];
  for (const r of records) {
    for (const [hk, ak] of F.PERIOD_FIELDS) {
      const h = safeInt(r[hk]);
      const a = safeInt(r[ak]);
      if (h !== null && a !== null) {
        periods.push([h, a]);
      }
    }
    if (periods.length > 0) break; // found periods, stop looking
  }

  // Fetch stats: df_st_1_{matchId}
  let stats: FlashscoreStat[] = [];
  try {
    const statsRaw = await fetchFeed(`df_st_1_${matchId}`);
    if (statsRaw) {
      stats = parseStatsFeed(statsRaw);
    }
  } catch {
    // Stats are optional
  }

  return {
    matchId,
    homeTeam: rec[F.HOME_TEAM] || "",
    awayTeam: rec[F.AWAY_TEAM] || "",
    scoreHome,
    scoreAway,
    periods,
    status,
    timestamp,
    stats,
  };
}

function parseStatsFeed(raw: string): FlashscoreStat[] {
  const records = parseFeed(raw);
  const stats: FlashscoreStat[] = [];

  let currentSection = "Match";

  for (const rec of records) {
    if (rec[S.SECTION]) {
      currentSection = rec[S.SECTION];
      continue;
    }

    if (rec[S.NAME]) {
      stats.push({
        name: `${currentSection}: ${rec[S.NAME]}`,
        home: rec[S.HOME] || "0",
        away: rec[S.AWAY] || "0",
      });
    }
  }

  return stats;
}

// ═══ MATCH EVENTS (DB ↔ Flashscore) ═══

/**
 * Match DB events against Flashscore results using fuzzy team name matching.
 * Events with flashscore_id get direct lookup (skip fuzzy).
 */
export function matchEvents(
  dbEvents: DbEvent[],
  fsResults: FlashscoreResult[]
): MatchedEvent[] {
  const matched: MatchedEvent[] = [];
  const usedFs = new Set<number>();

  for (const dbEv of dbEvents) {
    // Skip events that already have a flashscore_id — they're handled via direct lookup
    if (dbEv.flashscore_id) continue;

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < fsResults.length; i++) {
      if (usedFs.has(i)) continue;

      const fs = fsResults[i];

      // Date check: event starts_at should be within 24h of FS timestamp
      if (fs.timestamp && dbEv.starts_at) {
        const dbTime = new Date(dbEv.starts_at).getTime() / 1000;
        if (Math.abs(dbTime - fs.timestamp) > 24 * 3600) continue;
      }

      // Calculate combined team match score
      const homeScore = teamMatchScore(dbEv.home_team, fs.homeTeam);
      const awayScore = teamMatchScore(dbEv.away_team, fs.awayTeam);
      const combined = homeScore + awayScore;

      // Both teams must match reasonably
      if (homeScore < 0.5 || awayScore < 0.5) continue;

      if (combined > bestScore) {
        bestScore = combined;
        bestIdx = i;
      }
    }

    // Threshold: combined score must be > 1.0 (lowered from 1.2 with alias+levenshtein support)
    if (bestIdx >= 0 && bestScore > 1.0) {
      const fs = fsResults[bestIdx];
      usedFs.add(bestIdx);

      if (
        dbEv.score_home != null &&
        dbEv.score_away != null &&
        (dbEv.score_home !== fs.scoreHome || dbEv.score_away !== fs.scoreAway)
      ) {
        console.warn(
          `[flashscore] Score mismatch for ${dbEv.home_team} vs ${dbEv.away_team}: ` +
            `DB=${dbEv.score_home}:${dbEv.score_away} FS=${fs.scoreHome}:${fs.scoreAway} — using Flashscore`
        );
      }

      matched.push({
        eventId: dbEv.id,
        externalId: dbEv.external_id,
        flashscoreId: fs.matchId,
        fsResult: fs,
        matchScore: bestScore,
        dbHomeTeam: dbEv.home_team,
        dbAwayTeam: dbEv.away_team,
      });
    }
  }

  return matched;
}

/**
 * Match fixtures (upcoming) to DB events for pre-matching.
 * Higher threshold (1.4) since pre-match has no score to cross-check.
 */
export function matchFixtures(
  dbEvents: DbEvent[],
  fsFixtures: FlashscoreFixture[]
): { eventId: string; flashscoreId: string; matchScore: number }[] {
  const matched: { eventId: string; flashscoreId: string; matchScore: number }[] = [];
  const usedFs = new Set<number>();

  for (const dbEv of dbEvents) {
    if (dbEv.flashscore_id) continue;

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < fsFixtures.length; i++) {
      if (usedFs.has(i)) continue;

      const fs = fsFixtures[i];

      // Time proximity check: within 6 hours
      if (fs.timestamp && dbEv.starts_at) {
        const dbTime = new Date(dbEv.starts_at).getTime() / 1000;
        if (Math.abs(dbTime - fs.timestamp) > 6 * 3600) continue;
      }

      const homeScore = teamMatchScore(dbEv.home_team, fs.homeTeam);
      const awayScore = teamMatchScore(dbEv.away_team, fs.awayTeam);
      const combined = homeScore + awayScore;

      if (homeScore < 0.5 || awayScore < 0.5) continue;

      if (combined > bestScore) {
        bestScore = combined;
        bestIdx = i;
      }
    }

    // Higher threshold for fixtures (no score to cross-validate) — lowered from 1.4 with alias support
    if (bestIdx >= 0 && bestScore > 1.2) {
      usedFs.add(bestIdx);
      matched.push({
        eventId: dbEv.id,
        flashscoreId: fsFixtures[bestIdx].matchId,
        matchScore: bestScore,
      });
    }
  }

  return matched;
}

// ═══ SEARCH FLASHSCORE (for admin manual matching) ═══

/**
 * Search Flashscore results/fixtures for a team name query.
 * Returns both today's and yesterday's matches across all sports.
 */
export async function searchFlashscore(
  query: string,
  sports: string[] = ["calcio", "tennis", "basket", "hockey ghiaccio", "volley", "pallamano"]
): Promise<(FlashscoreResult | FlashscoreFixture)[]> {
  const results: (FlashscoreResult | FlashscoreFixture)[] = [];
  const queryNorm = normalizeTeamName(query);
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const sport of sports) {
    // Fetch today + yesterday
    const [todayRes, yesterdayRes] = await Promise.all([
      fetchResults(sport, today),
      fetchResults(sport, yesterday),
    ]);
    await delay(500);

    const all = [...todayRes, ...yesterdayRes];
    for (const r of all) {
      const homeNorm = normalizeTeamName(r.homeTeam);
      const awayNorm = normalizeTeamName(r.awayTeam);
      if (
        homeNorm.includes(queryNorm) ||
        awayNorm.includes(queryNorm) ||
        queryNorm.includes(homeNorm) ||
        queryNorm.includes(awayNorm)
      ) {
        results.push(r);
      }
    }

    // Also check fixtures
    const [todayFix, tomorrowFix] = await Promise.all([
      fetchFixtures(sport, today),
      fetchFixtures(sport, new Date(Date.now() + 24 * 60 * 60 * 1000)),
    ]);
    await delay(500);

    for (const f of [...todayFix, ...tomorrowFix]) {
      const homeNorm = normalizeTeamName(f.homeTeam);
      const awayNorm = normalizeTeamName(f.awayTeam);
      if (
        homeNorm.includes(queryNorm) ||
        awayNorm.includes(queryNorm) ||
        queryNorm.includes(homeNorm) ||
        queryNorm.includes(awayNorm)
      ) {
        results.push(f);
      }
    }
  }

  return results;
}

// ═══ SPORT MAP (Italian → Flashscore) ═══

export const SPORT_MAP: Record<string, string> = {
  calcio: "calcio",
  tennis: "tennis",
  basket: "basket",
  "hockey ghiaccio": "hockey ghiaccio",
  "football americano": "football americano",
  pallamano: "pallamano",
  rugby: "rugby",
  baseball: "baseball",
  volley: "volley",
  cricket: "cricket",
  freccette: "freccette",
  snooker: "snooker",
  boxe: "boxe",
  pugilato: "boxe",
  "australian rules": "australian rules",
  "rugby league": "rugby league",
  badminton: "badminton",
  golf: "golf",
  "tennis tavolo": "tennis tavolo",
  mma: "mma",
  "arti marziali": "mma",
  automobilismo: "automobilismo",
  "formula 1": "automobilismo",
  nascar: "automobilismo",
  indycar: "automobilismo",
  motociclismo: "automobilismo",
  ciclismo: "ciclismo",
  esports: "esports",
  counter_strike: "esports",
  "league of legends": "esports",
  valorant: "esports",
  "dota 2": "esports",
  dota: "esports",
};

/**
 * Get all DB sport names that map to the same Flashscore sport.
 * e.g. "mma" → ["mma", "arti marziali"], "automobilismo" → ["automobilismo", "formula 1", "nascar", ...]
 * Used by endpoints to query events across grouped sports.
 */
export function getSportGroup(sport: string): string[] {
  const mapped = SPORT_MAP[sport.toLowerCase()];
  if (!mapped) return [sport];
  // Collect all keys that map to the same value
  const group = Object.entries(SPORT_MAP)
    .filter(([, v]) => v === mapped)
    .map(([k]) => k);
  return group.length > 0 ? group : [sport];
}

// ═══ HELPERS ═══

function parseStatus(
  stageCode: string
): "finished" | "live" | "not_started" | "cancelled" | "interrupted" {
  // Stage codes vary but the common patterns:
  // 1 = not started, 2 = live/in play, 3 = finished/ended
  // Some variations: "3" for finished, "31" for after extra time,
  // "51" for cancelled, "70" for walkover
  const code = stageCode.trim();

  if (code === "3" || code === "31" || code === "32") return "finished";
  if (code === "2" || code === "12" || code === "13" || code === "38") return "live";
  if (code === "1") return "not_started";
  if (code === "51" || code === "52" || code === "70" || code === "90") return "cancelled";
  if (code === "61") return "interrupted";

  // Numeric heuristic: 3x = finished variants
  const num = parseInt(code, 10);
  if (!isNaN(num)) {
    if (num >= 30 && num < 40) return "finished";
    if (num >= 10 && num < 30) return "live";
    if (num >= 50) return "cancelled";
  }

  return "not_started";
}

function safeInt(val: string | undefined): number | null {
  if (val === undefined || val === "" || val === null) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}
