export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function formatAge(minutes: number | null): string {
  if (minutes === null) return "N/A";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      global: {
        fetch: (url: any, options: any = {}) =>
          fetch(url, { ...options, cache: "no-store" }),
      },
    }
  );

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000).toISOString();
    const sixHoursAgo = new Date(now.getTime() - 6 * 3600000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600000).toISOString();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60000).toISOString();

    // ── 1. Backlog: finished events waiting for settlement ──
    const { count: backlog } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("source", "kambi")
      .eq("status", "finished");

    // ── 2. Stuck events: finished > 30 min ago ──
    const { data: stuckEvents } = await supabase
      .from("events")
      .select("id, home_team, away_team, starts_at, updated_at, sport_id, sports!inner(name)")
      .eq("source", "kambi")
      .eq("status", "finished")
      .lt("updated_at", thirtyMinAgo)
      .order("updated_at", { ascending: true })
      .limit(20);

    // ── 3. Settlement rates (ended events in timeframes) ──
    const { count: settled1h } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("source", "kambi")
      .eq("status", "ended")
      .gte("updated_at", oneHourAgo);

    const { count: settled6h } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("source", "kambi")
      .eq("status", "ended")
      .gte("updated_at", sixHoursAgo);

    const { count: settled24h } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("source", "kambi")
      .eq("status", "ended")
      .gte("updated_at", twentyFourHoursAgo);

    // ── 4. Flashscore scraper health ──
    // Check latest fixtures push
    const { data: latestFixture } = await supabase
      .from("be_fixtures")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Count recent results from Flashscore (events with flashscore_id that are ended)
    const { count: fsMatched24h } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("source", "kambi")
      .eq("status", "ended")
      .not("flashscore_id", "is", null)
      .gte("updated_at", twentyFourHoursAgo);

    // ── 5. Recent settlements — use ended events as the real log ──
    const { data: recentSettled } = await supabase
      .from("events")
      .select("id, home_team, away_team, score_home, score_away, updated_at, sports!inner(name)")
      .eq("source", "kambi")
      .eq("status", "ended")
      .order("updated_at", { ascending: false })
      .limit(20);

    // ── 6. Backlog by sport ──
    const { data: backlogBySport } = await supabase
      .from("events")
      .select("id, sports!inner(name)")
      .eq("source", "kambi")
      .eq("status", "finished");

    const sportBacklog: Record<string, number> = {};
    for (const e of (backlogBySport || [])) {
      const name = (e as any).sports?.name || "?";
      sportBacklog[name] = (sportBacklog[name] || 0) + 1;
    }

    // ── 7. Avg settlement time (last 100 ended events) ──
    const { data: recentEnded } = await supabase
      .from("events")
      .select("starts_at, updated_at")
      .eq("source", "kambi")
      .eq("status", "ended")
      .order("updated_at", { ascending: false })
      .limit(100);

    let avgSettlementMin = 0;
    if (recentEnded && recentEnded.length > 0) {
      const diffs = recentEnded.map(e => {
        const start = new Date(e.starts_at).getTime();
        const end = new Date(e.updated_at).getTime();
        return (end - start) / 60000; // minutes
      }).filter(d => d > 0 && d < 1440); // exclude outliers > 24h

      if (diffs.length > 0) {
        avgSettlementMin = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }
    }

    // ── 8. Cleanup cron health — check system_health_log ──
    const { data: healthLogRows } = await supabase
      .from("system_health_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    const healthLog = healthLogRows?.[0] || null;

    // ── Real cron execution timestamps from system_config ──
    const { data: cronTimestamps } = await supabase
      .from("system_config")
      .select("key, value")
      .in("key", ["last_run_verify_results", "last_run_cleanup", "last_run_flashscore_results", "last_run_flashscore_fixtures"]);

    const cronTs: Record<string, string | null> = {};
    for (const row of cronTimestamps || []) {
      try { cronTs[row.key] = JSON.parse(row.value) || null; } catch { cronTs[row.key] = null; }
    }

    // ── 9. Verify-results cron — separate cron freshness from settlement activity ──
    const { data: latestEnded } = await supabase
      .from("events")
      .select("updated_at")
      .eq("source", "kambi")
      .eq("status", "ended")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    // Cron execution freshness (is the cron running?)
    const verifyCronTs = cronTs["last_run_verify_results"] || null;
    const verifyCronAge = verifyCronTs
      ? Math.round((now.getTime() - new Date(verifyCronTs).getTime()) / 60000)
      : null;

    // Last actual settlement (when was the last event settled?)
    const lastSettlementTs = latestEnded?.updated_at || null;
    const lastSettlementAge = lastSettlementTs
      ? Math.round((now.getTime() - new Date(lastSettlementTs).getTime()) / 60000)
      : null;

    // For display/actor status, prefer cron timestamp
    const verifyLastRun = verifyCronTs || lastSettlementTs || null;
    const lastEndedAge = verifyCronAge ?? lastSettlementAge;

    // ── 10. Ippica settlement health ──
    // Count unsettled odds ONLY on finished races (not scheduled/closed/active)
    const { data: ippicaFinishedRaces } = await supabase
      .from("ippica_races")
      .select("id")
      .eq("status", "finished");

    const finishedRaceIds = (ippicaFinishedRaces || []).map(r => r.id);
    let ippicaUnsettled = 0;
    if (finishedRaceIds.length > 0) {
      // Get market IDs for finished races
      const { data: finishedMarkets } = await supabase
        .from("ippica_markets")
        .select("id")
        .in("race_id", finishedRaceIds);
      const fmIds = (finishedMarkets || []).map(m => m.id);
      if (fmIds.length > 0) {
        const { count } = await supabase
          .from("ippica_odds")
          .select("id", { count: "exact", head: true })
          .in("market_id", fmIds)
          .is("result", null)
          .eq("status", "active");
        ippicaUnsettled = count || 0;
      }
    }

    // Count active (upcoming) races and odds separately
    const { count: ippicaActiveOdds } = await supabase
      .from("ippica_odds")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("result", null);

    const ippicaFinished = ippicaFinishedRaces;

    // Build actor health
    // Use real cron timestamp if available, fallback to fixture created_at
    const flashscoreLastRun = cronTs["last_run_flashscore_results"] || cronTs["last_run_flashscore_fixtures"] || latestFixture?.created_at || null;
    const flashscoreAge = flashscoreLastRun
      ? Math.round((now.getTime() - new Date(flashscoreLastRun).getTime()) / 60000)
      : null;

    const cleanupLastRun = cronTs["last_run_cleanup"] || healthLog?.created_at || null;
    const healthLogAge = cleanupLastRun
      ? Math.round((now.getTime() - new Date(cleanupLastRun).getTime()) / 60000)
      : null;

    // Pre-compute cron freshness for use in both actors and scoring
    const fsCronAge = cronTs["last_run_flashscore_results"]
      ? Math.round((now.getTime() - new Date(cronTs["last_run_flashscore_results"]).getTime()) / 60000)
      : flashscoreAge; // fallback to data age

    // Actor statuses — based on cron freshness, not data age
    const actors = {
      flashscore: {
        status: fsCronAge !== null && fsCronAge < 15 ? "healthy" : fsCronAge !== null && fsCronAge < 120 ? "warning" : "critical",
        last_push: flashscoreLastRun,
        age_minutes: flashscoreAge,
        cron_age_minutes: fsCronAge,
        matched_24h: fsMatched24h || 0,
        interval_minutes: 60,
        next_in_minutes: flashscoreAge !== null ? Math.max(0, 60 - flashscoreAge) : null,
      },
      verify_results: {
        status: verifyCronAge !== null && verifyCronAge < 10 ? "healthy" : verifyCronAge !== null && verifyCronAge < 30 ? "warning" : "critical",
        last_settlement: lastSettlementTs,
        last_cron_run: verifyCronTs,
        age_minutes: lastEndedAge,
        cron_age_minutes: verifyCronAge,
        settlement_age_minutes: lastSettlementAge,
        settled_1h: settled1h || 0,
        interval_minutes: 5,
        next_in_minutes: verifyCronAge !== null ? Math.max(0, 5 - verifyCronAge) : null,
      },
      cleanup: {
        status: healthLogAge !== null && healthLogAge < 300 ? "healthy" : healthLogAge !== null && healthLogAge < 480 ? "warning" : "critical",
        last_run: cleanupLastRun,
        age_minutes: healthLogAge,
        interval_minutes: 240,
        next_in_minutes: healthLogAge !== null ? Math.max(0, 240 - healthLogAge) : null,
      },
    };

    // ── Health Score 0-100 ──
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
    const stuckCount = (stuckEvents || []).length;

    // Subsystem 1: Flashscore Scraper (weight 25)
    let flashscoreScore = 100;
    if (fsCronAge === null) flashscoreScore = 0;
    else if (fsCronAge <= 15) flashscoreScore = 100;
    else if (fsCronAge >= 120) flashscoreScore = 0;
    else flashscoreScore = 100 - ((fsCronAge - 15) / 105) * 100;
    flashscoreScore = clamp(flashscoreScore);

    // Subsystem 2: Verify Results (weight 30)
    // Two-dimensional: cron must be running + pipeline must be clearing work
    const rate1h = settled1h || 0;
    const bl_ = backlog || 0;
    let verifyScore = 100;

    if (verifyCronAge === null) {
      // Cron never ran — critical
      verifyScore = 0;
    } else if (verifyCronAge <= 10 && bl_ === 0 && stuckCount === 0) {
      // Cron is fresh, no backlog, no stuck → pipeline is healthy (nothing to do = OK)
      verifyScore = 100;
    } else if (verifyCronAge > 15) {
      // Cron is stale — real problem: cron not running
      if (verifyCronAge >= 120) verifyScore = 0;
      else verifyScore = 100 - ((verifyCronAge - 15) / 105) * 100;
    } else {
      // Cron is running but there may be work piling up
      // Score based on backlog + stuck (already covered by subsystems 3 & 4)
      // Only penalize here if settlement rate dropped while backlog exists
      if (bl_ > 50 && rate1h === 0) verifyScore = 40;
      else if (bl_ > 20 && rate1h === 0) verifyScore = 70;
      else verifyScore = 100;
    }
    verifyScore = clamp(verifyScore);

    // Subsystem 3: Backlog (weight 30)
    const bl = backlog || 0;
    let backlogScore = 100;
    if (bl <= 20) backlogScore = 100;
    else if (bl >= 500) backlogScore = 0;
    else backlogScore = 100 - ((bl - 20) / 480) * 100;
    backlogScore = clamp(backlogScore);

    // Subsystem 4: Stuck Events (weight 15)
    let stuckScore = 100;
    if (stuckCount === 0) stuckScore = 100;
    else if (stuckCount >= 20) stuckScore = 0;
    else stuckScore = 100 - (stuckCount / 20) * 100;
    stuckScore = clamp(stuckScore);

    const subsystems = {
      flashscore: { score: flashscoreScore, weight: 25, label: "Flashscore Scraper", details: `Cron: ${formatAge(fsCronAge)}, dati: ${formatAge(flashscoreAge)}` },
      verify_results: { score: verifyScore, weight: 30, label: "Verify Results", details: `Cron: ${formatAge(verifyCronAge)}, ultimo settle: ${formatAge(lastSettlementAge)}, ${rate1h}/1h` },
      backlog: { score: backlogScore, weight: 30, label: "Backlog", details: `${bl} eventi in attesa` },
      stuck: { score: stuckScore, weight: 15, label: "Stuck Events", details: `${stuckCount} stuck > 30 min` },
    };

    const totalWeight = Object.values(subsystems).reduce((s, sub) => s + sub.weight, 0);
    const overallScore = clamp(
      Object.values(subsystems).reduce((s, sub) => s + sub.score * sub.weight, 0) / totalWeight
    );
    const overallLevel = overallScore >= 80 ? "healthy" : overallScore >= 50 ? "degraded" : "critical";

    // Overall health (legacy field)
    const statuses = [actors.flashscore.status, actors.verify_results.status, actors.cleanup.status];
    const overallHealth = statuses.includes("critical") ? "critical"
      : statuses.includes("warning") ? "warning" : "healthy";

    return NextResponse.json({
      overall: overallHealth,
      health_score: overallScore,
      health_level: overallLevel,
      subsystems,
      backlog: backlog || 0,
      stuck_events: (stuckEvents || []).map((e: any) => ({
        id: e.id,
        match: `${e.home_team} vs ${e.away_team}`,
        sport: e.sports?.name,
        starts_at: e.starts_at,
        finished_since: e.updated_at,
        stuck_minutes: Math.round((now.getTime() - new Date(e.updated_at).getTime()) / 60000),
      })),
      rates: {
        last_1h: settled1h || 0,
        last_6h: settled6h || 0,
        last_24h: settled24h || 0,
      },
      avg_settlement_minutes: avgSettlementMin,
      backlog_by_sport: sportBacklog,
      actors,
      recent_settlements: (recentSettled || []).map((e: any) => ({
        event_id: e.id,
        match: `${e.home_team} vs ${e.away_team}`,
        score: e.score_home != null ? `${e.score_home}-${e.score_away}` : null,
        sport: e.sports?.name || "?",
        settled_at: e.updated_at,
      })),
      ippica: {
        unsettled_odds: ippicaUnsettled,
        pending_odds: (ippicaActiveOdds || 0) - ippicaUnsettled,
        finished_races: ippicaFinished?.length || 0,
      },
      generated_at: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[settlement-health]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
