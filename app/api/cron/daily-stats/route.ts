import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════
// CRON: Daily Stats Aggregation (runs at 00:15)
// Computes: bets, stake, GGR, margin, deposits,
// withdrawals, users, risk alerts, sport breakdown
// ═══════════════════════════════════════════════════

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    // Calculate for yesterday
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().substring(0, 10);
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    // ── Bets ──
    const { data: dayBets } = await supabase
      .from("bets")
      .select("stake, actual_win, total_odds, status, bet_selections(events(sports(name)))")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .not("status", "eq", "rejected");

    const bets = dayBets || [];
    const totalStake = bets.reduce((s, b) => s + (b.stake || 0), 0);
    const totalPayout = bets
      .filter(b => b.status === "won")
      .reduce((s, b) => s + (b.actual_win || b.stake * (b.total_odds || 1) || 0), 0);
    const ggr = totalStake - totalPayout;
    const marginPct = totalStake > 0 ? (ggr / totalStake * 100) : 0;

    // Sport breakdown
    const sportBreakdown: Record<string, { count: number; stake: number }> = {};
    for (const b of bets) {
      const sportName = (b as any).bet_selections?.[0]?.events?.sports?.name || "Altro";
      if (!sportBreakdown[sportName]) sportBreakdown[sportName] = { count: 0, stake: 0 };
      sportBreakdown[sportName].count++;
      sportBreakdown[sportName].stake += b.stake || 0;
    }

    // ── Deposits ──
    const { data: deposits } = await supabase
      .from("transactions")
      .select("amount")
      .eq("type", "deposit")
      .eq("status", "completed")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);

    const depositCount = deposits?.length || 0;
    const depositVolume = (deposits || []).reduce((s, d) => s + Math.abs(d.amount || 0), 0);

    // ── Withdrawals ──
    const { data: withdrawals } = await supabase
      .from("transactions")
      .select("amount")
      .eq("type", "withdrawal")
      .eq("status", "completed")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);

    const withdrawalCount = withdrawals?.length || 0;
    const withdrawalVolume = (withdrawals || []).reduce((s, w) => s + Math.abs(w.amount || 0), 0);

    // ── Users ──
    const { data: newUsers } = await supabase
      .from("users")
      .select("id", { count: "exact" })
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);

    const { data: activeBettors } = await supabase
      .from("bets")
      .select("user_id")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);

    const activeUsers = new Set((activeBettors || []).map(b => b.user_id)).size;

    // ── Risk Alerts ──
    const { data: riskAlerts } = await supabase
      .from("risk_flags")
      .select("id", { count: "exact" })
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);

    // ── Upsert ──
    const stats = {
      date: dateStr,
      bet_count: bets.length,
      total_stake: totalStake,
      total_payout: totalPayout,
      ggr,
      margin_pct: parseFloat(marginPct.toFixed(2)),
      deposit_count: depositCount,
      deposit_volume: depositVolume,
      withdrawal_count: withdrawalCount,
      withdrawal_volume: withdrawalVolume,
      new_users: newUsers?.length || 0,
      active_users: activeUsers,
      risk_alerts: riskAlerts?.length || 0,
      sport_breakdown: sportBreakdown,
    };

    await supabase.from("daily_stats").upsert(stats, { onConflict: "date" });

    return NextResponse.json({ success: true, date: dateStr, stats });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
