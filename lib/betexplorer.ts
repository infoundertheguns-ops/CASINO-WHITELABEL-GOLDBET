import * as cheerio from "cheerio";

// ═══════════════════════════════════════════════════
// BetExplorer Results Scraper — Verified Settlement
// Scrapes betexplorer.com for verified match results
// with per-period score breakdowns across 7 sports.
// ═══════════════════════════════════════════════════

// ═══ TYPES ═══

export interface BetExplorerResult {
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  periods: number[][]; // [[home_p1, away_p1], [home_p2, away_p2], ...]
  status: "finished" | "aet" | "penalties" | "cancelled" | "postponed";
  date: string; // "DD.MM." from the page
  matchUrl: string;
}

export interface MatchedEvent {
  eventId: string;
  externalId: string;
  beResult: BetExplorerResult;
  matchScore: number; // combined similarity score
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
}

// ═══ SPORT MAP ═══

export const SPORT_MAP: Record<string, string> = {
  calcio: "football",
  tennis: "tennis",
  basket: "basketball",
  "hockey ghiaccio": "hockey",
  volley: "volleyball",
  pallamano: "handball",
  baseball: "baseball",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ═══ FETCH RESULTS ═══

export async function fetchResults(
  sport: string,
  date: Date
): Promise<BetExplorerResult[]> {
  const beSport = SPORT_MAP[sport.toLowerCase()];
  if (!beSport) return [];

  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const url = `https://www.betexplorer.com/${beSport}/results/?year=${y}&month=${m}&day=${d}`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.warn(`[betexplorer] fetch ${url} → ${res.status}`);
    return [];
  }

  const html = await res.text();
  return parseResultsPage(html, beSport);
}

// ═══ PARSE RESULTS PAGE ═══
//
// BetExplorer HTML structure (verified 2026-02-27):
//   <td class="table-main__tt">
//     <span class="table-main__time">11:00</span>
//     <a href="/football/.../">Zambia W - <strong>Namibia W</strong></a>
//   </td>
//   <td class="table-main__result"><a href="..."><strong>0:1</strong></a></td>
//   <td class="table-main__partial" colspan="3">(0:0, 0:1)</td>

function parseResultsPage(html: string, _sport: string): BetExplorerResult[] {
  const $ = cheerio.load(html);
  const results: BetExplorerResult[] = [];

  // Each row is a <tr> inside table.table-main
  $("table.table-main tr").each((_i, row) => {
    const $row = $(row);

    // Team names are in td.table-main__tt > a
    const $teamCell = $row.find("td.table-main__tt");
    if ($teamCell.length === 0) return;

    const $teamLink = $teamCell.find("a[href]");
    if ($teamLink.length === 0) return;

    // Extract teams: "Zambia W - Namibia W" (strong = winner)
    const teamText = $teamLink.text().trim();
    const dashIdx = teamText.indexOf(" - ");
    if (dashIdx < 0) return;

    const homeTeam = cleanTeamName(teamText.substring(0, dashIdx));
    const awayTeam = cleanTeamName(teamText.substring(dashIdx + 3));
    if (!homeTeam || !awayTeam) return;

    // Match URL
    const href = $teamLink.attr("href") || "";
    const matchUrl = href.startsWith("http")
      ? href
      : `https://www.betexplorer.com${href}`;

    // Score from td.table-main__result
    const $resultCell = $row.find("td.table-main__result");
    if ($resultCell.length === 0) return;

    const scoreText = $resultCell.text().trim();
    if (!scoreText || !/\d+:\d+/.test(scoreText)) return;

    // Period scores from td.table-main__partial
    const $partialCell = $row.find("td.table-main__partial");
    const partialText = $partialCell.length > 0 ? $partialCell.text().trim() : "";

    // Combine score + partial for parsing: "0:1 (0:0, 0:1)"
    const fullScoreText = partialText
      ? `${scoreText} ${partialText}`
      : scoreText;

    const parsed = parseScoreText(fullScoreText);
    if (!parsed) return;

    // Time from span.table-main__time
    const timeText = $teamCell.find("span.table-main__time").text().trim();

    results.push({
      homeTeam,
      awayTeam,
      scoreHome: parsed.home,
      scoreAway: parsed.away,
      periods: parsed.periods,
      status: parsed.status,
      date: timeText, // store time; date is implicit from URL
      matchUrl,
    });
  });

  return results;
}

// ═══ FETCH MATCH DETAIL (for period scores if missing) ═══

