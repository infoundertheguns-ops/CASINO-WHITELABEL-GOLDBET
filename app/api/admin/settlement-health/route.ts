import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

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

    // ── 5. Settlement log (recent entries) ──
    const { data: recentSettlement } = await supabase
      .from("settlement_log")
      .select("*")
      .order("created_at", { ascending: false })
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
    const { data: healthLog } = await supabase
      .from("system_health_log")
      .select("created_at, data")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

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

    // Overall health
    const statuses = [actors.flashscore.status, actors.verify_results.status, actors.cleanup.status];
    const overallHealth = statuses.includes("critical") ? "critical"
      : statuses.includes("warning") ? "warning" : "healthy";

    return NextResponse.json({
      overall: overallHealth,
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
      recent_settlements: (recentSettlement || []).map((s: any) => ({
        event_id: s.event_id,
        created_at: s.created_at,
        markets_settled: s.markets_settled,
        bets_settled: s.bets_settled,
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
