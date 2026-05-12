export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ═══ In-memory cache (globalThis survives module re-evaluation) ═══
const g = globalThis as any;
if (!g.__statsCache) g.__statsCache = {};
const cache: Record<string, { data: any; ts: number; refreshing?: boolean }> = g.__statsCache;
const CACHE_TTL = 300_000; // 5 minutes

function getCached(key: string): any | null {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function getStale(key: string): any | null {
  return cache[key]?.data || null;
}

function setCache(key: string, data: any) {
  cache[key] = { data, ts: Date.now() };
}

async function fetchDashboardData(supabase: any, range: string) {
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  const [
    { data: dailyStats },
    { data: recentBets },
    { data: recentUsers },
  ] = await Promise.all([
    supabase.from("daily_stats").select("*").gte("date", sinceStr).order("date", { ascending: true }),
    supabase.from("bets").select("id, user_id, stake, total_odds, potential_win, status, risk_score, bet_type, created_at").order("created_at", { ascending: false }).limit(15),
    supabase.from("users").select("id, username, email, kyc_status, created_at").order("created_at", { ascending: false }).limit(10),
  ]);

  // Map user_id → username
  const userMap: Record<string, string> = {};
  for (const u of recentUsers || []) userMap[u.id] = u.username || "—";
  const missingIds = (recentBets || []).map((b: any) => b.user_id).filter((id: string) => id && !userMap[id]);
  if (missingIds.length > 0) {
    const uniqueIds = [...new Set(missingIds)] as string[];
    const { data: extraUsers } = await supabase.from("users").select("id, username").in("id", uniqueIds);
    for (const u of extraUsers || []) userMap[u.id] = u.username || "—";
  }

  const stats = dailyStats || [];
  const totalStake = stats.reduce((s: number, d: any) => s + (d.total_stake || 0), 0);
  const totalPayout = stats.reduce((s: number, d: any) => s + (d.total_payout || 0), 0);
  const totalBets = stats.reduce((s: number, d: any) => s + (d.bet_count || 0), 0);
  const deposits = stats.reduce((s: number, d: any) => s + (d.deposit_volume || 0), 0);
  const riskAlerts = stats.reduce((s: number, d: any) => s + (d.risk_alerts || 0), 0);
  const totalNewUsers = stats.reduce((s: number, d: any) => s + (d.new_users || 0), 0);
  const ggr = totalStake - totalPayout;

  return {
    stats,
    kpis: {
      total_users: Math.max((recentUsers || []).length, totalNewUsers),
      total_bets: totalBets,
      total_stake: totalStake,
      ggr,
      margin_pct: totalStake > 0 ? (ggr / totalStake) * 100 : 0,
      deposits,
      open_bets: 0,
      risk_alerts: riskAlerts,
    },
    prev_kpis: {},
    recent_bets: (recentBets || []).map((b: any) => ({
      id: b.id, username: userMap[b.user_id] || "—", stake: b.stake, total_odds: b.total_odds,
      potential_win: b.potential_win, status: b.status, risk_score: b.risk_score || 0,
      bet_type: b.bet_type, created_at: b.created_at,
    })),
    recent_users: recentUsers || [],
    source: "cached",
  };
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();

    // Lightweight recent bets endpoint for ticker
    const recentBetsLimit = req.nextUrl.searchParams.get("recent_bets");
    if (recentBetsLimit) {
      const limit = Math.min(parseInt(recentBetsLimit) || 10, 30);
      const { data: bets } = await supabase
        .from("bets")
        .select("id, stake, total_odds, risk_score, bet_type, is_live, created_at, users(username)")
        .order("created_at", { ascending: false })
        .limit(limit);

      return NextResponse.json({
        recent_bets: (bets || []).map(b => ({
          id: b.id,
          username: (b as any).users?.username || "—",
          stake: b.stake || 0,
          total_odds: b.total_odds || 1,
          risk_score: b.risk_score,
          bet_type: b.bet_type || "singola",
          is_live: b.is_live || false,
          selections: "",
          created_at: b.created_at,
        })),
      });
    }

    const range = req.nextUrl.searchParams.get("range") || "30d";
    const isDashboard = req.nextUrl.searchParams.get("dashboard") === "true";

    // ═══ Dashboard: stale-while-revalidate cache ═══
    if (isDashboard) {
      const cacheKey = `dashboard_${range}`;
      const fresh = getCached(cacheKey);
      if (fresh) return NextResponse.json(fresh);

      // Serve stale data immediately, refresh in background
      const stale = getStale(cacheKey);
      const entry = cache[cacheKey];
      if (stale && !entry?.refreshing) {
        entry!.refreshing = true;
        fetchDashboardData(supabase, range).then(data => {
          setCache(cacheKey, data);
        }).catch(() => { if (entry) entry.refreshing = false; });
        return NextResponse.json(stale);
      }

      // No cache at all — must wait for fresh data
      const data = await fetchDashboardData(supabase, range);
      setCache(cacheKey, data);
      return NextResponse.json(data);
    }

    // ═══ Non-dashboard stats endpoint ═══
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split("T")[0];

    // Try pre-computed stats first
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

    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      initDay(d.toISOString().split("T")[0]);
    }

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

    for (const d of Object.values(dayMap)) {
      d.ggr = d.total_stake - d.total_payout;
      d.margin_pct = d.total_stake > 0 ? (d.ggr / d.total_stake) * 100 : 0;
    }

    const stats = Object.values(dayMap).sort((a: any, b: any) => a.date.localeCompare(b.date));

    const allBets = bets || [];
    const totalStake = allBets.reduce((s: number, b: any) => s + (b.stake || 0), 0);
    const totalPayout = allBets.filter((b: any) => b.status === "won").reduce((s: number, b: any) => s + (b.potential_win || 0), 0);
    const ggr = totalStake - totalPayout;
    const allTx = transactions || [];
    const deposits = allTx.filter((t: any) => t.type === "deposit").reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);

    return NextResponse.json({
      stats,
      kpis: {
        total_bets: allBets.length,
        total_stake: totalStake,
        ggr,
        margin_pct: totalStake > 0 ? (ggr / totalStake) * 100 : 0,
        deposits,
        new_users: (users || []).length,
        risk_alerts: (riskFlags || []).length,
        open_bets: allBets.filter((b: any) => b.status === "open").length,
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
      supabase.from("bets").select("stake, status, potential_win, bet_selections(event:events_v2(sport_name))").gte("created_at", dayStart).lte("created_at", dayEnd),
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
      const sportName = (b as any).bet_selections?.[0]?.event?.sport_name || "Altro";
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
