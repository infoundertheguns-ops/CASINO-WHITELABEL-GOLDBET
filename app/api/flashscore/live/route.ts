export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  getSportGroup,
  derivePeriodLabel,
  teamMatchScore,
} from "@/lib/flashscore";
import type { FlashscoreLive } from "@/lib/flashscore";

// ═══════════════════════════════════════════════════
// Flashscore Live Enrichment Endpoint
// Receives live events from flashscore-scraper live-loop
// Matches with Kambi live events and fills gaps in
// period label + per-period score breakdown.
// ═══════════════════════════════════════════════════

interface DbLiveEvent {
  id: string;
  external_id: string | null;
  home_team: string;
  away_team: string;
  score_home: number | null;
  score_away: number | null;
  starts_at: string;
  period: string | null;
  live_data: Record<string, unknown> | null;
  flashscore_id: string | null;
  sports: { name: string } | null;
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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const stats = { received: live.length, matched: 0, updated: 0, errors: [] as string[] };

  // 1. Load Kambi live events for this sport group
  const sportGroup = getSportGroup(sport);
  let query = supabase
    .from("events")
    .select(
      "id, external_id, home_team, away_team, score_home, score_away, starts_at, period, live_data, flashscore_id, sports!inner(name)"
    )
    .eq("source", "odds-api")
    .eq("is_live", true)
    .eq("status", "live");

  if (sportGroup.length === 1) {
    query = query.ilike("sports.name", sportGroup[0]);
  } else {
    query = query.or(
      sportGroup.map((s) => `name.ilike.${s}`).join(","),
      { referencedTable: "sports" }
    );
  }

  const { data: eventsRaw, error: evErr } = await query.limit(500);
  if (evErr || !eventsRaw) {
    return NextResponse.json({ ...stats, error: evErr?.message || "No live events" });
  }

  const events = eventsRaw as unknown as DbLiveEvent[];
  const liveById = new Map(live.map((l) => [l.matchId, l]));

  // 2. Direct lookups via flashscore_id (fast path)
  const directSet = new Set<string>();
  for (const ev of events) {
    if (!ev.flashscore_id) continue;
    const fs = liveById.get(ev.flashscore_id);
    if (!fs) continue;
    directSet.add(ev.id);
    try {
      const didUpdate = await applyEnrichment(supabase, ev, fs, sport);
      stats.matched++;
      if (didUpdate) stats.updated++;
    } catch (err) {
      stats.errors.push(`${ev.home_team}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Fuzzy match the rest (loose: same sport, team names ± 1h window)
  const fuzzyEvents = events.filter((ev) => !directSet.has(ev.id));
  const usedFs = new Set<number>();

  for (const ev of fuzzyEvents) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < live.length; i++) {
      if (usedFs.has(i)) continue;
      const fs = live[i];

      if (fs.timestamp && ev.starts_at) {
        const dbTime = new Date(ev.starts_at).getTime() / 1000;
        if (Math.abs(dbTime - fs.timestamp) > 4 * 3600) continue;
      }

      const hs = teamMatchScore(ev.home_team, fs.homeTeam);
      const as = teamMatchScore(ev.away_team, fs.awayTeam);
      if (hs < 0.5 || as < 0.5) continue;
      const combined = hs + as;
      if (combined > bestScore) {
        bestScore = combined;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestScore <= 1.0) continue;

    usedFs.add(bestIdx);
    const fs = live[bestIdx];
    try {
      const didUpdate = await applyEnrichment(supabase, ev, fs, sport);
      stats.matched++;
      if (didUpdate) stats.updated++;

      // Persist flashscore_id for subsequent direct lookups
      if (!ev.flashscore_id) {
        await supabase
          .from("events")
          .update({ flashscore_id: fs.matchId })
          .eq("id", ev.id);
      }
    } catch (err) {
      stats.errors.push(`${ev.home_team}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json(stats);
}

/**
 * Apply Flashscore enrichment to a Kambi live event.
 * Strategy: Kambi stays primary. Flashscore fills gaps.
 *  - period: if DB has none, derive from FS periods.length + sport
 *  - live_data.halfScoreHome/Away: overwrite with FS breakdown (richer than Kambi)
 *  - score_home/away: overwrite only when Kambi value is null or clearly wrong
 *    (tennis with game-points 15/30/40 or negative cases)
 * Returns true if anything was written.
 */
async function applyEnrichment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ev: DbLiveEvent,
  fs: FlashscoreLive,
  sport: string
): Promise<boolean> {
  const update: Record<string, unknown> = {};
  const periodCount = fs.periods.length;

  // period label — primary from periods.length, fallback from score aggregate for sports
  // where Flashscore doesn't send per-period breakdown (snooker frames, darts legs, baseball).
  let derivedPeriod = derivePeriodLabel(sport, periodCount);
  if (!derivedPeriod) {
    const s = sport.toLowerCase();
    const homeS = fs.scoreHome ?? ev.score_home ?? 0;
    const awayS = fs.scoreAway ?? ev.score_away ?? 0;
    const unitIdx = homeS + awayS + 1;
    if (unitIdx > 0) {
      if (s === "snooker") derivedPeriod = `Frame ${unitIdx}`;
      else if (s === "freccette" || s === "darts") derivedPeriod = `Leg ${unitIdx}`;
    }
  }
  if (derivedPeriod && derivedPeriod !== ev.period) {
    update.period = derivedPeriod;
  }

  // live_data merge: halfScoreHome / halfScoreAway
  const halfScoreHome = fs.periods.map((p) => p[0]);
  const halfScoreAway = fs.periods.map((p) => p[1]);
  const existingLd = (ev.live_data || {}) as Record<string, unknown>;
  const mergedLd = { ...existingLd };
  let ldChanged = false;
  if (halfScoreHome.length > 0) {
    if (!arraysEqual(existingLd.halfScoreHome as number[] | undefined, halfScoreHome)) {
      mergedLd.halfScoreHome = halfScoreHome;
      ldChanged = true;
    }
    if (!arraysEqual(existingLd.halfScoreAway as number[] | undefined, halfScoreAway)) {
      mergedLd.halfScoreAway = halfScoreAway;
      ldChanged = true;
    }
  }
  if (ldChanged) update.live_data = mergedLd;

  // score overwrite (only if upstream missing or clearly game-points for tennis)
  const isTennisLike = ["tennis", "tennis_tavolo", "tennis tavolo", "volley", "volleyball", "badminton"].includes(
    sport.toLowerCase()
  );
  const upstreamLikelyWrong =
    isTennisLike &&
    ev.score_home != null &&
    (ev.score_home >= 15 || ev.score_away! >= 15); // tennis sets rarely >= 15

  if (fs.scoreHome != null && fs.scoreAway != null) {
    if (ev.score_home == null || ev.score_away == null || upstreamLikelyWrong) {
      if (fs.scoreHome !== ev.score_home) update.score_home = fs.scoreHome;
      if (fs.scoreAway !== ev.score_away) update.score_away = fs.scoreAway;
    }
  }

  if (Object.keys(update).length === 0) return false;

  const { error } = await supabase.from("events").update(update).eq("id", ev.id);
  if (error) throw new Error(error.message);
  return true;
}

function arraysEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
