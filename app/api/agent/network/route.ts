export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  detectAgent,
  getDescendantAgentIds,
  hasPermission,
} from "@/lib/agent-permissions";
import { DEFAULT_PERMISSIONS, PERMISSION_KEYS } from "@/lib/types/agent";
import type { AgentPermissions, PermissionLevel } from "@/lib/types/agent";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — List agent's network tree
export async function GET() {
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

  // Get all descendant IDs (excluding self)
  const allIds = await getDescendantAgentIds(supabase, agent.id);
  const descendantIds = allIds.filter((id) => id !== agent.id);

  if (descendantIds.length === 0) {
    return NextResponse.json({
      agents: [],
      master: {
        id: agent.id,
        name: agent.name,
        code: agent.code,
        level: agent.level,
      },
    });
  }

  // Fetch agents with user JOIN for username
  const { data: agentsData, error } = await supabase
    .from("agents")
    .select("*, users(username, email)")
    .in("id", descendantIds)
    .order("level")
    .order("name");

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich each agent with player_count and wallet_balance
  const enriched = await Promise.all(
    (agentsData || []).map(async (a: any) => {
      const { count: playerCount } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", a.id);

      let walletBalance: number | null = null;
      if (a.wallet_model === "prepaid") {
        const { data: wallet } = await supabase
          .from("wallets")
          .select("balance")
          .eq("agent_id", a.id)
          .eq("owner_type", "agent")
          .limit(1)
          .maybeSingle();
        walletBalance = wallet?.balance ?? 0;
      }

      return {
        ...a,
        username: a.users?.username || null,
        player_count: playerCount || 0,
        wallet_balance: walletBalance,
      };
    })
  );

  return NextResponse.json({
    agents: enriched,
    master: {
      id: agent.id,
      name: agent.name,
      code: agent.code,
      level: agent.level,
    },
  });
}

// POST — Create agent in network (Master level 1 only)
export async function POST(req: NextRequest) {
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
      { error: "Solo i Master Agent (livello 1) possono creare agenti nella rete" },
      { status: 403 }
    );
  }

  if (!hasPermission(agent.permissions, "sub_agents", "editor")) {
    return NextResponse.json(
      { error: "Non hai permesso di gestire la rete agenti" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const {
    name,
    code,
    username,
    password,
    level,
    parent_id,
    wallet_model,
    commission_rate,
    settlement_period,
    permissions,
  } = body;

  // Basic validation
  if (!name || !code || !username || !password || !level) {
    return NextResponse.json(
      { error: "Campi obbligatori: name, code, username, password, level" },
      { status: 400 }
    );
  }

  if (level !== 2 && level !== 3) {
    return NextResponse.json(
      { error: "Level deve essere 2 o 3" },
      { status: 400 }
    );
  }

  // Determine and validate parent_id
  let resolvedParentId: string;
  if (level === 2) {
    resolvedParentId = agent.id;
  } else {
    // level === 3: parent_id must be a level 2 agent in master's network
    if (!parent_id) {
      return NextResponse.json(
        { error: "parent_id obbligatorio per agenti di livello 3" },
        { status: 400 }
      );
    }

    const networkIds = await getDescendantAgentIds(supabase, agent.id);
    const { data: parentAgent } = await supabase
      .from("agents")
      .select("id, level, parent_id")
      .eq("id", parent_id)
      .limit(1)
      .maybeSingle();

    if (!parentAgent || !networkIds.includes(parentAgent.id)) {
      return NextResponse.json(
        { error: "parent_id non appartiene alla tua rete" },
        { status: 400 }
      );
    }
    if (parentAgent.level !== 2) {
      return NextResponse.json(
        { error: "Per agenti di livello 3, il parent deve essere di livello 2" },
        { status: 400 }
      );
    }
    resolvedParentId = parent_id;
  }

  // Validate commission_rate <= master's rate
  const rate = commission_rate ?? 0;
  if (rate > agent.commission_rate) {
    return NextResponse.json(
      {
        error: `commission_rate (${rate}) non può superare la tua commissione (${agent.commission_rate})`,
      },
      { status: 400 }
    );
  }

  // Validate permissions <= master's permissions
  const resolvedPermissions: AgentPermissions = permissions || DEFAULT_PERMISSIONS;
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

  // Check code uniqueness
  const { data: existingCode } = await supabase
    .from("agents")
    .select("id")
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  if (existingCode) {
    return NextResponse.json(
      { error: `Codice '${code}' già in uso` },
      { status: 409 }
    );
  }

  // Check username uniqueness
  const { data: existingUsername } = await supabase
    .from("users")
    .select("id")
    .eq("username", username)
    .limit(1)
    .maybeSingle();

  if (existingUsername) {
    return NextResponse.json(
      { error: `Username '${username}' già in uso` },
      { status: 409 }
    );
  }

  // Create auth user
  const email = `${username.toLowerCase()}@agent.betssolution.com`;
  const { data: authUserData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });

  if (authError || !authUserData.user) {
    return NextResponse.json(
      { error: "Errore creazione account: " + (authError?.message || "") },
      { status: 500 }
    );
  }

  const newUserId = authUserData.user.id;

  // Create user profile (DO NOT set agent_id here)
  const { error: profileError } = await supabase.from("users").upsert(
    {
      id: newUserId,
      email,
      username,
      display_name: name,
      is_active: true,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    await supabase.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { error: "Errore creazione profilo: " + profileError.message },
      { status: 500 }
    );
  }

  // Create agent record
  const { data: newAgent, error: agentError } = await supabase
    .from("agents")
    .insert({
      user_id: newUserId,
      parent_id: resolvedParentId,
      level,
      name,
      code,
      wallet_model: wallet_model || "postpaid",
      commission_type: "ggr_percentage",
      commission_rate: rate,
      settlement_period: settlement_period || "monthly",
      permissions: resolvedPermissions,
      status: "active",
      is_active: true,
    })
    .select("*")
    .single();

  if (agentError) {
    await supabase.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { error: "Errore creazione agente: " + agentError.message },
      { status: 500 }
    );
  }

  // Create wallet if prepaid
  if (wallet_model === "prepaid") {
    await supabase.from("wallets").insert({
      user_id: newUserId,
      agent_id: newAgent.id,
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

  return NextResponse.json({ success: true, username, agent: newAgent }, { status: 201 });
}
