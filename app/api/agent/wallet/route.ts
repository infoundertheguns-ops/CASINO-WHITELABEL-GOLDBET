export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent } from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  // Auth
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();

  // Detect agent (only agents can access, not super admin)
  const agent = await detectAgent(supabase, authUser.id);
  if (!agent) return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });

  // Query params
  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "30d";
  const type = searchParams.get("type") || "";
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = (page - 1) * limit;

  // Period filter
  let fromDate: string | null = null;
  const now = new Date();
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    fromDate = start.toISOString();
  } else if (period === "7d") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    fromDate = start.toISOString();
  } else {
    // 30d default
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    fromDate = start.toISOString();
  }

  // Fetch agent wallet
  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, balance, total_loaded, total_distributed, wallet_model, updated_at")
    .eq("agent_id", agent.id)
    .eq("owner_type", "agent")
    .single();

  // Build transactions query
  let txQuery = supabase
    .from("agent_transactions")
    .select("*", { count: "exact" })
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false });

  if (fromDate) txQuery = txQuery.gte("created_at", fromDate);
  if (type) txQuery = txQuery.eq("type", type);

  const { data: transactions, count } = await txQuery.range(offset, offset + limit - 1);

  // KPI: total commissions (all time or within period)
  let commQuery = supabase
    .from("agent_transactions")
    .select("amount")
    .eq("agent_id", agent.id)
    .eq("type", "commission");
  if (fromDate) commQuery = commQuery.gte("created_at", fromDate);
  const { data: commRows } = await commQuery;
  const totalCommissions = (commRows || []).reduce((sum: number, r: any) => sum + Math.abs(r.amount || 0), 0);

  // Aggregates from wallet table
  const balance = wallet?.balance ?? 0;
  const totalLoaded = wallet?.total_loaded ?? 0;
  const totalDistributed = wallet?.total_distributed ?? 0;

  return NextResponse.json({
    wallet_model: agent.wallet_model || "prepaid",
    wallet: {
      balance,
      total_loaded: totalLoaded,
      total_distributed: totalDistributed,
    },
    kpis: {
      balance,
      total_loaded: totalLoaded,
      total_distributed: totalDistributed,
      total_commissions: totalCommissions,
    },
    transactions: transactions || [],
    pagination: {
      page,
      limit,
      total: count ?? 0,
    },
  });
}
