export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent } from "@/lib/settlement";
import { getSportSlugsEn } from "@/lib/sport-slug-it-to-en";
import {
  matchEvents,
  fetchMatchDetail as fsFetchMatchDetail,
  delay,
} from "@/lib/flashscore";
import type { FlashscoreResult, FlashscoreStat } from "@/lib/flashscore";
import { buildUpdatedLiveData } from "./_lib";

// ═══════════════════════════════════════════════════
// Flashscore Results Endpoint (events_v2 path)
// Receives results from standalone flashscore-scraper.
// 1. Fetches finished, unsettled events_v2 rows for this sport.
// 2. Direct-lookup matches via flashscore_id, fuzzy fallback otherwise.
// 3. For each match: persist verified score+stats into events_v2,
//    then call settleEvent() (which itself reads/writes events_v2).
// (Plan D S6 cutover: legacy `events` is no longer the settlement source.)
// ═══════════════════════════════════════════════════


// Record last successful run timestamp
async function stampLastRun(sb: any, key: string) {
  await sb.from("system_config").upsert({ key, value: JSON.stringify(new Date().toISOString()) }, { onConflict: "key" });
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { results, sport } = body as {
    results: FlashscoreResult[];
    sport: string;
  };

  if (!results || !Array.isArray(results) || results.length === 0) {
    return NextResponse.json({ error: "No results provided" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const stats = {
    received: results.length,
    matched: 0,
    verified: 0,
    settled: 0,
    direct_lookups: 0,
    stats_fetched: 0,
    stats_empty: 0,
    stats_fetch_failed: 0,
    errors: [] as string[],
  };

  const slugsEn = getSportSlugsEn(sport);
  if (slugsEn.length === 0) {
    await stampLastRun(supabase, "last_run_flashscore_results");
    return NextResponse.json({ ...stats, reason: "unknown_sport" });
  }

  // 1. Find finished unsettled events_v2 rows for this sport
  const { data: events, error: evErr } = await supabase
    .from("events_v2")
    .select(
      "id, odds_api_id, home, away, score_home, score_away, starts_at, live_data, flashscore_id"
    )
    // events_v2 lifecycle: pending → live → settled (cron mig 179 flips live→settled).
    // No 'finished' status. Filter on post-game states with settled_at still NULL
    // (not yet bet-settled). FS only pushes results for finished matches, so the
    // name+timestamp match itself implicitly filters out currently-active games.
    .in("status", ["live", "settled"])
    .is("last_settled_at", null)
    .in("sport_slug", slugsEn)
    .order("updated_at", { ascending: true })
    .limit(500);

  if (evErr || !events) {
    return NextResponse.json({
      ...stats,
      error: evErr?.message || "No events found",
    });
  }

  // 2. Direct lookups: events that already have flashscore_id
  const directEvents = events.filter((ev) => ev.flashscore_id);
  const resultsById = new Map(results.map((r) => [r.matchId, r]));

  for (const ev of directEvents) {
    const fsResult = resultsById.get(ev.flashscore_id!);
    if (!fsResult) continue;

    try {
      await verifyAndSettle(supabase, ev, fsResult, sport, stats);
      stats.direct_lookups++;
    } catch (err) {
      stats.errors.push(`${ev.home}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Fuzzy match for events without flashscore_id
  const fuzzyEvents = events.filter((ev) => !ev.flashscore_id);
  if (fuzzyEvents.length > 0 && results.length > 0) {
    // Adapt events_v2 shape → DbEvent shape used by matchEvents.
    // events_v2 uses `home`/`away`; matchEvents expects `home_team`/`away_team`.
    const dbEvents = fuzzyEvents.map((ev) => ({
      id: ev.id,
      external_id: ev.odds_api_id ? `odds-api:${ev.odds_api_id}` : "",
      home_team: ev.home,
      away_team: ev.away,
      score_home: ev.score_home,
      score_away: ev.score_away,
      starts_at: ev.starts_at,
      live_data: ev.live_data as Record<string, unknown> | null,
      sport_name: sport,
      flashscore_id: ev.flashscore_id,
    }));

    const matched = matchEvents(dbEvents, results);
    stats.matched = matched.length;

    for (const m of matched) {
      try {
        // Save flashscore_id on events_v2
        await supabase
          .from("events_v2")
          .update({ flashscore_id: m.flashscoreId })
          .eq("id", m.eventId);

        const ev = events.find((e) => e.id === m.eventId)!;
        await verifyAndSettle(supabase, ev, m.fsResult, sport, stats);
      } catch (err) {
        stats.errors.push(`${m.dbHomeTeam}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await stampLastRun(supabase, "last_run_flashscore_results");

  return NextResponse.json({
    ...stats,
    errors: stats.errors.length > 0 ? stats.errors.slice(0, 15) : undefined,
  });
}

async function verifyAndSettle(
  supabase: any,
  ev: { id: string; home: string; away: string; live_data: unknown },
  fsResult: FlashscoreResult,
  sport: string,
  stats: {
    verified: number;
    settled: number;
    stats_fetched: number;
    stats_empty: number;
    stats_fetch_failed: number;
    errors: string[];
  }
) {
  const existingLiveData =
    (
      await supabase
        .from("events_v2")
        .select("live_data")
        .eq("id", ev.id)
        .single()
    ).data?.live_data as Record<string, unknown> | null;

  // Fetch match detail to persist stats (corners/cards/shots) for settlement.
  // Best-effort: if FS doesn't return stats (stale fsid, rate limit, etc.)
  // we leave existing stats untouched via buildUpdatedLiveData idempotency.
  // NOTE: Do NOT gate on detail.status === 'finished' — that's the bug
  //       in verify-results that makes it miss live-state events.
  let matchStats: FlashscoreStat[] = [];
  try {
    const detail = await fsFetchMatchDetail(fsResult.matchId);
    if (detail && detail.stats.length > 0) {
      matchStats = detail.stats;
      stats.stats_fetched++;
    } else {
      stats.stats_empty++;
    }
    await delay(500);
  } catch {
    stats.stats_fetch_failed++;
    // best-effort — preserve existing stats
  }

  const updatedLiveData = buildUpdatedLiveData({
    existingLiveData,
    sport,
    fsResult,
    matchStats,
  });

  const { error: updateErr } = await supabase
    .from("events_v2")
    .update({
      score_home: fsResult.scoreHome,
      score_away: fsResult.scoreAway,
      live_data: updatedLiveData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ev.id);

  if (updateErr) {
    stats.errors.push(`Update ${ev.home}: ${updateErr.message}`);
    return;
  }

  stats.verified++;

  const settleRes = await settleEvent(supabase, ev.id);
  if (settleRes.success) {
    stats.settled++;
  } else if (settleRes.error) {
    stats.errors.push(`Settle ${ev.home}: ${settleRes.error}`);
  }
}
