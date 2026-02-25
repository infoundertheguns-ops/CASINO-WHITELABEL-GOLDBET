import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent, deactivateEvent } from "@/lib/settlement";

// ═══════════════════════════════════════════════════
// CRON: Full Pipeline Audit + Auto-Fix
// - Runs every 4 hours via crontab
// - Audits event status, markets, outcomes health
// - Auto-fixes: finished backlog, ended with active markets,
//   stale prematch, orphan markets
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
  const errors: string[] = [];

  // ═══ AUDIT: Collect metrics ═══

  const [
    { data: statusCounts },
    { count: activeMarkets },
    { count: inactiveMarkets },
    { count: activeOutcomes },
    { count: inactiveOutcomes },
    { count: updatedOutcomes5m },
    { count: oddsChanged5m },
    { count: finishedCount },
    { count: prematchTotal },
  ] = await Promise.all([
    supabase.rpc("get_event_status_counts"),
    supabase.from("markets").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("markets").select("id", { count: "exact", head: true }).eq("is_active", false),
    supabase.from("outcomes").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("outcomes").select("id", { count: "exact", head: true }).eq("is_active", false),
    supabase.from("outcomes").select("id", { count: "exact", head: true }).gt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()),
    supabase.from("outcomes").select("id", { count: "exact", head: true }).gt("updated_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()).not("previous_odds", "is", null).neq("previous_odds", 0),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "finished"),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "prematch"),
  ]);

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
        // Force deactivate on error to prevent stuck events
        try { await deactivateEvent(supabase, ev.id); } catch { /* ignore */ }
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

  // ═══ FIX 3: Stale prematch (started 4+ hours ago, never went live) ═══

  const staleThreshold = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data: stalePrematch } = await supabase
    .from("events")
    .select("id")
    .eq("status", "prematch")
    .eq("is_live", false)
    .lt("starts_at", staleThreshold)
    .limit(200);

  if (stalePrematch && stalePrematch.length > 0) {
    const staleIds = stalePrematch.map((e) => e.id);
    await supabase
      .from("events")
      .update({ status: "finished", updated_at: new Date().toISOString() })
      .in("id", staleIds);
    fixes.stale_prematch_marked = staleIds.length;

    for (const ev of stalePrematch) {
      try {
        await deactivateEvent(supabase, ev.id);
      } catch { /* ignore */ }
    }
  }

  // ═══ BUILD REPORT ═══

  // Parse status counts (from RPC or fallback)
  let eventStatus: Record<string, number> = {};
  if (Array.isArray(statusCounts)) {
    for (const r of statusCounts) eventStatus[r.status] = r.count;
  }

  const report = {
    timestamp: new Date().toISOString(),
    events: eventStatus,
    markets: { active: activeMarkets || 0, inactive: inactiveMarkets || 0 },
    outcomes: { active: activeOutcomes || 0, inactive: inactiveOutcomes || 0 },
    pipeline: {
      outcomes_updated_5min: updatedOutcomes5m || 0,
      odds_changed_5min: oddsChanged5m || 0,
      scraper_alive: (updatedOutcomes5m || 0) > 0,
    },
    health: {
      finished_backlog: (finishedCount || 0) - processed,
      prematch_count: prematchTotal || 0,
    },
    fixes: Object.keys(fixes).length > 0 ? fixes : "none",
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  };

  return NextResponse.json(report);
}
