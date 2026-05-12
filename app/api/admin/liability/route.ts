export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getEventLiability } from "@/lib/risk/engine";

// ═══════════════════════════════════════════════════
// ADMIN API: Liability Dashboard
// GET — event liability overview, per-event detail
//
// POST + PATCH removed 2026-05-12 (Sprint 4 Session 2): AI odds optimizer
// + manual odds adjustments were tied to 3-source era (Kambi/22bet/Betfair),
// obsolete in single-source OddsAPI post Plan D. odds_adjustments table
// dropped in big-bang. See lib/risk/engine.ts header.
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

      const { data: eventRow } = await supabase
        .from("events_v2")
        .select("*")
        .eq("id", eventId)
        .single();
      const event = eventRow ? {
        ...eventRow,
        home_team: eventRow.home,
        away_team: eventRow.away,
        is_live: eventRow.status === "live" || (eventRow.minute != null && !["settled","cancelled"].includes(eventRow.status)),
        sport: { name: eventRow.sport_name },
        league: { name: eventRow.league_name },
      } : null;

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
      });
    }

    // Overview: top exposed events
    const { data: events } = await supabase
      .from("events_v2")
      .select("id, home, away, starts_at, status, minute, sport_name, league_name")
      .in("status", ["pending", "live"])
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
        const ev: any = event;
        eventLiabilities.push({
          ...ev,
          home_team: ev.home,
          away_team: ev.away,
          is_live: ev.status === "live" || (ev.minute != null && !["settled","cancelled"].includes(ev.status)),
          sport: { name: ev.sport_name },
          league: { name: ev.league_name },
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
