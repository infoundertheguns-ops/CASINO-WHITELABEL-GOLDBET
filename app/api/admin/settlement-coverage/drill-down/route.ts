// Plan D D.1 — Settlement Coverage drill-down endpoint.
// Returns recent bets + recent events for a single market_type.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketType = url.searchParams.get("market_type");
  const limit = Math.max(
    1,
    Math.min(100, parseInt(url.searchParams.get("limit") ?? "20", 10))
  );

  if (!marketType) {
    return NextResponse.json(
      { error: "market_type query param is required" },
      { status: 400 }
    );
  }

  const supa = createAdminClient();

  // Two parallel queries:
  //   1. recent bet_selections on this market_type, joined with bets (stake, created_at)
  //   2. recent events that have at least one leg on this market_type, with FS + score flags
  const [betsRes, eventsRes] = await Promise.all([
    supa
      .from("bet_selections")
      .select(
        `
        id,
        result,
        settled_at,
        bets!inner (id, stake, status, created_at),
        markets!inner (market_type, line),
        outcomes!inner (name, odds)
      `
      )
      .eq("markets.market_type", marketType)
      .order("created_at", { ascending: false, foreignTable: "bets" } as any)
      .limit(limit),
    supa
      .from("events")
      .select(
        `
        id,
        external_id,
        flashscore_id,
        score_home,
        score_away,
        starts_at,
        status,
        sports!inner (name),
        markets!inner (market_type)
      `
      )
      .eq("markets.market_type", marketType)
      .order("starts_at", { ascending: false })
      .limit(limit),
  ]);

  if (betsRes.error || eventsRes.error) {
    return NextResponse.json(
      {
        error: betsRes.error?.message ?? eventsRes.error?.message,
      },
      { status: 500 }
    );
  }

  // Normalize bets shape
  const recentBets = (betsRes.data ?? []).map((row: any) => ({
    bet_selection_id: row.id,
    result: row.result,
    settled_at: row.settled_at,
    stake: row.bets?.stake,
    bet_status: row.bets?.status,
    placed_at: row.bets?.created_at,
    market_type: row.markets?.market_type,
    line: row.markets?.line,
    outcome_name: row.outcomes?.name,
    outcome_odds: row.outcomes?.odds,
  }));

  // Normalize events shape, dedup by event id (a join on markets can produce duplicates)
  const eventsMap = new Map<string, any>();
  for (const row of eventsRes.data ?? []) {
    if (!eventsMap.has((row as any).id)) {
      eventsMap.set((row as any).id, {
        event_id: (row as any).id,
        external_id: (row as any).external_id,
        sport: (row as any).sports?.name,
        flashscore_id: (row as any).flashscore_id,
        has_flashscore_id: !!(row as any).flashscore_id,
        has_score:
          (row as any).score_home !== null && (row as any).score_away !== null,
        score_home: (row as any).score_home,
        score_away: (row as any).score_away,
        starts_at: (row as any).starts_at,
        status: (row as any).status,
      });
    }
  }
  const recentEvents = Array.from(eventsMap.values()).slice(0, limit);

  return NextResponse.json({
    market_type: marketType,
    recent_bets: recentBets,
    recent_events: recentEvents,
    generated_at: new Date().toISOString(),
  });
}
