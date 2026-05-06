import { fetchResultsFeed } from "./flashscore-client.js";
import { parseFixturesFeed, type FlashscoreFixture } from "./parser.js";
import { TtlCache } from "./cache.js";
import { normalizeTeam, matchTeams } from "./normalize.js";
import sportMap from "./sport-id-map.json" with { type: "json" };
import { sampleCollector } from "./sample-collector.js";

const SPORT_MAP = sportMap as Record<string, number>;
const CACHE_TTL_MS = Number(process.env.FS_SEARCH_CACHE_TTL_MS ?? 5 * 60 * 1000);
const cache = new TtlCache<FlashscoreFixture[]>(CACHE_TTL_MS);

const TIME_TOLERANCE_BY_SPORT: Record<string, number> = {
  _default: 10 * 60,
  tennis:    20 * 60,
  baseball:  20 * 60,
};
function tolFor(slug: string): number {
  return TIME_TOLERANCE_BY_SPORT[slug] ?? TIME_TOLERANCE_BY_SPORT._default;
}

const SPORT_NAMES: Record<number, string> = {
  1: "Football",
  2: "Tennis",
  3: "Basketball",
  4: "Ice Hockey",
  5: "American Football",
  6: "Baseball",
  7: "Handball",
  8: "Rugby",
  11: "Futsal",
  12: "Volleyball",
  13: "Cricket",
  14: "Darts",
  15: "Snooker",
  16: "Boxing",
  18: "Australian Rules",
  19: "Rugby League",
  21: "Badminton",
  23: "Golf",
  25: "Table Tennis",
  28: "MMA",
  32: "Motorsport",
  34: "Cycling",
  36: "Esports",
};

export function dayOffsetFromIso(isoStarts: string, now: Date = new Date()): number {
  const fmt = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const today = fmt(now); today.setHours(0, 0, 0, 0);
  const ev = fmt(new Date(isoStarts)); ev.setHours(0, 0, 0, 0);
  return Math.round((ev.getTime() - today.getTime()) / 86400000);
}

async function fetchAndCache(sportId: number, dayOffset: number): Promise<FlashscoreFixture[]> {
  const key = `${sportId}-${dayOffset}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = await fetchResultsFeed(sportId, dayOffset);
  if (!raw) return [];
  const parsed = parseFixturesFeed(raw, SPORT_NAMES[sportId] ?? String(sportId));
  cache.set(key, parsed);
  return parsed;
}

export type SearchResult =
  | { status: 200; body: { matchId: string; matchedHome: string; matchedAway: string; viaDayOffset: number } }
  | { status: 400; body: { error: "unknown_sport"; sport_slug: string } }
  | { status: 404; body: { error: "no_match"; reason: "feed_empty" | "time_window_miss" | "name_mismatch" } }
  | { status: 409; body: { error: "ambiguous"; candidates: Array<{ matchId: string; home: string; away: string }> } }
  | { status: 503; body: { error: "flashscore_unavailable" } };

export interface SearchInput {
  sportSlug: string;
  startsAt: string;
  home: string;
  away: string;
}

export async function searchEvent(input: SearchInput): Promise<SearchResult> {
  const sportId = SPORT_MAP[input.sportSlug];
  if (!sportId) return { status: 400, body: { error: "unknown_sport", sport_slug: input.sportSlug } };

  const baseOffset = dayOffsetFromIso(input.startsAt);
  const offsets = [baseOffset, baseOffset + 1, baseOffset - 1];

  const eventTs = Math.floor(new Date(input.startsAt).getTime() / 1000);
  const homeNorm = normalizeTeam(input.home, input.sportSlug);
  const awayNorm = normalizeTeam(input.away, input.sportSlug);
  const tolSec = tolFor(input.sportSlug);

  let anyFixturesLoaded = false;
  let anyInTimeWindow = false;
  let lastInWindow: FlashscoreFixture[] = [];   // hoisted: needed for sample logging at 404 branch

  for (const off of offsets) {
    let fixtures: FlashscoreFixture[];
    try {
      fixtures = await fetchAndCache(sportId, off);
    } catch {
      return { status: 503, body: { error: "flashscore_unavailable" } };
    }
    if (fixtures.length > 0) anyFixturesLoaded = true;

    const inWindow = fixtures.filter((f) => Math.abs(f.timestamp - eventTs) <= tolSec);
    lastInWindow = inWindow;   // overwrite each iteration; the most-recent offset's window is what's logged on 404
    if (inWindow.length > 0) anyInTimeWindow = true;

    const matches = inWindow.filter((f) => {
      const hN = normalizeTeam(f.homeTeam, input.sportSlug);
      const aN = normalizeTeam(f.awayTeam, input.sportSlug);
      return matchTeams(homeNorm, hN) && matchTeams(awayNorm, aN);
    });

    if (matches.length === 1) {
      return {
        status: 200,
        body: {
          matchId: matches[0].matchId,
          matchedHome: matches[0].homeTeam,
          matchedAway: matches[0].awayTeam,
          viaDayOffset: off,
        },
      };
    }
    if (matches.length > 1) {
      return {
        status: 409,
        body: {
          error: "ambiguous",
          candidates: matches.slice(0, 5).map((m) => ({ matchId: m.matchId, home: m.homeTeam, away: m.awayTeam })),
        },
      };
    }
  }

  const reason: "feed_empty" | "time_window_miss" | "name_mismatch" =
    !anyFixturesLoaded ? "feed_empty"
    : !anyInTimeWindow ? "time_window_miss"
    : "name_mismatch";

  if (reason !== "feed_empty") {
    sampleCollector.record({
      ts: Date.now(),
      sport_slug: input.sportSlug,
      query_home: input.home,
      query_away: input.away,
      starts_at: input.startsAt,
      reason,
      fs_candidates: lastInWindow.slice(0, 5).map((f) => ({
        home: f.homeTeam,
        away: f.awayTeam,
        ts_diff_sec: f.timestamp - eventTs,
      })),
    });
  }

  return { status: 404, body: { error: "no_match", reason } };
}

export const searchCache = cache;
