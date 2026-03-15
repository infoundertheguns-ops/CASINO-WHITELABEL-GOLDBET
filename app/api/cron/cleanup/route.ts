import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent, deactivateEvent, resolveBet } from "@/lib/settlement";
import { sendTelegramAlert } from "@/lib/telegram";

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
  let stalePrematchEnded = 0;
  const errors: string[] = [];

  // ── 1. Process finished events backlog (oldest first, max 150) ──
  // Delay 10 min to let verify-results cron settle with verified data first
  const finishedDelay = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: finishedEvents } = await supabase
    .from("events")
    .select("id, external_id, score_home")
    .eq("status", "finished")
    .lt("updated_at", finishedDelay)
    .order("updated_at", { ascending: true })
    .limit(150);

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

  // ── 2b. End abandoned prematch events (no scraper update for 2+ hours) ──
  // If scraper stopped processing an event, it becomes stale.
  // 2h threshold = ~24 Kambi prematch cycles.
  const prematchStaleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: stalePrematch } = await supabase
    .from("events")
    .select("id")
    .eq("status", "prematch")
    .eq("is_live", false)
    .lt("updated_at", prematchStaleThreshold)
    .limit(500);

  if (stalePrematch && stalePrematch.length > 0) {
    const ids = stalePrematch.map((e: { id: string }) => e.id);
    await supabase
      .from("events")
      .update({ status: "ended", updated_at: new Date().toISOString() })
      .in("id", ids);
    stalePrematchEnded = ids.length;
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

  // ── 6. Void stale pending legs (>6h after event finished) ──
  // Safety net: if Flashscore stats never arrive, void the unsettled legs
  // so bets don't stay "open" indefinitely.
  let stalePendingVoided = 0;
  try {
    const staleLegsThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    // Find finished/ended events updated >6h ago that might still have unsettled legs
    const { data: staleFinishedEvents } = await supabase
      .from("events")
      .select("id")
      .in("status", ["finished", "ended"])
      .is("settled_at", null)
      .lt("updated_at", staleLegsThreshold)
      .limit(100);

    if (staleFinishedEvents && staleFinishedEvents.length > 0) {
      for (const ev of staleFinishedEvents) {
        const { data: pendingLegs } = await supabase
          .from("bet_selections")
          .select("id, bet_id")
          .eq("event_id", ev.id)
          .is("result", null)
          .limit(200);

        if (pendingLegs && pendingLegs.length > 0) {
          const betIds = new Set<string>();
          for (const leg of pendingLegs) {
            await supabase
              .from("bet_selections")
              .update({ result: "void", settled_at: new Date().toISOString() })
              .eq("id", leg.id);
            betIds.add(leg.bet_id);
          }

          // Resolve affected bets
          for (const betId of betIds) {
            try { await resolveBet(supabase, betId); } catch { /* ignore */ }
          }

          stalePendingVoided += pendingLegs.length;

          // Set settled_at so the event can be properly ended
          await supabase
            .from("events")
            .update({ settled_at: new Date().toISOString() })
            .eq("id", ev.id);

          await deactivateEvent(supabase, ev.id);
        }
      }
    }
  } catch { /* non-critical */ }

  // ── 7. Purge old ended events (>48h) with all markets + outcomes ──
  // Prevents DB bloat from accumulating ~170K outcomes/day.
  let purgeResult: { events_deleted: number; markets_deleted: number; outcomes_deleted: number } | null = null;
  try {
    const { data: purgeData, error: purgeErr } = await supabase.rpc("purge_old_ended_events", {
      p_hours_old: 48,
      p_batch_limit: 2000,
    });
    if (!purgeErr && purgeData) {
      purgeResult = typeof purgeData === "string" ? JSON.parse(purgeData) : purgeData;
    }
  } catch { /* non-critical — RPC may not exist yet */ }

  // ── 7. Daily report (between 03:50-04:10 Rome time) ──
  let dailyReportSent = false;
  try {
    const romaHour = new Date().toLocaleString("en-US", {
      timeZone: "Europe/Rome",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const [h, m] = romaHour.split(":").map(Number);
    const inWindow = (h === 3 && m >= 50) || (h === 4 && m <= 10);

    if (inWindow) {
      // Fetch health score
      let healthScore = 0;
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const resp = await fetch(`${baseUrl}/api/system/health`, { cache: "no-store" });
        if (resp.ok) {
          const hd = await resp.json();
          healthScore = hd.scores?.overall ?? 0;
        }
      } catch { /* skip */ }

      const purgeEvts = purgeResult?.events_deleted ?? 0;
      const purgeMkts = purgeResult?.markets_deleted ?? 0;
      const purgeOuts = purgeResult?.outcomes_deleted ?? 0;

      const report = [
        `\ud83d\udcca <b>REPORT GIORNALIERO</b>`,
        ``,
        `\ud83d\uddd1 Purgati: ${purgeEvts} eventi, ${purgeMkts} mercati, ${purgeOuts} outcomes`,
        `\ud83d\udd27 Orfani fixati: ${orphanMarkets} mercati, ${orphanOutcomes} outcomes`,
        `\u2696\ufe0f Settled: ${settled} | Deactivated: ${deactivated}`,
        `\ud83d\udcc8 Health: ${healthScore}/100`,
      ].join("\n");

      dailyReportSent = await sendTelegramAlert("info", "REPORT GIORNALIERO", report, "daily_report");
    }
  } catch { /* daily report is non-critical */ }

  return NextResponse.json({
    finished_remaining: finishedEvents?.length || 0,
    settled,
    deactivated,
    stale_live_finished: staleLiveFinished || undefined,
    stale_prematch_ended: stalePrematchEnded || undefined,
    ended_fixed: endedFixed || undefined,
    multis_resolved: multisResolved || undefined,
    orphan_markets: orphanMarkets || undefined,
    orphan_outcomes: orphanOutcomes || undefined,
    stale_pending_voided: stalePendingVoided || undefined,
    purge: purgeResult && purgeResult.events_deleted > 0 ? purgeResult : undefined,
    daily_report_sent: dailyReportSent || undefined,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
