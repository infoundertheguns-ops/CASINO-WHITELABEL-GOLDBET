export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSportSlugsEn } from "@/lib/sport-slug-it-to-en";
import type { FlashscoreLive } from "@/lib/flashscore";
import {
  computeEnrichmentUpdate,
  findFuzzyMatch,
  type V2LiveEvent,
} from "./_lib";

// ═══════════════════════════════════════════════════
// Flashscore Live Enrichment Endpoint (events_v2 path)
// Receives live events from flashscore-scraper live-loop
// Matches with events_v2 live rows and fills period /
// minute / live_data / score gaps from FS data.
// (Plan D S6 cutover: legacy `events` is no longer the
// live-event source; we read+write events_v2 directly.)
// ═══════════════════════════════════════════════════

interface V2RowFromDb extends V2LiveEvent {
  odds_api_id: number;
  sport_slug: string;
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { live, sport } = body as { live: FlashscoreLive[]; sport: string };

  if (!live || !Array.isArray(live) || live.length === 0) {
    return NextResponse.json({ error: "No live events provided" }, { status: 400 });
  }

  const slugsEn = getSportSlugsEn(sport);
  if (slugsEn.length === 0) {
    return NextResponse.json({
      received: live.length,
      matched: 0,
      matched_direct: 0,
      matched_fuzzy: 0,
      updated: 0,
      errors: [],
      reason: "unknown_sport",
    });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const stats = {
    received: live.length,
    matched: 0,
    matched_direct: 0,
    matched_fuzzy: 0,
    updated: 0,
    errors: [] as string[],
  };

  const { data: eventsRaw, error: evErr } = await supabase
    .from("events_v2")
    .select(
      "id, odds_api_id, home, away, score_home, score_away, starts_at, period, minute, live_data, flashscore_id, sport_slug"
    )
    .eq("status", "live")
    .in("sport_slug", slugsEn)
    .limit(500);

  if (evErr || !eventsRaw) {
    return NextResponse.json({ ...stats, error: evErr?.message || "No live events" });
  }

  const events = eventsRaw as V2RowFromDb[];
  const liveById = new Map(live.map((l) => [l.matchId, l]));

  // Direct lookups via flashscore_id
  const directSet = new Set<string>();
  for (const ev of events) {
    if (!ev.flashscore_id) continue;
    const fs = liveById.get(ev.flashscore_id);
    if (!fs) continue;
    directSet.add(ev.id);
    try {
      const didUpdate = await applyAndPersist(supabase, ev, fs, sport);
      stats.matched++;
      stats.matched_direct++;
      if (didUpdate) stats.updated++;
    } catch (err) {
      stats.errors.push(`${ev.home}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fuzzy fallback for the rest
  const fuzzyEvents = events.filter((ev) => !directSet.has(ev.id));
  const usedFs = new Set<number>();
  for (const ev of fuzzyEvents) {
    const { idx } = findFuzzyMatch(ev, live, usedFs);
    if (idx < 0) continue;
    usedFs.add(idx);
    const fs = live[idx];
    try {
      const didUpdate = await applyAndPersist(supabase, ev, fs, sport);
      stats.matched++;
      stats.matched_fuzzy++;
      if (didUpdate) stats.updated++;

      if (!ev.flashscore_id) {
        await supabase
          .from("events_v2")
          .update({ flashscore_id: fs.matchId })
          .eq("id", ev.id);
      }
    } catch (err) {
      stats.errors.push(`${ev.home}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Telemetry: one structured log per push for journalctl/log-aggregator.
  console.log(`[flashscore/live] ${JSON.stringify({ sport, ...stats })}`);

  return NextResponse.json(stats);
}

async function applyAndPersist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ev: V2LiveEvent,
  fs: FlashscoreLive,
  sport: string,
): Promise<boolean> {
  const { update } = computeEnrichmentUpdate({ ev, fs, sport });
  if (!update) return false;
  const { error } = await supabase.from("events_v2").update(update).eq("id", ev.id);
  if (error) throw new Error(error.message);
  return true;
}
