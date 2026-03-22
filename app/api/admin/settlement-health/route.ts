import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

function formatAge(minutes: number | null): string {
  if (minutes === null) return "N/A";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export async function GET() {
  const supabase = createAdminClient();

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

    // ── 9. Verify-results cron — use latest ended event as proxy ──
    // (settlement_log is not actively written by current flow)
    const { data: latestEnded } = await supabase
      .from("events")
      .select("updated_at")
      .eq("source", "kambi")
      .eq("status", "ended")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    const lastEndedAt = latestEnded?.updated_at || null;
    const lastEndedAge = lastEndedAt
      ? Math.round((now.getTime() - new Date(lastEndedAt).getTime()) / 60000)
      : null;

    // ── 10. Ippica settlement health ──
    const { count: ippicaUnsettled } = await supabase
      .from("ippica_odds")
      .select("id", { count: "exact", head: true })
      .is("result", null)
      .eq("status", "active");

    const { data: ippicaFinished } = await supabase
      .from("ippica_races")
      .select("id")
      .eq("status", "finished");

    // Build actor health
    const flashscoreLastPush = latestFixture?.created_at || null;
    const flashscoreAge = flashscoreLastPush
      ? Math.round((now.getTime() - new Date(flashscoreLastPush).getTime()) / 60000)
      : null;

    const healthLogAge = healthLog?.created_at
      ? Math.round((now.getTime() - new Date(healthLog.created_at).getTime()) / 60000)
      : null;

    // Actor statuses
    const actors = {
      flashscore: {
        status: flashscoreAge !== null && flashscoreAge < 120 ? "healthy" : flashscoreAge !== null && flashscoreAge < 360 ? "warning" : "critical",
        last_push: flashscoreLastPush,
        age_minutes: flashscoreAge,
        matched_24h: fsMatched24h || 0,
      },
      verify_results: {
        status: lastEndedAge !== null && lastEndedAge < 15 ? "healthy" : lastEndedAge !== null && lastEndedAge < 60 ? "warning" : "critical",
        last_settlement: lastEndedAt,
        age_minutes: lastEndedAge,
        settled_1h: settled1h || 0,
      },
      cleanup: {
        status: healthLogAge !== null && healthLogAge < 300 ? "healthy" : healthLogAge !== null && healthLogAge < 480 ? "warning" : "critical",
        last_run: healthLog?.created_at || null,
        age_minutes: healthLogAge,
      },
    };

    // ── Health Score 0-100 ──
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
    const stuckCount = (stuckEvents || []).length;

    // Subsystem 1: Flashscore Scraper (weight 25)
    let flashscoreScore = 100;
    if (flashscoreAge === null) flashscoreScore = 0;
    else if (flashscoreAge <= 30) flashscoreScore = 100;
    else if (flashscoreAge >= 360) flashscoreScore = 0;
    else flashscoreScore = 100 - ((flashscoreAge - 30) / 330) * 100;
    flashscoreScore = clamp(flashscoreScore);

    // Subsystem 2: Verify Results (weight 30)
    let verifyScore = 100;
    if (lastEndedAge === null) verifyScore = 0;
    else if (lastEndedAge <= 10) verifyScore = 100;
    else if (lastEndedAge >= 60) verifyScore = 0;
    else verifyScore = 100 - ((lastEndedAge - 10) / 50) * 100;
    // Bonus/penalty based on rate
    const rate1h = settled1h || 0;
    if (rate1h === 0 && lastEndedAge !== null && lastEndedAge > 30) verifyScore = clamp(verifyScore - 30);
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
      flashscore: { score: flashscoreScore, weight: 25, label: "Flashscore Scraper", details: `Età: ${formatAge(flashscoreAge)}` },
      verify_results: { score: verifyScore, weight: 30, label: "Verify Results", details: `Età: ${formatAge(lastEndedAge)}, ${rate1h} settlati/1h` },
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
        unsettled_odds: ippicaUnsettled || 0,
        finished_races: ippicaFinished?.length || 0,
      },
      generated_at: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[settlement-health]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
