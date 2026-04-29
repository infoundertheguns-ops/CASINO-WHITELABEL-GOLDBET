export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { detectAgent, getDescendantAgentIds } from "@/lib/agent-permissions";

// GET — List agent settlements with KPIs
// ?status=pending|approved|paid&agent_id=UUID&page=1&limit=20
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const authClient = await createClient();
  const sp = req.nextUrl.searchParams;

  const status = sp.get("status") || "";
  const filterAgentId = sp.get("agent_id") || "";
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;

  // ── Auth: determine role ──
  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { data: adminRecord } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", authUser.id)
    .limit(1)
    .maybeSingle();

  const isSuperAdmin = !!adminRecord;
  let myAgent = null;
  let scopedAgentIds: string[] | null = null;

  if (!isSuperAdmin) {
    myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    if (myAgent.level === 1) {
      // Master: sees own + all descendants
      scopedAgentIds = await getDescendantAgentIds(supabase, myAgent.id);
    } else {
      // Level 2/3: only own settlements
      scopedAgentIds = [myAgent.id];
    }
  }

  // ── Build query ──
  let query = supabase
    .from("agent_settlements")
    .select(`
      id,
      agent_id,
      period_start,
      period_end,
      total_turnover,
      total_winnings,
      ggr,
      commission_pct,
      commission_amount,
      status,
      notes,
      approved_at,
      approved_by,
      paid_at,
      paid_by,
      created_at,
      agents!inner(name, code, level)
    `, { count: "exact" })
    .order("created_at", { ascending: false });

  // Scoping
  if (scopedAgentIds) {
    query = query.in("agent_id", scopedAgentIds);
  }
  if (filterAgentId) {
    query = query.eq("agent_id", filterAgentId);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const { data: settlements, count, error } = await query.range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── KPIs: commission totals grouped by status ──
  let kpiQuery = supabase
    .from("agent_settlements")
    .select("status, commission_amount");

  if (scopedAgentIds) kpiQuery = kpiQuery.in("agent_id", scopedAgentIds);
  if (filterAgentId) kpiQuery = kpiQuery.eq("agent_id", filterAgentId);

  const { data: kpiRows } = await kpiQuery;
  const kpis = { pending: 0, approved: 0, paid: 0 };
  for (const row of (kpiRows || [])) {
    const s = row.status as "pending" | "approved" | "paid";
    if (s in kpis) kpis[s] += row.commission_amount || 0;
  }

  const canApprove = isSuperAdmin || (myAgent?.level === 1);

  return NextResponse.json({
    kpis,
    settlements: settlements || [],
    pagination: {
      page,
      limit,
      total: count || 0,
      pages: Math.ceil((count || 0) / limit),
    },
    can_approve: canApprove,
    my_agent_id: myAgent?.id || null,
  });
}
