import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_PERMISSIONS } from "@/lib/types/agent";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — List all agents
export async function GET() {
  const supabase = createAdminClient();

  const { data: agents, error } = await supabase
    .from("agents")
    .select("*")
    .order("level")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with player counts and wallet balance
  const enriched = await Promise.all((agents || []).map(async (agent: any) => {
    const { count: playerCount } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agent.id);

    const { count: subAgentCount } = await supabase
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", agent.id);

    // Get agent wallet balance if prepaid
    let walletBalance = null;
    if (agent.wallet_model === "prepaid") {
      const { data: wallet } = await supabase
        .from("wallets")
        .select("balance")
        .eq("agent_id", agent.id)
        .eq("owner_type", "agent")
        .limit(1)
        .maybeSingle();
      walletBalance = wallet?.balance ?? 0;
    }

    // Get parent name
    let parentName = null;
    if (agent.parent_id) {
      const { data: parent } = await supabase
        .from("agents")
        .select("name")
        .eq("id", agent.parent_id)
        .limit(1)
        .maybeSingle();
      parentName = parent?.name;
    }

    return {
      ...agent,
      player_count: playerCount || 0,
      sub_agent_count: subAgentCount || 0,
      wallet_balance: walletBalance,
      parent_name: parentName,
    };
  }));

  return NextResponse.json({ agents: enriched });
}

// POST — Create new agent
export async function POST(req: NextRequest) {
  const supabase = getAdminSupabase();
  const body = await req.json();

  const { name, code, level, parent_id, wallet_model, commission_rate, email: rawEmail, password, permissions, username } = body;

  if (!name || !code || !level || !password) {
    return NextResponse.json({ error: "Campi obbligatori: name, code, level, password" }, { status: 400 });
  }

  // Email is optional — generate a placeholder if not provided
  const email = rawEmail || `${code.toLowerCase()}@agents.vincitu.local`;

  if (level < 1 || level > 3) {
    return NextResponse.json({ error: "Level deve essere 1, 2 o 3" }, { status: 400 });
  }

  // Check code uniqueness
  const { data: existing } = await supabase
    .from("agents")
    .select("id")
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: `Codice '${code}' già in uso` }, { status: 409 });
  }

  // Validate parent
  if (level > 1 && !parent_id) {
    return NextResponse.json({ error: "Agent di livello 2+ richiede un parent" }, { status: 400 });
  }

  if (parent_id) {
    const { data: parent } = await supabase
      .from("agents")
      .select("id, level")
      .eq("id", parent_id)
      .limit(1)
      .maybeSingle();

    if (!parent) {
      return NextResponse.json({ error: "Parent agent non trovato" }, { status: 404 });
    }
    if (parent.level >= level) {
      return NextResponse.json({ error: `Parent (level ${parent.level}) deve avere livello inferiore a ${level}` }, { status: 400 });
    }
  }

  // Create auth user for agent
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    return NextResponse.json({ error: "Errore creazione account: " + (authError?.message || "") }, { status: 500 });
  }

  // Create user profile FIRST (agents FK references public.users)
  const agentUsername = username || code.toLowerCase();
  await supabase.from("users").upsert({
    id: authUser.user.id,
    email,
    username: agentUsername,
    display_name: name,
    is_active: true,
  }, { onConflict: "id" });

  // Create agent record
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .insert({
      user_id: authUser.user.id,
      name,
      code,
      level,
      parent_id: parent_id || null,
      wallet_model: wallet_model || "postpaid",
      commission_type: "ggr_percentage",
      commission_rate: commission_rate || 0,
      permissions: permissions || DEFAULT_PERMISSIONS,
      status: "active",
      is_active: true,
    })
    .select("*")
    .single();

  if (agentError) {
    // Cleanup: delete auth user
    await supabase.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json({ error: "Errore creazione agente: " + agentError.message }, { status: 500 });
  }

  // Link user to agent
  await supabase.from("users").update({ agent_id: agent.id }).eq("id", authUser.user.id);

  // If prepaid, create agent wallet
  if (wallet_model === "prepaid") {
    await supabase.from("wallets").insert({
      user_id: authUser.user.id,
      agent_id: agent.id,
      owner_type: "agent",
      balance: 0,
      bonus_balance: 0,
      locked_balance: 0,
      total_deposited: 0,
      total_withdrawn: 0,
      total_wagered: 0,
      total_won: 0,
    });
  }

  return NextResponse.json({ agent }, { status: 201 });
}
