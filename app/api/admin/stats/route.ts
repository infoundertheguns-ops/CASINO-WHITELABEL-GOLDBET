import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const range = req.nextUrl.searchParams.get("range") || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split("T")[0];

    // Try to get pre-computed stats
    const { data: dailyStats } = await supabase
      .from("daily_stats")
      .select("*")
      .gte("date", sinceStr)
      .order("date", { ascending: true });

    if (dailyStats && dailyStats.length > 0) {
      return NextResponse.json({ stats: dailyStats, source: "precomputed" });
    }

    // Fallback: compute on the fly from raw data
    const [
      { data: bets },
      { data: users },
      { data: transactions },
      { data: riskFlags },
    ] = await Promise.all([
      supabase.from("bets").select("stake, status, potential_win, created_at, risk_score").gte("created_at", since.toISOString()),
      supabase.from("users").select("id, created_at").gte("created_at", since.toISOString()),
      supabase.from("transactions").select("type, amount, created_at").gte("created_at", since.toISOString()),
      supabase.from("risk_flags").select("severity, created_at").gte("created_at", since.toISOString()),
    ]);

    // Aggregate by day
    const dayMap: Record<string, any> = {};
    const initDay = (d: string) => {
      if (!dayMap[d]) dayMap[d] = {
        date: d, bet_count: 0, total_stake: 0, total_payout: 0, ggr: 0, margin_pct: 0,
        deposit_count: 0, deposit_volume: 0, withdrawal_count: 0, withdrawal_volume: 0,
        new_users: 0, active_users: 0, risk_alerts: 0, sport_breakdown: {},
      };
    };

    // Fill all days in range
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      initDay(d.toISOString().split("T")[0]);
    }

    const activeUsersByDay: Record<string, Set<string>> = {};

    for (const b of bets || []) {
      const d = b.created_at?.substring(0, 10);
      if (!d) continue;
      initDay(d);
      dayMap[d].bet_count++;
      dayMap[d].total_stake += b.stake || 0;
      if (b.status === "won") dayMap[d].total_payout += b.potential_win || 0;
    }

    for (const u of users || []) {
      const d = u.created_at?.substring(0, 10);
      if (!d) continue;
      initDay(d);
      dayMap[d].new_users++;
    }

    for (const t of transactions || []) {
      const d = t.created_at?.substring(0, 10);
      if (!d) continue;
      initDay(d);
      if (t.type === "deposit") {
        dayMap[d].deposit_count++;
        dayMap[d].deposit_volume += Math.abs(t.amount || 0);
      }
      if (t.type === "withdrawal") {
        dayMap[d].withdrawal_count++;
        dayMap[d].withdrawal_volume += Math.abs(t.amount || 0);
      }
    }

    for (const f of riskFlags || []) {
      const d = f.created_at?.substring(0, 10);
      if (!d) continue;
      initDay(d);
      dayMap[d].risk_alerts++;
    }

    // Compute GGR and margin
    for (const d of Object.values(dayMap)) {
      d.ggr = d.total_stake - d.total_payout;
      d.margin_pct = d.total_stake > 0 ? (d.ggr / d.total_stake) * 100 : 0;
    }

    const stats = Object.values(dayMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

    // Also compute KPI totals
    const allBets = bets || [];
    const totalStake = allBets.reduce((s, b) => s + (b.stake || 0), 0);
    const totalPayout = allBets.filter(b => b.status === "won").reduce((s, b) => s + (b.potential_win || 0), 0);
    const ggr = totalStake - totalPayout;
    const allTx = transactions || [];
    const deposits = allTx.filter(t => t.type === "deposit").reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const withdrawals = allTx.filter(t => t.type === "withdrawal").reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    // Totals (for previous period comparison)
    const prevSince = new Date(since);
    prevSince.setDate(prevSince.getDate() - days);
    const { data: prevBets } = await supabase
      .from("bets")
      .select("stake, status, potential_win")
      .gte("created_at", prevSince.toISOString())
      .lt("created_at", since.toISOString());

    const prevStake = (prevBets || []).reduce((s, b) => s + (b.stake || 0), 0);
    const prevPayout = (prevBets || []).filter(b => b.status === "won").reduce((s, b) => s + (b.potential_win || 0), 0);

    return NextResponse.json({
      stats,
      kpis: {
        total_bets: allBets.length,
        total_stake: totalStake,
        total_payout: totalPayout,
        ggr,
        margin_pct: totalStake > 0 ? (ggr / totalStake) * 100 : 0,
        deposits,
        withdrawals,
        new_users: (users || []).length,
        risk_alerts: (riskFlags || []).length,
        open_bets: allBets.filter(b => b.status === "open").length,
      },
      prev_kpis: {
        total_bets: (prevBets || []).length,
        total_stake: prevStake,
        ggr: prevStake - prevPayout,
      },
      source: "computed",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Compute and store daily stats for a specific date
export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { date } = await req.json();
    if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const [
      { data: bets },
      { data: users },
      { data: transactions },
      { data: flags },
    ] = await Promise.all([
      supabase.from("bets").select("stake, status, potential_win, bet_selections(events(sports(name)))").gte("created_at", dayStart).lte("created_at", dayEnd),
      supabase.from("users").select("id").gte("created_at", dayStart).lte("created_at", dayEnd),
      supabase.from("transactions").select("type, amount").gte("created_at", dayStart).lte("created_at", dayEnd),
      supabase.from("risk_flags").select("id").gte("created_at", dayStart).lte("created_at", dayEnd),
    ]);

    const allBets = bets || [];
    const totalStake = allBets.reduce((s, b) => s + (b.stake || 0), 0);
    const totalPayout = allBets.filter(b => b.status === "won").reduce((s, b) => s + (b.potential_win || 0), 0);
    const ggr = totalStake - totalPayout;
    const allTx = transactions || [];

    // Sport breakdown
    const sportBreakdown: Record<string, { count: number; stake: number }> = {};
    for (const b of allBets) {
      const sportName = (b as any).bet_selections?.[0]?.events?.sports?.name || "Altro";
      if (!sportBreakdown[sportName]) sportBreakdown[sportName] = { count: 0, stake: 0 };
      sportBreakdown[sportName].count++;
      sportBreakdown[sportName].stake += b.stake || 0;
    }

    const row = {
      date,
      bet_count: allBets.length,
      total_stake: totalStake,
      total_payout: totalPayout,
      ggr,
      margin_pct: totalStake > 0 ? (ggr / totalStake) * 100 : 0,
      deposit_count: allTx.filter(t => t.type === "deposit").length,
      deposit_volume: allTx.filter(t => t.type === "deposit").reduce((s, t) => s + Math.abs(t.amount || 0), 0),
      withdrawal_count: allTx.filter(t => t.type === "withdrawal").length,
      withdrawal_volume: allTx.filter(t => t.type === "withdrawal").reduce((s, t) => s + Math.abs(t.amount || 0), 0),
      new_users: (users || []).length,
      active_users: 0,
      risk_alerts: (flags || []).length,
      sport_breakdown: sportBreakdown,
    };

    const { data, error } = await supabase
      .from("daily_stats")
      .upsert(row, { onConflict: "date" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