export async function fetchMatchDetail(
  matchUrl: string
): Promise<number[][] | null> {
  try {
    const res = await fetch(matchUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Look for period scores in detail page
    // They're typically in a section showing "1st Half: 1:0, 2nd Half: 1:0" etc.
    const pageText = $("body").text();

    // Try to find period score pattern anywhere in the page
    const periodMatch = pageText.match(/\(([^)]*\d+:\d+[^)]*)\)/);
    if (periodMatch) {
      return parsePeriodString(periodMatch[1]);
    }

    // Try specific detail elements
    const detailScore = $(".list-details__item, .match-info, [class*='score']")
      .text()
      .trim();
    const dMatch = detailScore.match(/\(([^)]*\d+:\d+[^)]*)\)/);
    if (dMatch) {
      return parsePeriodString(dMatch[1]);
    }

    return null;
  } catch {
    return null;
  }
}

// ═══ PARSE SCORE TEXT ═══

interface ParsedScore {
  home: number;
  away: number;
  periods: number[][];
  status: "finished" | "aet" | "penalties" | "cancelled" | "postponed";
}

function parseScoreText(text: string): ParsedScore | null {
  const clean = text.trim();

  // Check for postponed/cancelled
  if (/postp|canc|abn|abd|awrd/i.test(clean)) {
    return null;
  }

  // Pattern: "2:0 AET (1:0, 1:0, 1:0)" or "2:0 (1:0, 1:0)" or "2:0"
  // Also handles "4:3 AfP (1:1, 1:1, 0:0)"
  const scoreRegex =
    /^(\d+):(\d+)\s*(AET|ET|AfP|PEN|OT)?\s*(?:\(([^)]+)\))?$/i;
  const m = clean.match(scoreRegex);
  if (!m) return null;

  const home = parseInt(m[1], 10);
  const away = parseInt(m[2], 10);
  const statusFlag = (m[3] || "").toUpperCase();
  const periodStr = m[4] || "";

  let status: ParsedScore["status"] = "finished";
  if (statusFlag === "AET" || statusFlag === "ET" || statusFlag === "OT") {
    status = "aet";
  } else if (statusFlag === "AFP" || statusFlag === "PEN") {
    status = "penalties";
  }

  const periods = periodStr ? parsePeriodString(periodStr) : [];

  return { home, away, periods, status };
}

function parsePeriodString(periodStr: string): number[][] {
  return periodStr
    .split(",")
    .map((p) => {
      const parts = p.trim().split(":");
      if (parts.length !== 2) return null;
      const h = parseInt(parts[0], 10);
      const a = parseInt(parts[1], 10);
      if (isNaN(h) || isNaN(a)) return null;
      return [h, a];
    })
    .filter((p): p is number[] => p !== null);
}

// ═══ TEAM NAME NORMALIZATION ═══

