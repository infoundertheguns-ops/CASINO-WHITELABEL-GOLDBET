export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getEventLiability, aiOptimizeOdds, applyOddsAdjustments, loadRiskConfig } from "@/lib/risk/engine";

// ═══════════════════════════════════════════════════
// ADMIN API: Liability Dashboard
// GET — event liability overview, per-event detail
// POST — trigger AI odds optimizer for an event
// PATCH — manually adjust odds
// ═══════════════════════════════════════════════════

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const eventId = req.nextUrl.searchParams.get("event_id");
    const view = req.nextUrl.searchParams.get("view") || "overview";

    if (view === "event" && eventId) {
      // Per-event liability detail
      const liability = await getEventLiability(supabase, eventId);

      const { data: event } = await supabase
        .from("events")
        .select("*, sport:sports(name), league:leagues(name)")
        .eq("id", eventId)
        .single();

      // Recent odds adjustments for this event
      const { data: adjustments } = await supabase
        .from("odds_adjustments")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(20);

      // Total stakes per outcome
      const { data: betsByOutcome } = await supabase
        .from("bet_selections")
        .select("outcome_id, odds_at_placement, bets(stake, status)")
        .in("outcome_id", liability.map(l => l.outcome_id));

      const stakesByOutcome: Record<string, { total_stake: number; bet_count: number }> = {};
      for (const bs of betsByOutcome || []) {
        const bet = (bs as any).bets;
        if (!bet || bet.status === "rejected") continue;
        if (!stakesByOutcome[bs.outcome_id]) stakesByOutcome[bs.outcome_id] = { total_stake: 0, bet_count: 0 };
        stakesByOutcome[bs.outcome_id].total_stake += bet.stake || 0;
        stakesByOutcome[bs.outcome_id].bet_count++;
      }

      return NextResponse.json({
        event,
        liability: liability.map(l => ({
          ...l,
          total_stake: stakesByOutcome[l.outcome_id]?.total_stake || 0,
          bet_count: stakesByOutcome[l.outcome_id]?.bet_count || 0,
        })),
        adjustments: adjustments || [],
      });
    }

    // Overview: top exposed events
    const { data: events } = await supabase
      .from("events")
      .select("id, home_team, away_team, starts_at, is_live, status, sport:sports(name), league:leagues(name)")
      .in("status", ["prematch", "live"])
      .order("starts_at", { ascending: true })
      .limit(50);

    const eventLiabilities = [];
    for (const event of events || []) {
      const liability = await getEventLiability(supabase, event.id);
      const maxLiab = liability.length > 0
        ? Math.max(...liability.map(l => l.current_liability))
        : 0;
      const maxPct = liability.length > 0
        ? Math.max(...liability.map(l => l.pct_used))
        : 0;

      if (maxLiab > 0) {
        eventLiabilities.push({
          ...event,
          max_liability: maxLiab,
          max_pct: maxPct,
          outcomes_count: liability.length,
          hot_outcomes: liability.filter(l => l.pct_used > 50).length,
        });
      }
    }

    // Sort by exposure percentage
    eventLiabilities.sort((a, b) => b.max_pct - a.max_pct);

    // Global stats
    const totalLiability = eventLiabilities.reduce((s, e) => s + e.max_liability, 0);
    const criticalEvents = eventLiabilities.filter(e => e.max_pct > 80).length;

    return NextResponse.json({
      events: eventLiabilities,
      global: { total_liability: totalLiability, critical_events: criticalEvents, total_events: eventLiabilities.length },
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Trigger AI optimizer for an event
export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { event_id, auto_apply } = await req.json();
    const config = await loadRiskConfig(supabase);

    const suggestions = await aiOptimizeOdds(supabase, event_id, config);

    if (auto_apply && suggestions.length > 0) {
      await applyOddsAdjustments(
        supabase,
        suggestions.map(s => ({
          outcome_id: s.outcome_id,
          new_odds: s.suggested_odds,
          reason: s.reason,
          auto_applied: true,
        }))
      );
    }

    return NextResponse.json({ suggestions, applied: auto_apply });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Manual odds adjustment
export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { adjustments } = await req.json();
    // adjustments: [{ outcome_id, new_odds, reason }]

    await applyOddsAdjustments(
      supabase,
      (adjustments || []).map((a: any) => ({
        ...a,
        auto_applied: false,
        reason: a.reason || "Aggiustamento manuale admin",
      }))
    );

    return NextResponse.json({ success: true, count: adjustments?.length || 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
