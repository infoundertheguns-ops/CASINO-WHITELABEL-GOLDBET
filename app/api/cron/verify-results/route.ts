import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent } from "@/lib/settlement";
import {
  SPORT_MAP,
  fetchResults,
  fetchMatchDetail,
  matchEvents,
  buildHalfScores,
  delay,
} from "@/lib/betexplorer";
import type { MatchedEvent } from "@/lib/betexplorer";

// ═══════════════════════════════════════════════════
// CRON: Verify results via BetExplorer + settle
// - Scrapes BetExplorer for verified match results
// - Matches against finished unsettled events
// - Updates scores + per-period data
// - Calls settleEvent() with verified data
// - Runs every 5 minutes via crontab
// ═══════════════════════════════════════════════════

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
    fetched_sports: 0,
    total_be_results: 0,
    errors: [] as string[],
  };

  // 1. Query finished unsettled events (max 100, oldest first)
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select(
      "id, external_id, home_team, away_team, score_home, score_away, starts_at, live_data, sport_id, sports!inner(name)"
    )
    .eq("status", "finished")
    .is("settled_at", null)
    .order("updated_at", { ascending: true })
    .limit(100);

  if (evErr || !events || events.length === 0) {
    return NextResponse.json({
      ...stats,
      message: events?.length === 0 ? "No finished unsettled events" : evErr?.message,
    });
  }

  // 2. Group events by sport
  const eventsBySport = new Map<string, typeof events>();
  for (const ev of events) {
    const sportName = ((ev.sports as any)?.name || "").toLowerCase();
    if (!SPORT_MAP[sportName]) continue; // Skip unsupported sports
    const group = eventsBySport.get(sportName) || [];
    group.push(ev);
    eventsBySport.set(sportName, group);
  }

  // 3. For each sport, fetch BetExplorer results and match
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const [sportName, sportEvents] of eventsBySport) {
    try {
      // Fetch today's results
      const todayResults = await fetchResults(sportName, today);
      await delay(1000); // Rate limit: 1 req/sec

      // Fetch yesterday's results (events might have started yesterday)
      const yesterdayResults = await fetchResults(sportName, yesterday);
      await delay(1000);

      const allResults = [...todayResults, ...yesterdayResults];
      stats.fetched_sports++;
      stats.total_be_results += allResults.length;

      if (allResults.length === 0) continue;

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
      }));

      // Match events
      const matched = matchEvents(dbEvents, allResults);
      stats.unmatched += sportEvents.length - matched.length;

      // Process matches
      for (const m of matched) {
        try {
          await processMatch(supabase, m, sportName, stats);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stats.errors.push(`${m.dbHomeTeam} vs ${m.dbAwayTeam}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`${sportName}: ${msg}`);
    }
  }

  // Count unmatched from unsupported sports
  for (const ev of events) {
    const sportName = ((ev.sports as any)?.name || "").toLowerCase();
    if (!SPORT_MAP[sportName]) stats.unmatched++;
  }

  return NextResponse.json({
    ...stats,
    errors: stats.errors.length > 0 ? stats.errors.slice(0, 15) : undefined,
  });
}

// ═══ PROCESS A MATCHED EVENT ═══

async function processMatch(
  supabase: SupabaseClient,
  m: MatchedEvent,
  sportName: string,
  stats: { verified: number; settled: number; errors: string[] }
) {
  const be = m.beResult;

  // If no period scores from results page, try detail page
  let periods = be.periods;
  if (periods.length === 0 && be.matchUrl) {
    const detailPeriods = await fetchMatchDetail(be.matchUrl);
    if (detailPeriods) {
      periods = detailPeriods;
      await delay(1000);
    }
  }

  // Build half scores from periods
  const halfScores = buildHalfScores(sportName, periods);

  // Prepare live_data update
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

  // Update event with verified scores
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