function cleanTeamName(name: string): string {
  // Remove bold markers, extra whitespace
  return name.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(
      /\b(fc|sc|cf|ac|as|ss|us|ssd|asd|calcio|basket|hockey|club|sporting|sport|united|city)\b/gi,
      ""
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ═══ TEAM MATCHING ═══

export function teamMatchScore(dbName: string, beName: string): number {
  const normDb = normalizeTeamName(dbName);
  const normBe = normalizeTeamName(beName);

  if (!normDb || !normBe) return 0;

  // 1. Exact match
  if (normDb === normBe) return 1.0;

  // 2. One contains the other
  if (normDb.includes(normBe) || normBe.includes(normDb)) return 0.85;

  // 3. Token overlap
  const tokensDb = normDb.split(" ").filter((t) => t.length > 1);
  const tokensBe = normBe.split(" ").filter((t) => t.length > 1);

  if (tokensDb.length === 0 || tokensDb.length === 0) return 0;

  let shared = 0;
  for (const t of tokensDb) {
    if (tokensBe.some((tb) => tb === t || tb.includes(t) || t.includes(tb))) {
      shared++;
    }
  }

  const tokenScore = shared / Math.max(tokensDb.length, tokensBe.length);

  // 4. First word match bonus (e.g. "Inter" vs "Inter Milano")
  if (
    tokensDb.length > 0 &&
    tokensBe.length > 0 &&
    tokensDb[0] === tokensBe[0] &&
    tokensDb[0].length >= 3
  ) {
    return Math.max(tokenScore, 0.7);
  }

  return tokenScore;
}

// ═══ MATCH EVENTS ═══

export function matchEvents(
  dbEvents: DbEvent[],
  beResults: BetExplorerResult[]
): MatchedEvent[] {
  const matched: MatchedEvent[] = [];
  const usedBe = new Set<number>();

  for (const dbEv of dbEvents) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < beResults.length; i++) {
      if (usedBe.has(i)) continue;

      const be = beResults[i];

      // Date check: event starts_at should be same day as BE date
      if (be.date && dbEv.starts_at) {
        if (!datesMatch(dbEv.starts_at, be.date)) continue;
      }

      // Calculate combined team match score
      const homeScore = teamMatchScore(dbEv.home_team, be.homeTeam);
      const awayScore = teamMatchScore(dbEv.away_team, be.awayTeam);
      const combined = homeScore + awayScore;

      // Both teams must match reasonably (each > 0.5 individually)
      if (homeScore < 0.5 || awayScore < 0.5) continue;

      if (combined > bestScore) {
        bestScore = combined;
        bestIdx = i;
      }
    }

    // Threshold: combined score must be > 1.2
    if (bestIdx >= 0 && bestScore > 1.2) {
      const be = beResults[bestIdx];
      usedBe.add(bestIdx);

      // Log warning if scraper score differs from BetExplorer
      if (
        dbEv.score_home != null &&
        dbEv.score_away != null &&
        (dbEv.score_home !== be.scoreHome || dbEv.score_away !== be.scoreAway)
      ) {
        console.warn(
          `[betexplorer] Score mismatch for ${dbEv.home_team} vs ${dbEv.away_team}: ` +
            `DB=${dbEv.score_home}:${dbEv.score_away} BE=${be.scoreHome}:${be.scoreAway} — using BetExplorer`
        );
      }

      matched.push({
        eventId: dbEv.id,
        externalId: dbEv.external_id,
        beResult: be,
        matchScore: bestScore,
        dbHomeTeam: dbEv.home_team,
        dbAwayTeam: dbEv.away_team,
      });
    }
  }

  return matched;
}

// ═══ DATE MATCHING ═══

function datesMatch(_startsAt: string, _beDate: string): boolean {
  // Date matching is now implicit: we fetch results for today/yesterday,
  // so all results on the page are from the requested date.
  // The beDate field now contains the match time (e.g. "11:00"), not a date.
  // Always return true — filtering by date is handled at the fetch level.
  return true;
}

// ═══ BUILD HALF SCORES ═══

export function buildHalfScores(
  sport: string,
  periods: number[][]
): { home: number[]; away: number[] } | null {
  if (!periods || periods.length === 0) return null;

  const sportLower = sport.toLowerCase();

  switch (sportLower) {
    case "calcio":
    case "football": {
      // BetExplorer gives per-half: (1T score, 2T score)
      // Our DB stores: halfScoreHome[0] = 1st half score (same as BetExplorer)
      const home = periods.map((p) => p[0]);
      const away = periods.map((p) => p[1]);
      return { home, away };
    }

    case "tennis": {
      // periods = [[6,4],[6,3],[7,5]] → per-set game scores
      const home = periods.map((p) => p[0]);
      const away = periods.map((p) => p[1]);
      return { home, away };
    }

    case "basket":
    case "basketball": {
      // BetExplorer gives per-half: [[39,20],[35,25]]
      // Store per-half (more useful than cumulative [84])
      const home = periods.map((p) => p[0]);
      const away = periods.map((p) => p[1]);
      return { home, away };
    }

    case "hockey ghiaccio":
    case "hockey": {
      // periods = [[2,3],[0,1],[0,2]] → per-period scores
      const home = periods.map((p) => p[0]);
      const away = periods.map((p) => p[1]);
      return { home, away };
    }

    case "volley":
    case "volleyball": {
      // periods = [[25,11],[28,26],[24,17]] → per-set point scores
      const home = periods.map((p) => p[0]);
      const away = periods.map((p) => p[1]);
      return { home, away };
    }

    case "pallamano":
    case "handball": {
      // periods = [[15,17],[21,18]] → per-half scores
      const home = periods.map((p) => p[0]);
      const away = periods.map((p) => p[1]);
      return { home, away };
    }

    case "baseball": {
      // periods = inning scores
      const home = periods.map((p) => p[0]);
      const away = periods.map((p) => p[1]);
      return { home, away };
    }

    default:
      return null;
  }
}

// ═══ DELAY HELPER ═══

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
