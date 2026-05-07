// ═══════════════════════════════════════════════════
// Live Loop — Poll in-progress matches every 45s
// For each sport: fetch today feed → filter live → push to Vincitu
// ═══════════════════════════════════════════════════

import config from "../config.json" with { type: "json" };
import {
  fetchResultsFeed,
  fetchSummary,
  fetchStats,
} from "./flashscore-client.js";
import {
  parseLiveFeed,
  parseSummaryFeed,
  parseStatsFeed,
  type FlashscoreLive,
} from "./parser.js";
import { pushLive } from "./push-to-vincitu.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cap on per-sport enrichment to bound cycle time. Most sports have <10 live
// events; football peaks at ~30. With concurrency=3 and ~150ms per fetch (×2
// fetches per event) the worst-case enrichment for one sport is bounded.
const MAX_ENRICH_PER_SPORT = 30;
const ENRICH_CONCURRENCY = 3;

async function enrichOne(ev: FlashscoreLive): Promise<void> {
  try {
    const [suRaw, stRaw] = await Promise.all([
      fetchSummary(ev.matchId),
      fetchStats(ev.matchId),
    ]);
    if (suRaw) {
      const su = parseSummaryFeed(suRaw, ev.sport, ev.matchId);
      // Attach only if non-empty payload to avoid bloating the request body.
      if (
        su.periods.length > 0 ||
        su.incidents.length > 0 ||
        Object.keys(su.meta).length > 0
      ) {
        ev.summary = su;
      }
    }
    if (stRaw) {
      const st = parseStatsFeed(stRaw);
      if (st.length > 0) ev.stats = st;
    }
  } catch {
    // Best-effort enrichment — never fail the cycle on a single match.
  }
}

async function enrichBatch(events: FlashscoreLive[]): Promise<void> {
  const slice = events.slice(0, MAX_ENRICH_PER_SPORT);
  for (let i = 0; i < slice.length; i += ENRICH_CONCURRENCY) {
    const batch = slice.slice(i, i + ENRICH_CONCURRENCY);
    await Promise.all(batch.map(enrichOne));
  }
}

export async function runLiveCycle(): Promise<{
  totalLive: number;
  totalMatched: number;
  totalUpdated: number;
  cycleMs: number;
}> {
  const start = Date.now();
  let totalLive = 0;
  let totalMatched = 0;
  let totalUpdated = 0;

  for (const sport of config.sports) {
    try {
      const raw = await fetchResultsFeed(sport.id, 0);
      await delay(300);

      const liveEvents = raw ? parseLiveFeed(raw, sport.name) : [];
      totalLive += liveEvents.length;

      if (liveEvents.length === 0) continue;

      // Enrich each live match with summary (periods + incidents + meta) and
      // by-section stats. Bounded concurrency keeps the cycle near 30s budget.
      await enrichBatch(liveEvents);

      const pushResult = await pushLive(liveEvents, sport.name);
      totalMatched += pushResult.matched;
      totalUpdated += pushResult.updated;

      if (pushResult.matched > 0 || pushResult.updated > 0) {
        console.log(
          `[live] ${sport.name}: ${liveEvents.length} live → ${pushResult.matched} matched, ${pushResult.updated} aggiornati`
        );
      }

      if (pushResult.errors.length > 0) {
        console.warn(`[live] ${sport.name} errors:`, pushResult.errors.slice(0, 5));
      }

      await delay(300);
    } catch (err) {
      console.error(`[live] ${sport.name} error:`, err instanceof Error ? err.message : err);
    }
  }

  const cycleMs = Date.now() - start;
  console.log(
    `[live] Ciclo completato in ${(cycleMs / 1000).toFixed(1)}s — ` +
      `${totalLive} live, ${totalMatched} matchati, ${totalUpdated} aggiornati`
  );

  return { totalLive, totalMatched, totalUpdated, cycleMs };
}
