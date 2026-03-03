import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent } from "@/lib/settlement";
import {
  matchEvents,
  buildHalfScores,
  SPORT_MAP,
} from "@/lib/flashscore";
import type { FlashscoreResult } from "@/lib/flashscore";

// ═══════════════════════════════════════════════════
// Flashscore Results Endpoint
// Receives results from standalone flashscore-scraper
// Matches with DB events, verifies scores, settles
// ═══════════════════════════════════════════════════

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
    errors: [] as string[],
  };

  // 1. Find finished unsettled events for this sport
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select(
      "id, external_id, home_team, away_team, score_home, score_away, starts_at, live_data, flashscore_id, sports!inner(name)"
    )
    .eq("status", "finished")
    .is("settled_at", null)
    .ilike("sports.name", sport || "%")
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
      stats.errors.push(`${ev.home_team}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Fuzzy match for events without flashscore_id
  const fuzzyEvents = events.filter((ev) => !ev.flashscore_id);
  if (fuzzyEvents.length > 0 && results.length > 0) {
    const dbEvents = fuzzyEvents.map((ev) => ({
      id: ev.id,
      external_id: ev.external_id,
      home_team: ev.home_team,
      away_team: ev.away_team,
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
        // Save flashscore_id
        await supabase
          .from("events")
          .update({ flashscore_id: m.flashscoreId })
          .eq("id", m.eventId);

        const ev = events.find((e) => e.id === m.eventId)!;
        await verifyAndSettle(supabase, ev, m.fsResult, sport, stats);
      } catch (err) {
        stats.errors.push(`${m.dbHomeTeam}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return NextResponse.json({
    ...stats,
    errors: stats.errors.length > 0 ? stats.errors.slice(0, 15) : undefined,
  });
}

async function verifyAndSettle(
  supabase: any,
  ev: any,
  fsResult: FlashscoreResult,
  sport: string,
  stats: { verified: number; settled: number; errors: string[] }
) {
  const halfScores = buildHalfScores(sport, fsResult.periods);

  const existingLiveData =
    (
      await supabase
        .from("events")
        .select("live_data")
        .eq("id", ev.id)
        .single()
    ).data?.live_data as Record<string, unknown> | null;

  const updatedLiveData: Record<string, unknown> = {
    ...(existingLiveData || {}),
    verified_by: "flashscore",
    verified_at: new Date().toISOString(),
    flashscore_id: fsResult.matchId,
  };

  if (halfScores) {
    updatedLiveData.halfScoreHome = halfScores.home;
    updatedLiveData.halfScoreAway = halfScores.away;
  }

  const { error: updateErr } = await supabase
    .from("events")
    .update({
      score_home: fsResult.scoreHome,
      score_away: fsResult.scoreAway,
      live_data: updatedLiveData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ev.id);

  if (updateErr) {
    stats.errors.push(`Update ${ev.home_team}: ${updateErr.message}`);
    return;
  }

  stats.verified++;

  const settleRes = await settleEvent(supabase, ev.id);
  if (settleRes.success) {
    stats.settled++;
  } else if (settleRes.error) {
    stats.errors.push(`Settle ${ev.home_team}: ${settleRes.error}`);
  }
}
