export const dynamic = "force-dynamic";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent } from "@/lib/settlement";
import {
  SPORT_MAP as FS_SPORT_MAP,
  fetchResults as fsFetchResults,
  fetchMatchDetail as fsFetchMatchDetail,
  matchEvents as fsMatchEvents,
  buildHalfScores,
  delay,
} from "@/lib/flashscore";
import type { MatchedEvent as FsMatchedEvent, FlashscoreStat } from "@/lib/flashscore";
import {
  SPORT_MAP as BE_SPORT_MAP,
  fetchResults as beFetchResults,
  fetchMatchDetail as beFetchMatchDetail,
  matchEvents as beMatchEvents,
} from "@/lib/betexplorer";
import type { MatchedEvent as BeMatchedEvent } from "@/lib/betexplorer";

// ═══════════════════════════════════════════════════
// CRON: Verify results via Flashscore (primary) + BetExplorer (fallback)
// - Flashscore feed API as primary source
// - Events with flashscore_id get direct lookup (skip fuzzy)
// - Unmatched events fall back to BetExplorer (transition period)
// - Updates scores + per-period data
// - Calls settleEvent() with verified data
// - Runs every 5 minutes via crontab
// ═══════════════════════════════════════════════════


// Record last successful run timestamp
async function stampLastRun(sb: any, key: string) {
  await sb.from("system_config").upsert({ key, value: JSON.stringify(new Date().toISOString()) }, { onConflict: "key" });
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const stats = {
    verified: 0,
    settled: 0,
    unmatched: 0,
    fs_matched: 0,
    fs_direct: 0,
    be_fallback: 0,
    fetched_sports: 0,
    total_fs_results: 0,
    errors: [] as string[],
  };

  // 1. Query finished unsettled events (max 100, oldest first)
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select(
      "id, external_id, home_team, away_team, score_home, score_away, starts_at, live_data, sport_id, flashscore_id, sports!inner(name)"
    )
    .eq("status", "finished")
    .is("settled_at", null)
    .order("updated_at", { ascending: true })
    .limit(100);

    await stampLastRun(supabase, "last_run_verify_results");
  if (evErr || !events || events.length === 0) {
    return NextResponse.json({
      ...stats,
      message: events?.length === 0 ? "No finished unsettled events" : evErr?.message,
    });
  }

  // 2. Separate events: those with flashscore_id (direct lookup) vs those needing fuzzy match
  const directEvents: typeof events = [];
  const fuzzyEvents: typeof events = [];

  for (const ev of events) {
    if (ev.flashscore_id) {
      directEvents.push(ev);
    } else {
      fuzzyEvents.push(ev);
    }
  }

  // 3. Process direct-lookup events (have flashscore_id)
  for (const ev of directEvents) {
    try {
      const detail = await fsFetchMatchDetail(ev.flashscore_id!);
      await delay(500);

      if (!detail || detail.status !== "finished") continue;
      if (detail.scoreHome === null || detail.scoreAway === null) continue;

      await processFlashscoreMatch(
        supabase,
        {
          eventId: ev.id,
          externalId: ev.external_id,
          flashscoreId: ev.flashscore_id!,
          fsResult: {
            matchId: ev.flashscore_id!,
            homeTeam: detail.homeTeam,
            awayTeam: detail.awayTeam,
            scoreHome: detail.scoreHome,
            scoreAway: detail.scoreAway,
            periods: detail.periods,
            status: "finished",
            timestamp: detail.timestamp,
            country: "",
            league: "",
            sport: ((ev.sports as any)?.name || "").toLowerCase(),
          },
          matchScore: 2.0, // perfect match (direct lookup)
          dbHomeTeam: ev.home_team,
          dbAwayTeam: ev.away_team,
        },
        ((ev.sports as any)?.name || "").toLowerCase(),
        stats
      );
      stats.fs_direct++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`Direct ${ev.home_team}: ${msg}`);
    }
  }

  // 4. Group fuzzy events by mapped sport (e.g. counter_strike → esports)
  const eventsBySport = new Map<string, typeof events>();
  for (const ev of fuzzyEvents) {
    const sportName = ((ev.sports as any)?.name || "").toLowerCase();
    const mappedSport = FS_SPORT_MAP[sportName];
    if (!mappedSport) continue;
    const group = eventsBySport.get(mappedSport) || [];
    group.push(ev);
    eventsBySport.set(mappedSport, group);
  }

  // 5. For each sport, fetch Flashscore results and match
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const unmatchedEvents: typeof events = [];

  for (const [sportName, sportEvents] of eventsBySport) {
    try {
      // Fetch today + yesterday results from Flashscore
      const todayResults = await fsFetchResults(sportName, today);
      await delay(500);
      const yesterdayResults = await fsFetchResults(sportName, yesterday);
      await delay(500);

      const allFsResults = [...todayResults, ...yesterdayResults];
      stats.fetched_sports++;
      stats.total_fs_results += allFsResults.length;

      if (allFsResults.length === 0) {
        // No FS results — add all to unmatched for BE fallback
        unmatchedEvents.push(...sportEvents);
        continue;
      }

      // Prepare DB events for matching
      const dbEvents = sportEvents.map((ev) => ({
        id: ev.id,
        external_id: ev.external_id,
        home_team: ev.home_team,
        away_team: ev.away_team,
        score_home: ev.score_home,
        score_away: ev.score_away,
        starts_at: ev.starts_at,
        live_data: ev.live_data as Record<string, unknown> | null,
        sport_name: sportName,
        flashscore_id: ev.flashscore_id,
      }));

      // Match events via fuzzy matching
      const matched = fsMatchEvents(dbEvents, allFsResults);
      stats.fs_matched += matched.length;

      // Track unmatched events for BE fallback
      const matchedIds = new Set(matched.map((m) => m.eventId));
      for (const ev of sportEvents) {
        if (!matchedIds.has(ev.id)) {
          unmatchedEvents.push(ev);
        }
      }

      // Process FS matches
      for (const m of matched) {
        try {
          // Save flashscore_id for future direct lookups
          await supabase
            .from("events")
            .update({ flashscore_id: m.flashscoreId })
            .eq("id", m.eventId);

          await processFlashscoreMatch(supabase, m, sportName, stats);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stats.errors.push(`${m.dbHomeTeam} vs ${m.dbAwayTeam}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`FS ${sportName}: ${msg}`);
      // On FS failure, add all sport events to unmatched for BE fallback
      unmatchedEvents.push(...sportEvents);
    }
  }

  // 6. BetExplorer fallback for unmatched events (transition period)
  if (unmatchedEvents.length > 0) {
    await processBetExplorerFallback(supabase, unmatchedEvents, stats);
  }

  // Count unmatched from unsupported sports
  for (const ev of events) {
    const sportName = ((ev.sports as any)?.name || "").toLowerCase();
    if (!FS_SPORT_MAP[sportName] && !BE_SPORT_MAP[sportName]) {
      stats.unmatched++;
    }
  }
  await stampLastRun(supabase, "last_run_verify_results");


  return NextResponse.json({
    ...stats,
    errors: stats.errors.length > 0 ? stats.errors.slice(0, 15) : undefined,
  });
}

// ═══ PROCESS A FLASHSCORE MATCHED EVENT ═══

async function processFlashscoreMatch(
  supabase: SupabaseClient,
  m: FsMatchedEvent,
  sportName: string,
  stats: { verified: number; settled: number; errors: string[] }
) {
  const fs = m.fsResult;

  // Always fetch detail to get stats (and period scores if missing)
  let periods = fs.periods;
  let matchStats: FlashscoreStat[] = [];
  try {
    const detail = await fsFetchMatchDetail(m.flashscoreId);
    if (detail) {
      if (periods.length === 0 && detail.periods.length > 0) {
        periods = detail.periods;
      }
      if (detail.stats.length > 0) {
        matchStats = detail.stats;
      }
    }
    await delay(500);
  } catch {
    // Detail fetch is best-effort
  }

  // Build half scores from periods
  const halfScores = buildHalfScores(sportName, periods);

  // Preserve existing live_data
  const existingLiveData =
    (
      await supabase
        .from("events")
        .select("live_data")
        .eq("id", m.eventId)
        .single()
    ).data?.live_data as Record<string, unknown> | null;

  const updatedLiveData: Record<string, unknown> = {
    ...(existingLiveData || {}),
    verified_by: "flashscore",
    verified_at: new Date().toISOString(),
    flashscore_id: m.flashscoreId,
    match_score: m.matchScore,
  };

  if (halfScores) {
    updatedLiveData.halfScoreHome = halfScores.home;
    updatedLiveData.halfScoreAway = halfScores.away;
  }

  // Persist match stats for settlement (corners, cards, shots)
  if (matchStats.length > 0) {
    updatedLiveData.stats = matchStats;
  }

  // Update event with verified scores
  const { error: updateErr } = await supabase
    .from("events")
    .update({
      score_home: fs.scoreHome,
      score_away: fs.scoreAway,
      live_data: updatedLiveData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", m.eventId);

  if (updateErr) {
    stats.errors.push(
      `Update failed ${m.dbHomeTeam}: ${updateErr.message}`
    );
    return;
  }

  stats.verified++;

  // Settle the event
  const settleRes = await settleEvent(supabase, m.eventId);
  if (settleRes.success) {
    stats.settled++;
  } else if (settleRes.error) {
    stats.errors.push(
      `Settle failed ${m.dbHomeTeam}: ${settleRes.error}`
    );
  }
}

// ═══ BETEXPLORER FALLBACK (transition period) ═══

async function processBetExplorerFallback(
  supabase: SupabaseClient,
  unmatchedEvents: any[],
  stats: {
    verified: number;
    settled: number;
    unmatched: number;
    be_fallback: number;
    errors: string[];
  }
) {
  // Group by sport
  const bySport = new Map<string, typeof unmatchedEvents>();
  for (const ev of unmatchedEvents) {
    const sportName = ((ev.sports as any)?.name || "").toLowerCase();
    if (!BE_SPORT_MAP[sportName]) {
      stats.unmatched++;
      continue;
    }
    const group = bySport.get(sportName) || [];
    group.push(ev);
    bySport.set(sportName, group);
  }

  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const [sportName, sportEvents] of bySport) {
    try {
      const todayResults = await beFetchResults(sportName, today);
      await delay(1000);
      const yesterdayResults = await beFetchResults(sportName, yesterday);
      await delay(1000);

      const allResults = [...todayResults, ...yesterdayResults];
      if (allResults.length === 0) {
        stats.unmatched += sportEvents.length;
        continue;
      }

      const dbEvents = sportEvents.map((ev: any) => ({
        id: ev.id,
        external_id: ev.external_id,
        home_team: ev.home_team,
        away_team: ev.away_team,
        score_home: ev.score_home,
        score_away: ev.score_away,
        starts_at: ev.starts_at,
        live_data: ev.live_data as Record<string, unknown> | null,
        sport_name: sportName,
      }));

      const matched = beMatchEvents(dbEvents, allResults);
      stats.unmatched += sportEvents.length - matched.length;

      for (const m of matched) {
        try {
          await processBetExplorerMatch(supabase, m, sportName, stats);
          stats.be_fallback++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stats.errors.push(`BE ${m.dbHomeTeam}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`BE ${sportName}: ${msg}`);
      stats.unmatched += sportEvents.length;
    }
  }
}

async function processBetExplorerMatch(
  supabase: SupabaseClient,
  m: BeMatchedEvent,
  sportName: string,
  stats: { verified: number; settled: number; errors: string[] }
) {
  const be = m.beResult;

  let periods = be.periods;
  if (periods.length === 0 && be.matchUrl) {
    const detailPeriods = await beFetchMatchDetail(be.matchUrl);
    if (detailPeriods) {
      periods = detailPeriods;
      await delay(1000);
    }
  }

  const halfScores = buildHalfScores(sportName, periods);

  const existingLiveData =
    (
      await supabase
        .from("events")
        .select("live_data")
        .eq("id", m.eventId)
        .single()
    ).data?.live_data as Record<string, unknown> | null;

  const updatedLiveData: Record<string, unknown> = {
    ...(existingLiveData || {}),
    verified_by: "betexplorer",
    verified_at: new Date().toISOString(),
  };

  if (halfScores) {
    updatedLiveData.halfScoreHome = halfScores.home;
    updatedLiveData.halfScoreAway = halfScores.away;
  }

  const { error: updateErr } = await supabase
    .from("events")
    .update({
      score_home: be.scoreHome,
      score_away: be.scoreAway,
      live_data: updatedLiveData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", m.eventId);

  if (updateErr) {
    stats.errors.push(
      `Update failed ${m.dbHomeTeam}: ${updateErr.message}`
    );
    return;
  }

  stats.verified++;

  const settleRes = await settleEvent(supabase, m.eventId);
  if (settleRes.success) {
    stats.settled++;
  } else if (settleRes.error) {
    stats.errors.push(
      `Settle failed ${m.dbHomeTeam}: ${settleRes.error}`
    );
  }
}
