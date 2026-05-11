export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Sprint 4 / Phase 1.A bis — restructured for OddsAPI + Flashscore-only architecture.
// OddsAPI    → events_v2 + markets_v2 + outcomes_v2 (events/markets/odds)
// Flashscore → events_v2.live_data + status='settled' + last_settled_at (ALL bet settlement)
//
// Notes on semantic decisions:
// - "FS reports event ended": probe revealed live_data has no explicit final/status/period='finished'
//   field. The FS scraper atomically sets events_v2.status='settled' + last_settled_at when it
//   sees the match end. Therefore "events_pending_settlement" is operationally defined as
//   events whose kickoff is well past but status is still 'live' or 'pending' (heuristic
//   threshold: starts_at < now() - 3h, status NOT IN ('settled','cancelled')).
// - "stuck": same condition with starts_at < now() - 3.5h (i.e. > 30 min beyond the typical
//   settle window for a 3h match).

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
  // value <= goodThreshold → 100; value >= badThreshold → 0; linear in between.
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

    // ── 2. FS data freshness — most recent live_data update on a live event ─
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
    // "Pending settlement": event kickoff was > 3h ago but status still live/pending.
    const { count: eventsPendingSettlement } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .lt("starts_at", threeHoursAgoIso)
      .in("status", ["live", "pending"]);

    // Live events count (used to suppress rate metric when there's no work).
    const { count: liveEventsCount } = await supabase
      .from("events_v2")
      .select("id", { count: "exact", head: true })
      .eq("status", "live");

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

    // Top 20 stuck events (>30 min beyond typical 3h game = starts_at < now - 3.5h)
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
        fs_ended_since: e.updated_at, // proxy: last DB touch
        stuck_minutes: stuckMinutes,
      };
    });

    // ── 4. Customer bet settlement ──────────────────────────────────────────
    const { count: selectionsPending } = await supabase
      .from("bet_selections")
      .select("id", { count: "exact", head: true })
      .is("result", null);

    const { count: selectionsSettledLastHour } = await supabase
      .from("bet_selections")
      .select("id", { count: "exact", head: true })
      .not("result", "is", null)
      .gte("settled_at", oneHourAgoIso);

    const { count: betsPendingPayout } = await supabase
      .from("bets")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");

    // Top 10 oldest pending selections (with join to event for match string).
    const { data: pendingSelRows } = await supabase
      .from("bet_selections")
      .select("id, bet_id, outcome_id, event_id, settled_at")
      .is("result", null)
      .order("id", { ascending: true })
      .limit(10);

    // For each pending selection, try to enrich with event match label.
    const eventIds = Array.from(
      new Set((pendingSelRows || []).map((s: any) => s.event_id).filter(Boolean))
    );
    let evMap: Record<string, { home: string; away: string }> = {};
    if (eventIds.length > 0) {
      const { data: evs } = await supabase
        .from("events_v2")
        .select("id, home, away")
        .in("id", eventIds);
      for (const e of evs || []) {
        evMap[(e as any).id] = { home: (e as any).home, away: (e as any).away };
      }
    }

    // Approximate "pending_since" via bets.created_at? bet_selections has no created_at.
    // Use bets.updated_at (or fall back to now) for an age proxy.
    const betIds = Array.from(
      new Set((pendingSelRows || []).map((s: any) => s.bet_id).filter(Boolean))
    );
    let betMap: Record<string, { updated_at: string }> = {};
    if (betIds.length > 0) {
      const { data: bs } = await supabase
        .from("bets")
        .select("id, updated_at")
        .in("id", betIds);
      for (const b of bs || []) {
        betMap[(b as any).id] = { updated_at: (b as any).updated_at };
      }
    }

    const pendingSelections = (pendingSelRows || []).map((s: any) => {
      const ev = s.event_id ? evMap[s.event_id] : null;
      const pendingSinceRaw = (s.bet_id && betMap[s.bet_id]?.updated_at) || s.settled_at || null;
      const pendingSinceMs = pendingSinceRaw ? new Date(pendingSinceRaw).getTime() : nowMs;
      return {
        id: s.id,
        bet_id: s.bet_id,
        outcome_id: s.outcome_id,
        event_id: s.event_id,
        match: ev ? `${ev.home} vs ${ev.away}` : "(legacy event)",
        pending_since: pendingSinceRaw,
        pending_minutes: Math.max(0, Math.round((nowMs - pendingSinceMs) / 60000)),
      };
    });

    // ── 5. Recent settlements (top 10) ──────────────────────────────────────
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

    // ── 6. Coverage by sport (via v_player_markets) ─────────────────────────
    // Use raw SQL via rpc-style query: we wrap in a subquery so we can ORDER BY computed sum.
    // Supabase JS doesn't expose .from() arithmetic ordering — fetch grouped raw rows and reduce in JS.
    // We replicate the verified prod query verbatim, executed as a stored-style call via .rpc is overkill;
    // use the PostgREST endpoint that lets us select from v_player_markets and aggregate in JS.
    //
    // Strategy: pull (sport_slug, event_id, flashscore_id, event_status, category) rows from
    // v_player_markets joined with events_v2 via PostgREST — but PostgREST can't FILTER+aggregate
    // the way we want efficiently. Instead, we use a custom SQL function call via `supabase.rpc()`
    // if available, OR fall back to a direct fetch of /rest/v1/rpc.
    //
    // For simplicity and correctness, we'll fetch raw rows and aggregate. Volume: ~200k markets,
    // each row is minimal — feasible in <2s. We page in chunks.
    // Coverage: delegate to SQL function public.settlement_health_coverage()
    // which runs the verified aggregation query against v_player_markets + events_v2.
    // (PostgREST 1000-row default cap would otherwise force ~200 paginated requests
    //  to scan 200k+ markets rows.)
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
      // Note: COUNT(DISTINCT event_id) across the whole result is NOT equal to the sum of
      // per-sport distinct counts (in practice it is here because every event belongs to
      // exactly one sport — but we compute totals as sums of per-sport values for clarity).
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

    // ── 7. Subsystem scoring ───────────────────────────────────────────────
    // flashscore_scraper: cron_age < 60s AND freshness < 120s → 100; >300s OR >600s → 0
    let flashscoreScraperScore: number;
    if (fsCronAgeSec === null) flashscoreScraperScore = 0;
    else {
      const cronScore = lerpScore(fsCronAgeSec, 60, 300);
      const dataScore = fsDataFreshnessSec === null
        ? 100 // no live events to measure
        : lerpScore(fsDataFreshnessSec, 120, 600);
      flashscoreScraperScore = Math.min(cronScore, dataScore);
    }

    // event_settlement_lag: pending=0 → 100; >=20 → 0
    const pendingCount = eventsPendingSettlement || 0;
    const eventSettlementLagScore = lerpScore(pendingCount, 0, 20);

    // event_settlement_rate: no live events → 100; rate>=30 → 100; rate=0 + live → 0
    const settledLastHour = eventsSettledLastHour || 0;
    let eventSettlementRateScore: number;
    if ((liveEventsCount || 0) === 0) eventSettlementRateScore = 100;
    else if (settledLastHour >= 30) eventSettlementRateScore = 100;
    else if (settledLastHour === 0) eventSettlementRateScore = 0;
    else eventSettlementRateScore = clamp((settledLastHour / 30) * 100);

    // bet_settlement_lag: 0 → 100; >=100 → 0
    const pendingSel = selectionsPending || 0;
    const betSettlementLagScore = lerpScore(pendingSel, 0, 100);

    // bet_settlement_rate: cron < 24h → 100; > 48h → 0
    let betSettlementRateScore: number;
    if (settlementCronAgeMin === null) betSettlementRateScore = 0;
    else if (settlementCronAgeMin < 24 * 60) betSettlementRateScore = 100;
    else if (settlementCronAgeMin > 48 * 60) betSettlementRateScore = 0;
    else betSettlementRateScore = clamp(100 - ((settlementCronAgeMin - 24 * 60) / (24 * 60)) * 100);

    const subsystems = {
      flashscore_scraper: {
        score: flashscoreScraperScore,
        weight: 30,
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
        weight: 20,
        label: "Event Settlement Rate",
        details: `${settledLastHour}/h`,
      },
      bet_settlement_lag: {
        score: betSettlementLagScore,
        weight: 15,
        label: "Customer Bet Lag",
        details: `${pendingSel} selections pending`,
      },
      bet_settlement_rate: {
        score: betSettlementRateScore,
        weight: 10,
        label: "Customer Bet Rate",
        details: settlementCronAgeMin === null
          ? "settlement cron never ran"
          : `cron ${formatAge(settlementCronAgeMin * 60)} ago`,
      },
    };

    const totalWeight = Object.values(subsystems).reduce((s, sub) => s + sub.weight, 0);
    const healthScore = clamp(
      Object.values(subsystems).reduce((s, sub) => s + sub.score * sub.weight, 0) / totalWeight
    );
    const overall: "ok" | "warning" | "critical" =
      healthScore >= 80 ? "ok" : healthScore >= 50 ? "warning" : "critical";

    // Legacy compatibility: keep the `actors` block + a couple of mirror fields the
    // admin UI may still consume; the new shape is the source of truth.
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
        selections_pending: pendingSel,
        selections_settled_last_hour: selectionsSettledLastHour || 0,
        bets_pending_payout: betsPendingPayout || 0,
        fs_scraper_cron_age_seconds: fsCronAgeSec,
        fs_data_freshness_seconds: fsDataFreshnessSec,
        settlement_cron_last_run: settlementCronTs,
        settlement_cron_age_minutes: settlementCronAgeMin,
        live_events_count: liveEventsCount || 0,
        fs_fixtures_cron_ts: fsFixturesTs,
      },
      coverage_by_sport: coverageBySport,
      coverage_total: coverageTotal,
      stuck_events: stuckEvents,
      pending_selections: pendingSelections,
      recent_settlements: recentSettlements,
      // Legacy back-compat fields (consumed by app/admin/risk/page.tsx)
      actors,
      backlog: pendingCount,
      rates: {
        last_1h: settledLastHour,
        last_6h: settledLastHour, // approximated; legacy field
        last_24h: eventsSettledToday || 0,
      },
      generated_at: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[settlement-health]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
