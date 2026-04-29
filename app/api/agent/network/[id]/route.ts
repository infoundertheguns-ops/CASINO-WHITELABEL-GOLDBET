export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  detectAgent,
  getDescendantAgentIds,
  hasPermission,
} from "@/lib/agent-permissions";
import { PERMISSION_KEYS } from "@/lib/types/agent";
import type { AgentPermissions, PermissionLevel } from "@/lib/types/agent";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — Agent detail
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userSupabase = await createServerClient();
  const {
    data: { user: authUser },
  } = await userSupabase.auth.getUser();
  if (!authUser)
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();

  const agent = await detectAgent(supabase, authUser.id);
  if (!agent)
    return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });

  if (!hasPermission(agent.permissions, "sub_agents", "viewer")) {
    return NextResponse.json(
      { error: "Non hai permesso di visualizzare la rete agenti" },
      { status: 403 }
    );
  }

  // Verify target is in network
  const networkIds = await getDescendantAgentIds(supabase, agent.id);
  const targetId = params.id;

  if (!networkIds.includes(targetId) || targetId === agent.id) {
    return NextResponse.json(
      { error: "Agente non trovato nella tua rete" },
      { status: 404 }
    );
  }

  // Fetch target agent with user info
  const { data: targetAgent, error } = await supabase
    .from("agents")
    .select("*, users(username, email)")
    .eq("id", targetId)
    .single();

  if (error || !targetAgent)
    return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });

  // Player count
  const { count: playerCount } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", targetId);

  // Wallet
  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("agent_id", targetId)
    .eq("owner_type", "agent")
    .limit(1)
    .maybeSingle();

  // Last 50 transactions
  const { data: transactions } = await supabase
    .from("agent_transactions")
    .select("*")
    .eq("agent_id", targetId)
    .order("created_at", { ascending: false })
    .limit(50);

  // Direct sub-agents
  const { data: subAgents } = await supabase
    .from("agents")
    .select("id, name, code, level, status, wallet_model, commission_rate")
    .eq("parent_id", targetId)
    .order("name");

  return NextResponse.json({
    agent: {
      ...targetAgent,
      username: targetAgent.users?.username || null,
    },
    player_count: playerCount || 0,
    wallet: wallet || null,
    transactions: transactions || [],
    sub_agents: subAgents || [],
  });
}

// PUT — Update agent
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userSupabase = await createServerClient();
  const {
    data: { user: authUser },
  } = await userSupabase.auth.getUser();
  if (!authUser)
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();

  const agent = await detectAgent(supabase, authUser.id);
  if (!agent)
    return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });

  if (agent.level !== 1) {
    return NextResponse.json(
      { error: "Solo i Master Agent (livello 1) possono modificare agenti" },
      { status: 403 }
    );
  }

  if (!hasPermission(agent.permissions, "sub_agents", "editor")) {
    return NextResponse.json(
      { error: "Non hai permesso di gestire la rete agenti" },
      { status: 403 }
    );
  }

  // Verify target is in network
  const networkIds = await getDescendantAgentIds(supabase, agent.id);
  const targetId = params.id;

  if (!networkIds.includes(targetId) || targetId === agent.id) {
    return NextResponse.json(
      { error: "Agente non trovato nella tua rete" },
      { status: 404 }
    );
  }

  const body = await req.json();
  const {
    name,
    commission_rate,
    permissions,
    status,
    wallet_model,
    settlement_period,
  } = body;

  // Build update object with only allowed fields
  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (status !== undefined) updates.status = status;
  if (wallet_model !== undefined) updates.wallet_model = wallet_model;
  if (settlement_period !== undefined) updates.settlement_period = settlement_period;

  // Validate commission_rate
  if (commission_rate !== undefined) {
    if (commission_rate > agent.commission_rate) {
      return NextResponse.json(
        {
          error: `commission_rate (${commission_rate}) non può superare la tua commissione (${agent.commission_rate})`,
        },
        { status: 400 }
      );
    }
    updates.commission_rate = commission_rate;
  }

  // Validate permissions
  if (permissions !== undefined) {
    const resolvedPermissions = permissions as AgentPermissions;
    for (const key of PERMISSION_KEYS) {
      const requested: PermissionLevel = resolvedPermissions[key] || "none";
      const masterLevel: PermissionLevel = agent.permissions[key] || "none";
      const levelRank = (l: PermissionLevel) =>
        l === "editor" ? 2 : l === "viewer" ? 1 : 0;
      if (levelRank(requested) > levelRank(masterLevel)) {
        return NextResponse.json(
          {
            error: `Permesso '${key}' (${requested}) superiore al tuo permesso (${masterLevel})`,
          },
          { status: 400 }
        );
      }
    }
    updates.permissions = resolvedPermissions;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("agents")
    .update(updates)
    .eq("id", targetId);

  if (updateError) {
    return NextResponse.json(
      { error: "Errore aggiornamento: " + updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
