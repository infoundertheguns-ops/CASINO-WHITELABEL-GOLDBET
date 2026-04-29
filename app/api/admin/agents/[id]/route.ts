export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — Agent detail
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });
  }

  // Player count
  const { count: playerCount } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", id);

  // Sub-agents
  const { data: subAgents } = await supabase
    .from("agents")
    .select("id, name, code, level, status, commission_rate")
    .eq("parent_id", id)
    .order("name");

  // Recent transactions
  const { data: transactions } = await supabase
    .from("agent_transactions")
    .select("*")
    .eq("agent_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Wallet (if prepaid)
  let wallet = null;
  if (agent.wallet_model === "prepaid") {
    const { data: w } = await supabase
      .from("wallets")
      .select("*")
      .eq("agent_id", id)
      .eq("owner_type", "agent")
      .limit(1)
      .maybeSingle();
    wallet = w;
  }

  // Settlements
  const { data: settlements } = await supabase
    .from("agent_settlements")
    .select("*")
    .eq("agent_id", id)
    .order("period_end", { ascending: false })
    .limit(10);

  return NextResponse.json({
    agent,
    player_count: playerCount || 0,
    sub_agents: subAgents || [],
    transactions: transactions || [],
    wallet,
    settlements: settlements || [],
  });
}

// PUT — Update agent
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const body = await req.json();

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.status !== undefined) updates.status = body.status;
  if (body.wallet_model !== undefined) updates.wallet_model = body.wallet_model;
  if (body.commission_rate !== undefined) updates.commission_rate = body.commission_rate;
  if (body.permissions !== undefined) updates.permissions = body.permissions;
  if (body.is_active !== undefined) updates.is_active = body.is_active;

  const { data, error } = await supabase
    .from("agents")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agent: data });
}
