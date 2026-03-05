import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent, deactivateEvent, resolveBet } from "@/lib/settlement";

// ═══════════════════════════════════════════════════
// CRON: Cleanup finished events + fix stale data
// - Settles/deactivates finished events in batches
// - Fixes ended events that still have active markets
// - Runs every 10 minutes via crontab
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

  let settled = 0;
  let deactivated = 0;
  let endedFixed = 0;
  const errors: string[] = [];

  // ── 1. Process finished events backlog (oldest first, max 50) ──
  // Delay 30 min to let verify-results cron settle with verified BetExplorer data first
  const finishedDelay = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: finishedEvents } = await supabase
    .from("events")
    .select("id, external_id, score_home")
    .eq("status", "finished")
    .lt("updated_at", finishedDelay)
    .order("updated_at", { ascending: true })
    .limit(50);

  if (finishedEvents && finishedEvents.length > 0) {
    for (const ev of finishedEvents) {
      try {
        if (ev.score_home != null) {
          const res = await settleEvent(supabase, ev.id);
          if (res.success) {
            settled++;
          } else {
            await deactivateEvent(supabase, ev.id);
            deactivated++;
          }
        } else {
          await deactivateEvent(supabase, ev.id);
          deactivated++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ev.external_id}: ${msg}`);
      }
    }
  }

  // ── 2. Force-finish stale live events (no updates for 10+ min) ──
  // Critical: stale live events have active markets players can bet on
  let staleLiveFinished = 0;
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: staleLive } = await supabase
    .from("events")
    .select("id")
    .eq("status", "live")
    .eq("is_live", true)
    .lt("updated_at", staleThreshold)
    .limit(200);

  if (staleLive && staleLive.length > 0) {
    const ids = staleLive.map((e: { id: string }) => e.id);
    await supabase
      .from("events")
      .update({ status: "finished", is_live: false, updated_at: new Date().toISOString() })
      .in("id", ids);
    staleLiveFinished = ids.length;
  }

  // ── 3. Bulk-fix ended events that still have active markets (single RPC) ──
  try {
    const { data: bulkFixed, error: rpcErr } = await supabase.rpc("fix_ended_active_markets");
    if (!rpcErr && bulkFixed) {
      const row = Array.isArray(bulkFixed) ? bulkFixed[0] : bulkFixed;
      endedFixed = (row?.markets_fixed ?? 0) + (row?.outcomes_fixed ?? 0);
    }
  } catch { /* RPC not available, skip */ }

  // ── 4. Resolve stale multi/sistema bets with at least one lost leg ──
  let multisResolved = 0;
  const { data: staleBets } = await supabase
    .from("bets")
    .select("id")
    .in("bet_type", ["multi", "sistema_combo"])
    .eq("status", "open")
    .limit(100);

  if (staleBets && staleBets.length > 0) {
    for (const bet of staleBets) {
      try {
        const payout = await resolveBet(supabase, bet.id);
        if (payout !== null) multisResolved++;
      } catch { /* ignore */ }
    }
  }

  // ── 5. Deactivate orphan markets + outcomes (active on non-active events) ──
  // Uses single RPC call with batch processing and deadlock safety.
  let orphanMarkets = 0;
  let orphanOutcomes = 0;
  try {
    const { data: orphanResult, error: orphanErr } = await supabase.rpc("fix_orphan_markets");
    if (!orphanErr && orphanResult) {
      const row = typeof orphanResult === "string" ? JSON.parse(orphanResult) : orphanResult;
      orphanMarkets = row?.markets_fixed ?? 0;
      orphanOutcomes = row?.outcomes_fixed ?? 0;
    }
  } catch { /* non-critical */ }

  // ── 6. Purge old ended events (>48h) with all markets + outcomes ──
  // Prevents DB bloat from accumulating ~170K outcomes/day.
  let purgeResult: { events_deleted: number; markets_deleted: number; outcomes_deleted: number } | null = null;
  try {
    const { data: purgeData, error: purgeErr } = await supabase.rpc("purge_old_ended_events", {
      p_hours_old: 48,
      p_batch_limit: 500,
    });
    if (!purgeErr && purgeData) {
      purgeResult = typeof purgeData === "string" ? JSON.parse(purgeData) : purgeData;
    }
  } catch { /* non-critical — RPC may not exist yet */ }

  return NextResponse.json({
    finished_remaining: finishedEvents?.length || 0,
    settled,
    deactivated,
    stale_live_finished: staleLiveFinished || undefined,
    ended_fixed: endedFixed || undefined,
    multis_resolved: multisResolved || undefined,
    orphan_markets: orphanMarkets || undefined,
    orphan_outcomes: orphanOutcomes || undefined,
    purge: purgeResult && purgeResult.events_deleted > 0 ? purgeResult : undefined,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
