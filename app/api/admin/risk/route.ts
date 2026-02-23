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
    const tab = req.nextUrl.searchParams.get("tab") || "overview";
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
    const severity = req.nextUrl.searchParams.get("severity");
    const status = req.nextUrl.searchParams.get("status");
    const offset = (page - 1) * limit;

    if (tab === "overview") {
      // KPI aggregates
      const [
        { data: openAlerts },
        { data: criticalAlerts },
        { data: flaggedBets },
        { data: flaggedUsers },
        { data: recentAlerts },
        { data: todayBlocked },
      ] = await Promise.all([
        supabase.from("risk_flags").select("id", { count: "exact" }).eq("status", "open"),
        supabase.from("risk_flags").select("id", { count: "exact" }).eq("severity", "critical").eq("status", "open"),
        supabase.from("bets").select("risk_score").not("risk_score", "is", null).gt("risk_score", 0),
        supabase.from("player_profiles").select("id", { count: "exact" }).gt("risk_score", 50),
        supabase.from("risk_flags").select("*, users(username, email)").order("created_at", { ascending: false }).limit(10),
        supabase.from("risk_flags").select("id", { count: "exact" }).eq("flag_type", "auto_block").gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
      ]);

      // Score distribution
      const allScores = (flaggedBets || []).map(b => b.risk_score || 0);
      const distribution = {
        low: allScores.filter(s => s <= 25).length,
        medium: allScores.filter(s => s > 25 && s <= 50).length,
        high: allScores.filter(s => s > 50 && s <= 75).length,
        critical: allScores.filter(s => s > 75).length,
      };

      const avgScore = allScores.length > 0
        ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
        : 0;

      // Sport risk breakdown
      const { data: sportBets } = await supabase
        .from("bets")
        .select("risk_score, bet_selections(events(sports(name)))")
        .not("risk_score", "is", null)
        .gt("risk_score", 0)
        .limit(500);

      const sportRisk: Record<string, { count: number; totalScore: number }> = {};
      for (const b of sportBets || []) {
        const sportName = (b as any).bet_selections?.[0]?.events?.sports?.name || "Altro";
        if (!sportRisk[sportName]) sportRisk[sportName] = { count: 0, totalScore: 0 };
        sportRisk[sportName].count++;
        sportRisk[sportName].totalScore += b.risk_score || 0;
      }

      return NextResponse.json({
        kpis: {
          open_alerts: openAlerts?.length || 0,
          critical_alerts: criticalAlerts?.length || 0,
          avg_score: avgScore,
          flagged_users: flaggedUsers?.length || 0,
          blocked_today: todayBlocked?.length || 0,
        },
        distribution,
        recent_alerts: recentAlerts || [],
        sport_risk: Object.entries(sportRisk).map(([sport, data]) => ({
          sport,
          count: data.count,
          avg_score: Math.round(data.totalScore / data.count),
        })),
      });
    }

    if (tab === "alerts") {
      let query = supabase
        .from("risk_flags")
        .select("*, users(username, email)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (severity) query = query.eq("severity", severity);
      if (status) query = query.eq("status", status);

      const { data, count } = await query;

      return NextResponse.json({
        alerts: data || [],
        total: count || 0,
        page,
        total_pages: Math.ceil((count || 0) / limit),
      });
    }

    if (tab === "users") {
      const { data: profiles, count } = await supabase
        .from("player_profiles")
        .select("*, users(username, email, kyc_status, user_class, created_at, is_blocked)", { count: "exact" })
        .gt("risk_score", 0)
        .order("risk_score", { ascending: false })
        .range(offset, offset + limit - 1);

      return NextResponse.json({
        users: profiles || [],
        total: count || 0,
        page,
        total_pages: Math.ceil((count || 0) / limit),
      });
    }

    if (tab === "stats") {
      const { data: flags } = await supabase
        .from("risk_flags")
        .select("severity, flag_type, status, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);

      const byType: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      const byDay: Record<string, number> = {};

      for (const f of flags || []) {
        byType[f.flag_type] = (byType[f.flag_type] || 0) + 1;
        bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
        const day = f.created_at?.substring(0, 10) || "";
        byDay[day] = (byDay[day] || 0) + 1;
      }

      return NextResponse.json({ byType, bySeverity, byDay });
    }

    return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Update alert status
export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { id, status } = await req.json();

    const { data } = await supabase
      .from("risk_flags")
      .update({
        status,
        resolved_at: ["resolved", "dismissed"].includes(status) ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select()
      .single();

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
