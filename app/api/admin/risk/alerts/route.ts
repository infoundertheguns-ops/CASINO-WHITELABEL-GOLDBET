export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getScopedPlayerIds, hasPermission } from "@/lib/agent-permissions";

// GET /api/admin/risk/alerts
// ?alert_type=XXX&period=7d|30d|1d&page=1&limit=20

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { data: adminRecord } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).limit(1).maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let myAgent: any = null;
  let scopedPlayerIds: string[] | null = null;

  if (!isSuperAdmin) {
    myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    if (!hasPermission(myAgent.permissions, "risk", "viewer"))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
    scopedPlayerIds = await getScopedPlayerIds(supabase, myAgent.id);
  }

  const sp = req.nextUrl.searchParams;
  const alertType = sp.get("alert_type");
  const period = sp.get("period") || "7d";
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  // Calculate cutoff date
  const days = period === "1d" ? 1 : period === "30d" ? 30 : 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    let query = supabase
      .from("risk_alerts")
      .select("id, alert_type, player_id, agent_id, details, notified, created_at", { count: "exact" })
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (alertType) query = query.eq("alert_type", alertType);

    if (scopedPlayerIds !== null) {
      if (scopedPlayerIds.length === 0) {
        return NextResponse.json({ alerts: [], pagination: { page, limit, total: 0, total_pages: 0 } });
      }
      query = query.in("player_id", scopedPlayerIds);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      alerts: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
