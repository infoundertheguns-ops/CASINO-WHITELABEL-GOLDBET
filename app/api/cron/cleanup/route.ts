import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent, deactivateEvent } from "@/lib/settlement";

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
  const { data: finishedEvents } = await supabase
    .from("events")
    .select("id, external_id, score_home")
    .eq("status", "finished")
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

  // ── 2. Force-finish stale live events (no updates for 30+ min) ──
  let staleLiveFinished = 0;
  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
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

  // ── 3. Fix ended events that still have active markets ──
  const { data: brokenEnded } = await supabase
    .from("events")
    .select("id")
    .eq("status", "ended")
    .limit(50);

  if (brokenEnded && brokenEnded.length > 0) {
    // Check which ones actually have active markets
    for (const ev of brokenEnded) {
      const { count } = await supabase
        .from("markets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", ev.id)
        .eq("is_active", true);

      if (count && count > 0) {
        try {
          await deactivateEvent(supabase, ev.id);
          endedFixed++;
        } catch { /* ignore */ }
      }
    }
  }

  return NextResponse.json({
    finished_remaining: finishedEvents?.length || 0,
    settled,
    deactivated,
    stale_live_finished: staleLiveFinished || undefined,
    ended_fixed: endedFixed || undefined,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  });
}
