export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Sprint 4 / Phase 1.A bis — restructured for OddsAPI + Flashscore-only architecture.
// OddsAPI    → events_v2 + markets_v2 + outcomes_v2 (events/markets/odds)
// Flashscore → events_v2.live_data + status='settled' + last_settled_at (ALL bet settlement)
//
// Phase 1.A ter (2026-05-12): legacy bet_selections/bets tables DROPPED in big-bang.
// Removed bet_settlement_lag + bet_settlement_rate subsystems and pending_selections block.
// Remaining subsystems: flashscore_scraper (25) + event_settlement_lag (25)
//                    + event_settlement_rate (15) + live_fs_coverage (15) = 80 total weight.

function formatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "N/A";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function lerpScore(value: number, goodThreshold: number, badThreshold: number): number {
  if (value <= goodThreshold) return 100;
  if (value >= badThreshold) return 0;
  return clamp(100 - ((value - goodThreshold) / (badThreshold - goodThreshold)) * 100);
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
    const nowMs = now.getTime();
    const oneHourAgoIso = new Date(nowMs - 3600_000).toISOString();
    const threeHoursAgoIso = new Date(nowMs - 3 * 3600_000).toISOString();
    const threeAndHalfHoursAgoIso = new Date(nowMs - 3.5 * 3600_000).toISOString();
    const todayStartIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    // ── 1. Cron timestamps from system_config ───────────────────────────────
    const { data: cronRows } = await supabase
      .from("system_config")
      .select("key, value")
      .like("key", "last_run_%");

    const cronTs: Record<string, string | null> = {};
    for (const row of cronRows || []) {
      try {
        const parsed = JSON.parse((row as any).value);
        if (typeof parsed === "string") cronTs[(row as any).key] = parsed;
        else if (parsed && typeof parsed === "object" && typeof parsed.ts === "string") cronTs[(row as any).key] = parsed.ts;
        else cronTs[(row as any).key] = null;
      } catch {
        cronTs[(row as any).key] = null;
      }
    }

    const fsResultsTs = cronTs["last_run_flashscore_results"] || null;
    const fsFixturesTs = cronTs["last_run_flashscore_fixtures"] || null;
    const settlementCronTs = cronTs["last_run_settlement_shadow"] || cronTs["last_run_settlement"] || cronTs["last_run_verify_results"] || null;

    const fsCronAgeSec = fsResultsTs ? Math.round((nowMs - new Date(fsResultsTs).getTime()) / 1000) : null;
    const settlementCronAgeMin = settlementCronTs ? Math.round((nowMs - new Date(settlementCronTs).getTime()) / 60000) : null;

    // ── 2. FS data freshness ────────────────────────────────────────────────
    const { data: latestLive } = await supabase
      .from("events_v2")
      .select("updated_at")
      .eq("status", "live")
      .order("updated_at", { ascending: false })
      .limit(1);
    const fsDataFreshnessSec = latestLive?.[0]
      ? Math.round((nowMs - new Date((latestLive[0] as any).updated_at).getTime()) / 1000)
      : null;

    // ── 3. Event settlement: pending, stuck, recent rate ────────────────────
    const { count: eventsPendingSettlement } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .lt("starts_at", threeHoursAgoIso)
      .in("status", ["live", "pending"]);

    const { count: liveEventsCount } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .eq("status", "live");

    const { count: liveTrackedCount } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .eq("status", "live")
      .not("flashscore_id", "is", null);

    const { count: phantomLiveCount } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .eq("status", "live")
      .is("flashscore_id", null);

    const { data: phantomRows } = await supabase
      .from("events_v2")
      .select("id, sport_slug, league_name, home, away, starts_at, updated_at")
      .eq("status", "live")
      .is("flashscore_id", null)
      .order("starts_at", { ascending: false })
      .limit(20);

    const phantomLiveEvents = (phantomRows || []).map((e: any) => {
      const startMs = new Date(e.starts_at).getTime();
      const minutesSinceKickoff = Math.round((nowMs - startMs) / 60000);
      return {
        id: e.id,
        sport_slug: e.sport_slug || null,
        league_name: e.league_name || null,
        match: `${e.home} vs ${e.away}`,
        starts_at: e.starts_at,
        minutes_since_kickoff: minutesSinceKickoff,
        last_updated_at: e.updated_at,
      };
    });

    const { count: eventsSettledLastHour } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .eq("status", "settled")
      .gte("last_settled_at", oneHourAgoIso);

    const { count: eventsSettledToday } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .eq("status", "settled")
      .gte("last_settled_at", todayStartIso);

    const { data: stuckRows } = await supabase
      .from("events_v2")
      .select("id, home, away, sport_name, starts_at, updated_at")
      .lt("starts_at", threeAndHalfHoursAgoIso)
      .in("status", ["live", "pending"])
      .order("starts_at", { ascending: true })
      .limit(20);

    const stuckEvents = (stuckRows || []).map((e: any) => {
      const startMs = new Date(e.starts_at).getTime();
      const stuckMinutes = Math.round((nowMs - startMs) / 60000);
      return {
        id: e.id,
        match: `${e.home} vs ${e.away}`,
        sport: e.sport_name || "?",
        starts_at: e.starts_at,
        fs_ended_since: e.updated_at,
        stuck_minutes: stuckMinutes,
      };
    });

    // ── 4. Recent settlements (top 10) ──────────────────────────────────────
    const { data: recentRows } = await supabase
      .from("events_v2")
      .select("id, home, away, score_home, score_away, sport_name, last_settled_at")
      .eq("status", "settled")
      .order("last_settled_at", { ascending: false })
      .limit(10);

    const recentSettlements = (recentRows || []).map((e: any) => ({
      id: e.id,
      match: `${e.home} vs ${e.away}`,
      sport: e.sport_name || "?",
      score: e.score_home != null && e.score_away != null ? `${e.score_home}-${e.score_away}` : null,
      settled_at: e.last_settled_at,
    }));

    // ── 5. Coverage by sport (via SQL function) ─────────────────────────────
    let coverageBySport: any[] = [];
    let coverageTotal = {
      events_total: 0,
      events_fs_trackable: 0,
      fs_trackable_pct: 0,
      prematch_markets: 0,
      live_markets: 0,
      score_markets: 0,
      stats_markets: 0,
      player_markets: 0,
    };

    const { data: covRows, error: covErr } = await supabase.rpc("settlement_health_coverage");
    if (covErr) {
      console.error("[settlement-health] coverage rpc error", covErr);
    } else {
      coverageBySport = (covRows || [])
        .map((r: any) => {
          const events_total = Number(r.events_total) || 0;
          const events_fs_trackable = Number(r.events_fs_trackable) || 0;
          return {
            sport_slug: r.sport_slug,
            events_total,
            events_fs_trackable,
            fs_trackable_pct: events_total > 0 ? Math.round((events_fs_trackable * 100) / events_total) : 0,
            prematch_markets: Number(r.prematch_markets) || 0,
            live_markets: Number(r.live_markets) || 0,
            score_markets: Number(r.score_markets) || 0,
            stats_markets: Number(r.stats_markets) || 0,
            player_markets: Number(r.player_markets) || 0,
          };
        })
        .sort(
          (a: any, b: any) =>
            (b.prematch_markets + b.live_markets) - (a.prematch_markets + a.live_markets)
        );

      for (const r of coverageBySport) {
        coverageTotal.events_total += r.events_total;
        coverageTotal.events_fs_trackable += r.events_fs_trackable;
        coverageTotal.prematch_markets += r.prematch_markets;
        coverageTotal.live_markets += r.live_markets;
        coverageTotal.score_markets += r.score_markets;
        coverageTotal.stats_markets += r.stats_markets;
        coverageTotal.player_markets += r.player_markets;
      }
      coverageTotal.fs_trackable_pct =
        coverageTotal.events_total > 0
          ? Math.round((coverageTotal.events_fs_trackable * 100) / coverageTotal.events_total)
          : 0;
    }

    // ── 6. Subsystem scoring ───────────────────────────────────────────────
    let flashscoreScraperScore: number;
    if (fsCronAgeSec === null) flashscoreScraperScore = 0;
    else {
      const cronScore = lerpScore(fsCronAgeSec, 60, 300);
      const dataScore = fsDataFreshnessSec === null
        ? 100
        : lerpScore(fsDataFreshnessSec, 120, 600);
      flashscoreScraperScore = Math.min(cronScore, dataScore);
    }

    const pendingCount = eventsPendingSettlement || 0;
    const eventSettlementLagScore = lerpScore(pendingCount, 0, 20);

    const settledLastHour = eventsSettledLastHour || 0;
    let eventSettlementRateScore: number;
    if ((liveEventsCount || 0) === 0) eventSettlementRateScore = 100;
    else if (settledLastHour >= 30) eventSettlementRateScore = 100;
    else if (settledLastHour === 0) eventSettlementRateScore = 0;
    else eventSettlementRateScore = clamp((settledLastHour / 30) * 100);

    const totalLive = liveEventsCount || 0;
    const trackedLive = liveTrackedCount || 0;
    const phantomLive = phantomLiveCount || 0;
    const liveCoveragePct = totalLive > 0 ? Math.round((trackedLive * 100) / totalLive) : 100;
    let liveFsCoverageScore: number;
    if (totalLive === 0) liveFsCoverageScore = 100;
    else if (liveCoveragePct < 85) liveFsCoverageScore = 0;
    else liveFsCoverageScore = clamp(((liveCoveragePct - 85) / 15) * 100);

    const subsystems = {
      flashscore_scraper: {
        score: flashscoreScraperScore,
        weight: 25,
        label: "Flashscore Scraper",
        details: `Cron ${formatAge(fsCronAgeSec)}, dati ${formatAge(fsDataFreshnessSec)}`,
      },
      event_settlement_lag: {
        score: eventSettlementLagScore,
        weight: 25,
        label: "Event Settlement Lag",
        details: `${pendingCount} events FS-ended pending`,
      },
      event_settlement_rate: {
        score: eventSettlementRateScore,
        weight: 15,
        label: "Event Settlement Rate",
        details: `${settledLastHour}/h`,
      },
      live_fs_coverage: {
        score: liveFsCoverageScore,
        weight: 15,
        label: "Live FS Coverage",
        details: totalLive === 0
          ? "no live events"
          : `${trackedLive}/${totalLive} live events FS-tracked (${liveCoveragePct}%)`,
      },
    };

    const totalWeight = Object.values(subsystems).reduce((s, sub) => s + sub.weight, 0);
    const healthScore = clamp(
      Object.values(subsystems).reduce((s, sub) => s + sub.score * sub.weight, 0) / totalWeight
    );
    const overall: "ok" | "warning" | "critical" =
      healthScore >= 80 ? "ok" : healthScore >= 50 ? "warning" : "critical";

    const flashscoreAgeMin = fsCronAgeSec !== null ? Math.round(fsCronAgeSec / 60) : null;
    const actors = {
      flashscore: {
        status: flashscoreScraperScore >= 80 ? "healthy" : flashscoreScraperScore >= 50 ? "warning" : "critical",
        last_push: fsResultsTs,
        age_minutes: flashscoreAgeMin,
        cron_age_minutes: flashscoreAgeMin,
      },
    };

    return NextResponse.json({
      overall,
      health_score: healthScore,
      subsystems,
      metrics: {
        events_pending_settlement: pendingCount,
        events_settled_last_hour: settledLastHour,
        events_settled_today: eventsSettledToday || 0,
        fs_scraper_cron_age_seconds: fsCronAgeSec,
        fs_data_freshness_seconds: fsDataFreshnessSec,
        settlement_cron_last_run: settlementCronTs,
        settlement_cron_age_minutes: settlementCronAgeMin,
        live_events_count: liveEventsCount || 0,
        live_events_tracked: trackedLive,
        live_events_phantom: phantomLive,
        live_fs_coverage_pct: liveCoveragePct,
        fs_fixtures_cron_ts: fsFixturesTs,
      },
      coverage_by_sport: coverageBySport,
      coverage_total: coverageTotal,
      stuck_events: stuckEvents,
      phantom_live_events: phantomLiveEvents,
      recent_settlements: recentSettlements,
      actors,
      backlog: pendingCount,
      rates: {
        last_1h: settledLastHour,
        last_6h: settledLastHour,
        last_24h: eventsSettledToday || 0,
      },
      generated_at: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[settlement-health]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
