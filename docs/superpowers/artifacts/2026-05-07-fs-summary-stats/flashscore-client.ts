// ═══════════════════════════════════════════════════
// Flashscore Feed API HTTP Client
// Fetches pipe-delimited feed from flashscore.ninja
// ═══════════════════════════════════════════════════

import config from "../config.json" with { type: "json" };

const { ninjaBase, projectId, locale } = config;
const FEED_BASE = `${ninjaBase}/${projectId}/x/feed`;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a feed endpoint with retry and rate limiting.
 */
export async function fetchFeed(path: string, retries = 2): Promise<string | null> {
  const url = `${FEED_BASE}/${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 403) {
        console.warn(`[fs-client] 403 Forbidden: ${path} — may need browser fallback`);
        return null;
      }

      if (!res.ok) {
        console.warn(`[fs-client] ${path} → ${res.status}`);
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
      console.warn(`[fs-client] error ${path}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  return null;
}

/**
 * Fetch results feed for a sport and day offset.
 * dayOffset: 0 = today, -1 = yesterday, 1 = tomorrow
 */
export async function fetchResultsFeed(
  sportId: number,
  dayOffset: number
): Promise<string | null> {
  const path = `f_${sportId}_${dayOffset}_3_${locale}_1`;
  return fetchFeed(path);
}

/**
 * Fetch match detail (general info).
 */
export async function fetchMatchDetail(matchId: string): Promise<string | null> {
  return fetchFeed(`dc_1_${matchId}`);
}

/**
 * Fetch match summary feed (df_su_1_) — periods + incidents (goals, cards,
 * substitutions, assists) + match metadata (referee/venue/town/...).
 * Coverage varies by sport: rich for football/hockey, period-only for
 * basket/tennis/baseball/handball, minimal for esports/darts/boxing/MMA.
 */
export async function fetchSummary(matchId: string): Promise<string | null> {
  return fetchFeed(`df_su_1_${matchId}`);
}

/**
 * Fetch match stats feed (df_st_1_) — by-section stats with stable code SD.
 * Coverage: rich for top-tier football, hockey, basket, tennis, baseball;
 * empty for many lower-tier leagues and combat sports.
 */
export async function fetchStats(matchId: string): Promise<string | null> {
  return fetchFeed(`df_st_1_${matchId}`);
}

/**
 * Calculate day offset from today in CET timezone.
 */
export function getDayOffset(date: Date): number {
  const now = new Date();
  const todayCET = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Rome" })
  );
  const dateCET = new Date(
    date.toLocaleString("en-US", { timeZone: "Europe/Rome" })
  );

  return Math.round(
    (dateCET.setHours(0, 0, 0, 0) - todayCET.setHours(0, 0, 0, 0)) /
      (24 * 60 * 60 * 1000)
  );
}
