import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent, deactivateEvent } from "@/lib/settlement";
import { computeHealthScores, type SystemHealthRPC, type ScraperInfo, type RedisInfo } from "@/lib/health";
// Telegram alerts now handled by dedicated /api/cron/alerts route

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
  // Run RPC calls sequentially to avoid PostgREST parallel issues
  const { data: statusCounts } = await supabase.rpc("get_event_status_counts");

  // get_audit_counts returns scalar json — parse carefully
  const { data: rawAuditCounts, error: auditErr } = await supabase.rpc("get_audit_counts");

  const [
    { count: finishedCount },
    { count: prematchTotal },
  ] = await Promise.all([
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "finished"),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "prematch"),
  ]);

  // Handle scalar json: could be object, string, or array-wrapped
  let ac: Record<string, unknown> = {};
  if (auditErr) {
    errors.push(`get_audit_counts: ${auditErr.message}`);
  } else if (rawAuditCounts) {
    if (typeof rawAuditCounts === "string") {
      try { ac = JSON.parse(rawAuditCounts); } catch { /* ignore */ }
    } else if (Array.isArray(rawAuditCounts)) {
      ac = rawAuditCounts[0] ?? {};
    } else {
      ac = rawAuditCounts as Record<string, unknown>;
    }
  }
  const approxMarkets = Number(ac.approx_total_markets) || 0;
  const approxOutcomes = Number(ac.approx_total_outcomes) || 0;
  const updatedOutcomes5m = Number(ac.updated_outcomes_5m) || 0;
  const oddsChanged5m = Number(ac.odds_changed_5m) || 0;
  const liveCnt = Number(ac.live_events) || 0;
  const latestOutcomeUpdate = (ac.latest_outcome_update as string) || null;

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

  // ═══ FIX 3: Stale prematch (started 30+ min ago OR abandoned by scraper 2+ hours) ═══

  const startsAtThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const updatedAtThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: stalePrematch } = await supabase
    .from("events")
    .select("id")
    .eq("status", "prematch")
    .eq("is_live", false)
    .or(`starts_at.lt.${startsAtThreshold},updated_at.lt.${updatedAtThreshold}`)
    .limit(500);

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

  // ═══ SYSTEM HEALTH SNAPSHOT ═══

  let healthScores: { overall: number; level: string; subsystems: Record<string, unknown> } | null = null;
  let healthMetrics: SystemHealthRPC | null = null;

  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc("get_system_health");
    if (!rpcErr && rpcData) {
      healthMetrics = (typeof rpcData === "string" ? JSON.parse(rpcData) : rpcData) as SystemHealthRPC;

      // Build scraper info from in-memory snapshots (if available) or from audit data
      const g = globalThis as any;
      const snapshots = g.__scraperSnapshotsBySource as Record<string, any[]> | undefined;

      const buildScraperInfo = (source: string, type: "live" | "prematch"): ScraperInfo => {
        const buf = snapshots?.[source];
        if (buf && buf.length > 0) {
          const latest = buf[buf.length - 1];
          const gb = latest?.goldbet;
          if (gb) {
            const cycleField = type === "live" ? gb.last_live_cycle : gb.last_prematch_cycle;
            const cycleAge = cycleField
              ? (Date.now() - new Date(cycleField).getTime()) / 1000
              : Infinity;
            // Fallback: if cycle timestamp missing but snapshot is fresh, use snapshot age
            const snapshotAge = latest?.timestamp
              ? (Date.now() - new Date(latest.timestamp).getTime()) / 1000
              : Infinity;
            const effectiveAge = cycleAge > 3600 && snapshotAge < 300 ? snapshotAge : cycleAge;
            return { connected: true, lastCycleSeconds: effectiveAge, errorsLastHour: gb.errors_last_hour ?? 0 };
          }
        }
        // Fallback: use audit pipeline data
        if (type === "live") {
          return {
            connected: scraperAlive,
            lastCycleSeconds: lastUpdateAge != null ? lastUpdateAge * 60 : undefined,
            errorsLastHour: 0,
          };
        }
        return { connected: scraperAlive };
      };

      const scraperLive = buildScraperInfo("kambi", "live");
      const scraperPrematch = buildScraperInfo("kambi", "prematch");

      // Redis info
      let redisInfo: RedisInfo = { connected: false };
      try {
        const { getRedisClient } = await import("@/lib/redis");
        const client = await getRedisClient();
        const start = Date.now();
        await client.ping();
        redisInfo = { connected: true, latencyMs: Date.now() - start };
      } catch { /* redis unavailable */ }

      const scores = computeHealthScores(
        healthMetrics,
        { live: scraperLive, prematch: scraperPrematch },
        redisInfo,
      );
      healthScores = scores;

      // Log to system_health_log
      await supabase.from("system_health_log").insert({
        overall_score: scores.overall,
        overall_level: scores.level,
        subsystem_scores: scores.subsystems,
        metrics: {
          events: healthMetrics.events,
          pipeline: healthMetrics.pipeline,
          quality: healthMetrics.quality,
        },
      });

      // Alert on critical — now handled by /api/cron/alerts (every 2 min)
    }
  } catch (healthErr) {
    errors.push(`health snapshot: ${healthErr instanceof Error ? healthErr.message : String(healthErr)}`);
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
    health: healthScores
      ? {
          overall_score: healthScores.overall,
          level: healthScores.level,
          subsystems: healthScores.subsystems,
          finished_backlog: (finishedCount ?? 0) - processed,
          prematch_count: prematchTotal ?? 0,
        }
      : {
          finished_backlog: (finishedCount ?? 0) - processed,
          prematch_count: prematchTotal ?? 0,
        },
    fixes: Object.keys(fixes).length > 0 ? fixes : "none",
    alerts: alerts.length > 0 ? alerts : undefined,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  };

  return NextResponse.json(report);
}
