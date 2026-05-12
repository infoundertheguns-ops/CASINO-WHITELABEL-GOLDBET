export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET — Financial reports
// ?period=today|week|month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&agent_id=UUID

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const sp = req.nextUrl.searchParams;
  const period = sp.get("period") || "today";
  const agentId = sp.get("agent_id");

  // Calculate date range
  const now = new Date();
  let from: Date, to: Date;

  switch (period) {
    case "today":
      from = new Date(now); from.setHours(0, 0, 0, 0);
      to = now;
      break;
    case "yesterday":
      from = new Date(now); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
      to = new Date(now); to.setDate(to.getDate() - 1); to.setHours(23, 59, 59, 999);
      break;
    case "week":
      from = new Date(now); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
      to = now;
      break;
    case "month":
      from = new Date(now); from.setDate(1); from.setHours(0, 0, 0, 0);
      to = now;
      break;
    case "custom":
      from = new Date(sp.get("from") || now.toISOString());
      to = new Date(sp.get("to") || now.toISOString());
      to.setHours(23, 59, 59, 999);
      break;
    default:
      from = new Date(now); from.setHours(0, 0, 0, 0);
      to = now;
  }

  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  try {
    // ── 1. Bets in period ──
    let betsQuery = supabase
      .from("bets")
      .select("id, user_id, kiosk_id, bet_type, stake, total_odds, potential_win, status, is_live, created_at")
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .not("status", "eq", "rejected");

    // Agent scoping (includes kiosk bets)
    let scopedPlayerIds: string[] | null = null;
    if (agentId) {
      // Get agent's players
      const { data: players } = await supabase
        .from("users")
        .select("id")
        .eq("agent_id", agentId);
      scopedPlayerIds = (players || []).map((p: any) => p.id);
      // Get agent's kiosks
      const { data: kiosks } = await supabase
        .from("kiosks")
        .select("id")
        .eq("agent_id", agentId);
      const kioskIds = (kiosks || []).map((k: any) => k.id);

      const conditions: string[] = [];
      if (scopedPlayerIds.length > 0) conditions.push(`user_id.in.(${scopedPlayerIds.join(",")})`);
      if (kioskIds.length > 0) conditions.push(`kiosk_id.in.(${kioskIds.join(",")})`);

      if (conditions.length > 0) {
        betsQuery = betsQuery.or(conditions.join(","));
      } else {
        return NextResponse.json(emptyReport(fromISO, toISO, period));
      }
    }

    const { data: bets } = await betsQuery;
    const allBets = bets || [];

    // ── 2. Calculate KPIs ──
    const totalBets = allBets.length;
    const turnover = allBets.reduce((s, b) => s + (b.stake || 0), 0);

    // Won bets
    const wonBets = allBets.filter(b => b.status === "won");
    const totalWinnings = wonBets.reduce((s, b) => s + (b.potential_win || 0), 0);

    // GGR = turnover - winnings
    const ggr = turnover - totalWinnings;
    const margin = turnover > 0 ? (ggr / turnover) * 100 : 0;

    // Bet type breakdown
    const byType: Record<string, { count: number; stake: number; won: number }> = {};
    for (const b of allBets) {
      const t = b.bet_type || "singola";
      if (!byType[t]) byType[t] = { count: 0, stake: 0, won: 0 };
      byType[t].count++;
      byType[t].stake += b.stake || 0;
      if (b.status === "won") byType[t].won += b.potential_win || 0;
    }

    // Live vs prematch
    const liveBets = allBets.filter(b => b.is_live);
    const prematchBets = allBets.filter(b => !b.is_live);

    // Status breakdown
    const byStatus: Record<string, number> = {};
    for (const b of allBets) {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    }

    // ── 3. Sport breakdown ──
    // Get bet selections with sport info
    const betIds = allBets.map(b => b.id);
    let sportBreakdown: any[] = [];

    if (betIds.length > 0) {
      const { data: selections } = await supabase
        .from("bet_selections")
        .select("bet_id, odds_at_placement, event:events_v2(sport_name)")
        .in("bet_id", betIds.slice(0, 500)) // limit for performance
        .eq("source", "sport");

      // Group by sport
      const sportMap = new Map<string, { bets: Set<string>; stake: number; won: number }>();
      const betStakeMap = new Map(allBets.map(b => [b.id, b]));

      for (const sel of (selections || [])) {
        const sport = (sel as any).event?.sport_name || "Altro";
        if (!sportMap.has(sport)) sportMap.set(sport, { bets: new Set(), stake: 0, won: 0 });
        const entry = sportMap.get(sport)!;
        if (!entry.bets.has(sel.bet_id)) {
          entry.bets.add(sel.bet_id);
          const bet = betStakeMap.get(sel.bet_id);
          if (bet) {
            entry.stake += bet.stake || 0;
            if (bet.status === "won") entry.won += bet.potential_win || 0;
          }
        }
      }

      sportBreakdown = Array.from(sportMap.entries())
        .map(([sport, data]) => ({
          sport,
          bets: data.bets.size,
          turnover: Math.round(data.stake * 100) / 100,
          winnings: Math.round(data.won * 100) / 100,
          ggr: Math.round((data.stake - data.won) * 100) / 100,
          margin: data.stake > 0 ? Math.round(((data.stake - data.won) / data.stake) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.turnover - a.turnover);
    }

    // ── 4. Agent breakdown (if no specific agent filter) ──
    let agentBreakdown: any[] = [];
    if (!agentId) {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, name, code, level, commission_rate")
        .eq("status", "active");

      for (const agent of (agents || [])) {
        const { data: agentPlayers } = await supabase
          .from("users")
          .select("id")
          .eq("agent_id", agent.id);
        const { data: agentKiosks } = await supabase
          .from("kiosks")
          .select("id")
          .eq("agent_id", agent.id);

        const pIds = (agentPlayers || []).map((p: any) => p.id);
        const kIds = new Set((agentKiosks || []).map((k: any) => k.id));
        if (pIds.length === 0 && kIds.size === 0) continue;

        const agentBets = allBets.filter(b => pIds.includes(b.user_id) || kIds.has(b.kiosk_id));
        if (agentBets.length === 0) continue;

        const agTurnover = agentBets.reduce((s, b) => s + (b.stake || 0), 0);
        const agWon = agentBets.filter(b => b.status === "won").reduce((s, b) => s + (b.potential_win || 0), 0);
        const agGgr = agTurnover - agWon;
        const commission = agGgr > 0 ? agGgr * (agent.commission_rate / 100) : 0;

        agentBreakdown.push({
          agent_id: agent.id,
          name: agent.name,
          code: agent.code,
          level: agent.level,
          players: pIds.length,
          bets: agentBets.length,
          turnover: Math.round(agTurnover * 100) / 100,
          winnings: Math.round(agWon * 100) / 100,
          ggr: Math.round(agGgr * 100) / 100,
          commission_rate: agent.commission_rate,
          commission: Math.round(commission * 100) / 100,
        });
      }
      agentBreakdown.sort((a, b) => b.turnover - a.turnover);
    }

    // ── 5. Ticket stats (kiosk) ──
    let ticketQuery = supabase
      .from("tickets")
      .select("id, status, stake, win_amount")
      .gte("created_at", fromISO)
      .lte("created_at", toISO);

    if (agentId) ticketQuery = ticketQuery.eq("agent_id", agentId);

    const { data: tickets } = await ticketQuery;
    const allTickets = tickets || [];

    const ticketStats = {
      total: allTickets.length,
      open: allTickets.filter(t => t.status === "open").length,
      won: allTickets.filter(t => t.status === "won").length,
      lost: allTickets.filter(t => t.status === "lost").length,
      claimed: allTickets.filter(t => t.status === "claimed").length,
      expired: allTickets.filter(t => t.status === "expired").length,
      total_stake: allTickets.reduce((s, t) => s + (t.stake || 0), 0),
      total_paid: allTickets.filter(t => t.status === "claimed").reduce((s, t) => s + (t.win_amount || 0), 0),
    };

    return NextResponse.json({
      period,
      from: fromISO,
      to: toISO,
      kpis: {
        total_bets: totalBets,
        turnover: Math.round(turnover * 100) / 100,
        winnings: Math.round(totalWinnings * 100) / 100,
        ggr: Math.round(ggr * 100) / 100,
        margin: Math.round(margin * 10) / 10,
        avg_stake: totalBets > 0 ? Math.round((turnover / totalBets) * 100) / 100 : 0,
        avg_odds: totalBets > 0 ? Math.round((allBets.reduce((s, b) => s + (b.total_odds || 0), 0) / totalBets) * 100) / 100 : 0,
      },
      by_type: Object.entries(byType).map(([type, data]) => ({ type, ...data })),
      by_status: byStatus,
      live_vs_prematch: {
        live: { count: liveBets.length, stake: liveBets.reduce((s, b) => s + (b.stake || 0), 0) },
        prematch: { count: prematchBets.length, stake: prematchBets.reduce((s, b) => s + (b.stake || 0), 0) },
      },
      by_sport: sportBreakdown,
      by_agent: agentBreakdown,
      tickets: ticketStats,
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[financial]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function emptyReport(from: string, to: string, period: string) {
  return {
    period, from, to,
    kpis: { total_bets: 0, turnover: 0, winnings: 0, ggr: 0, margin: 0, avg_stake: 0, avg_odds: 0 },
    by_type: [], by_status: {}, live_vs_prematch: { live: { count: 0, stake: 0 }, prematch: { count: 0, stake: 0 } },
    by_sport: [], by_agent: [], tickets: { total: 0, open: 0, won: 0, lost: 0, claimed: 0, expired: 0, total_stake: 0, total_paid: 0 },
    generated_at: new Date().toISOString(),
  };
}
