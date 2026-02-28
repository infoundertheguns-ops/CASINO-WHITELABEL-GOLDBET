import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent, deactivateEvent } from "@/lib/settlement";

// ═══════════════════════════════════════════════════
// CRON: Full Pipeline Audit + Auto-Fix
// - Runs every 4 hours via crontab
// - Audits event status, markets, outcomes health
// - Auto-fixes: finished backlog, ended with active markets,
//   stale prematch, orphan markets
// - Detects scraper downtime and creates risk_events alert
// - Returns full health report
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

  const fixes: Record<string, number> = {};
  const alerts: string[] = [];
  const errors: string[] = [];

  // ═══ AUDIT: Collect metrics ═══
  // Single RPC call for all heavy counts (avoids PostgREST parallel count bug + timeout)
  const [
    { data: statusCounts },
    { data: auditCounts },
    { count: finishedCount },
    { count: prematchTotal },
  ] = await Promise.all([
    supabase.rpc("get_event_status_counts"),
    supabase.rpc("get_audit_counts"),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "finished"),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "prematch"),
  ]);

  const ac = auditCounts || {};
  const approxMarkets = ac.approx_total_markets ?? 0;
  const approxOutcomes = ac.approx_total_outcomes ?? 0;
  const updatedOutcomes5m = ac.updated_outcomes_5m ?? 0;
  const oddsChanged5m = ac.odds_changed_5m ?? 0;
  const liveCnt = ac.live_events ?? 0;
  const latestOutcomeUpdate = ac.latest_outcome_update as string | null;

  const lastUpdateAge = latestOutcomeUpdate
    ? Math.floor((Date.now() - new Date(latestOutcomeUpdate).getTime()) / 60000)
    : null;

  const scraperAlive = updatedOutcomes5m > 0;

  // ═══ SCRAPER HEALTH CHECK ═══

  if (!scraperAlive && liveCnt > 0 && (lastUpdateAge === null || lastUpdateAge > 10)) {
    alerts.push(
      `SCRAPER DOWN: ${liveCnt} live events but no outcome updates in ${lastUpdateAge ?? "unknown"} minutes`
    );

    await supabase.from("risk_events").insert({
      event_type: "scraper_down",
      severity: "critical",
      description: `Scraper non attivo: ${liveCnt} eventi live ma nessun aggiornamento outcomes da ${lastUpdateAge ?? "?"} minuti`,
      metadata: { liveEventCount: liveCnt, lastUpdateAge, approxOutcomes, updatedOutcomes5m },
      status: "open",
      created_at: new Date().toISOString(),
    });
  } else if (!scraperAlive && liveCnt === 0) {
    alerts.push(`SCRAPER IDLE: no live events, last update ${lastUpdateAge ?? "unknown"} min ago`);
  }

  // ═══ FIX 0: Force-finish stale live events when scraper is down ═══
  // If scraper hasn't updated outcomes in 60+ minutes, mark all live events as finished
  // so the normal finished→ended pipeline (FIX 1) can process them.

  if (!scraperAlive && liveCnt > 0 && lastUpdateAge !== null && lastUpdateAge >= 60) {
    const staleThreshold = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: staleLive } = await supabase
      .from("events")
      .select("id")
      .eq("status", "live")
      .eq("is_live", true)
      .lt("updated_at", staleThreshold)
      .limit(500);

    if (staleLive && staleLive.length > 0) {
      const ids = staleLive.map((e: { id: string }) => e.id);
      await supabase
        .from("events")
        .update({ status: "finished", is_live: false, updated_at: new Date().toISOString() })
        .in("id", ids);
      fixes.stale_live_force_finished = ids.length;
      alerts.push(`FORCE-FINISHED ${ids.length} stale live events (no updates for ${lastUpdateAge} min)`);
    }
  }

  // ═══ FIX 1: Process ALL finished events (loop until done, max 500) ═══

  let totalSettled = 0;
  let totalDeactivated = 0;
  let processed = 0;

  while (processed < 500) {
    const { data: batch } = await supabase
      .from("events")
      .select("id, external_id, score_home")
      .eq("status", "finished")
      .order("updated_at", { ascending: true })
      .limit(50);

    if (!batch || batch.length === 0) break;

    for (const ev of batch) {
      try {
        if (ev.score_home != null) {
          const res = await settleEvent(supabase, ev.id);
          if (res.success) totalSettled++;
          else {
            await deactivateEvent(supabase, ev.id);
            totalDeactivated++;
          }
        } else {
          await deactivateEvent(supabase, ev.id);
          totalDeactivated++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`settle ${ev.external_id}: ${msg}`);
        try {
          await deactivateEvent(supabase, ev.id);
        } catch {
          /* ignore */
        }
      }
      processed++;
    }
  }

  if (totalSettled > 0) fixes.finished_settled = totalSettled;
  if (totalDeactivated > 0) fixes.finished_deactivated = totalDeactivated;

  // ═══ FIX 2: Bulk deactivate markets/outcomes on ended events ═══

  const { data: bulkMarkets } = await supabase.rpc("fix_ended_active_markets");
  const bulkFixed = bulkMarkets?.[0] || { markets_fixed: 0, outcomes_fixed: 0 };

  if (bulkFixed.markets_fixed > 0) fixes.ended_markets_fixed = bulkFixed.markets_fixed;
  if (bulkFixed.outcomes_fixed > 0) fixes.ended_outcomes_fixed = bulkFixed.outcomes_fixed;

  // ═══ FIX 3: Stale prematch (started 30+ min ago, never went live) ═══

  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: stalePrematch } = await supabase
    .from("events")
    .select("id")
    .eq("status", "prematch")
    .eq("is_live", false)
    .lt("starts_at", staleThreshold)
    .limit(200);

  if (stalePrematch && stalePrematch.length > 0) {
    const staleIds = stalePrematch.map((e: { id: string }) => e.id);
    await supabase
      .from("events")
      .update({ status: "finished", updated_at: new Date().toISOString() })
      .in("id", staleIds);
    fixes.stale_prematch_marked = staleIds.length;

    for (const ev of stalePrematch) {
      try {
        await deactivateEvent(supabase, ev.id);
      } catch {
        /* ignore */
      }
    }
  }

  // ═══ BUILD REPORT ═══

  let eventStatus: Record<string, number> = {};
  if (Array.isArray(statusCounts)) {
    for (const r of statusCounts) eventStatus[r.status] = r.count;
  }

  const report = {
    timestamp: new Date().toISOString(),
    events: eventStatus,
    markets: { approx_total: approxMarkets },
    outcomes: { approx_total: approxOutcomes },
    pipeline: {
      outcomes_updated_5min: updatedOutcomes5m,
      odds_changed_5min: oddsChanged5m,
      scraper_alive: scraperAlive,
      last_update_minutes_ago: lastUpdateAge,
      live_events: liveCnt,
    },
    health: {
      finished_backlog: (finishedCount ?? 0) - processed,
      prematch_count: prematchTotal ?? 0,
    },
    fixes: Object.keys(fixes).length > 0 ? fixes : "none",
    alerts: alerts.length > 0 ? alerts : undefined,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  };

  return NextResponse.json(report);
}
