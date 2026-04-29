export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { deactivateEvent } from "@/lib/settlement";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { current_live_ids?: string[]; source_prefix?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentIds = body.current_live_ids;
  if (!Array.isArray(currentIds)) {
    return NextResponse.json({ error: "current_live_ids array required" }, { status: 400 });
  }

  // Multi-source safety: when a single scraper calls cleanup, its currentIds
  // only cover its own source (e.g. "kambi:*"). Without a prefix filter the
  // diff would falsely mark every other source's live events as stale.
  const sourcePrefix = typeof body.source_prefix === "string" ? body.source_prefix : null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Find events that are is_live=true but NOT in the current live feed
  let staleQuery = supabase.from("events").select("id, external_id").eq("is_live", true);
  if (sourcePrefix) {
    staleQuery = staleQuery.like("external_id", `${sourcePrefix}%`);
  }
  const { data: staleEvents, error: fetchErr } = await staleQuery;

  if (fetchErr || !staleEvents) {
    return NextResponse.json({ finished: 0, error: fetchErr?.message });
  }

  const currentSet = new Set(currentIds);
  const toFinish = staleEvents.filter((e) => !currentSet.has(e.external_id));
  let deactivated = 0;

  // Mark stale live events as finished and deactivate their markets
  if (toFinish.length > 0) {
    const ids = toFinish.map((e) => e.id);
    const { error: updateErr } = await supabase
      .from("events")
      .update({
        is_live: false,
        status: "finished",
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);

    if (updateErr) {
      return NextResponse.json({ finished: 0, error: updateErr.message });
    }

    // Deactivate all markets+outcomes for newly finished events
    for (const ev of toFinish) {
      try {
        await deactivateEvent(supabase, ev.id);
        deactivated++;
      } catch { /* ignore */ }
    }
  }

  // ── Cleanup stale prematch events (started 30+ min ago, never went live) ──
  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: stalePrematch } = await supabase
    .from("events")
    .select("id")
    .eq("status", "prematch")
    .eq("is_live", false)
    .lt("starts_at", staleThreshold)
    .limit(100);

  let staleMarked = 0;
  if (stalePrematch && stalePrematch.length > 0) {
    const { error: staleErr } = await supabase
      .from("events")
      .update({ status: "finished", updated_at: new Date().toISOString() })
      .in("id", stalePrematch.map((e) => e.id));
    if (!staleErr) staleMarked = stalePrematch.length;
  }

  // Settlement is handled by:
  // - verify-results cron (every 5 min) — BetExplorer verified scores
  // - cleanup cron (every 10 min, 30-min delay) — fallback with scraper scores
  // This route only marks events as finished; it does NOT settle.

  // ── Deactivate stale prematch events that were cleaned above ──
  if (stalePrematch && stalePrematch.length > 0) {
    for (const ev of stalePrematch) {
      try {
        await deactivateEvent(supabase, ev.id);
        deactivated++;
      } catch { /* ignore */ }
    }
  }

  return NextResponse.json({
    finished: toFinish.length,
    stale_prematch_cleaned: staleMarked || undefined,
    deactivated: deactivated || undefined,
  });
}
