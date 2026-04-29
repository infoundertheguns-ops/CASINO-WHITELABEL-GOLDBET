export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  detectAgent,
  getDescendantAgentIds,
  hasPermission,
} from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Load/unload sub-agent wallet
export async function POST(
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
      { error: "Solo i Master Agent (livello 1) possono gestire i wallet della rete" },
      { status: 403 }
    );
  }

  if (!hasPermission(agent.permissions, "credit", "editor")) {
    return NextResponse.json(
      { error: "Non hai permesso di gestire il credito" },
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

  // Fetch target agent
  const { data: targetAgent } = await supabase
    .from("agents")
    .select("id, name, wallet_model")
    .eq("id", targetId)
    .single();

  if (!targetAgent) {
    return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });
  }

  if (targetAgent.wallet_model !== "prepaid") {
    return NextResponse.json(
      { error: "Solo agenti prepaid hanno un wallet gestibile" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const { action, amount, notes } = body;

  if (!action || !amount || amount <= 0) {
    return NextResponse.json(
      { error: "action (load/unload) e amount positivo richiesti" },
      { status: 400 }
    );
  }

  if (action !== "load" && action !== "unload") {
    return NextResponse.json(
      { error: "action deve essere 'load' o 'unload'" },
      { status: 400 }
    );
  }

  // Get target wallet
  const { data: targetWallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("agent_id", targetId)
    .eq("owner_type", "agent")
    .limit(1)
    .maybeSingle();

  if (!targetWallet) {
    return NextResponse.json(
      { error: "Wallet agente non trovato" },
      { status: 404 }
    );
  }

  // If master is prepaid and loading: check master wallet has enough, deduct
  if (agent.wallet_model === "prepaid" && action === "load") {
    const { data: masterWallet } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("agent_id", agent.id)
      .eq("owner_type", "agent")
      .limit(1)
      .maybeSingle();

    if (!masterWallet || masterWallet.balance < amount) {
      return NextResponse.json(
        {
          error: `Credito master insufficiente (${masterWallet?.balance ?? 0})`,
        },
        { status: 400 }
      );
    }

    // Deduct from master wallet
    await supabase
      .from("wallets")
      .update({ balance: masterWallet.balance - amount })
      .eq("id", masterWallet.id);
  }

  // If unloading: check target has enough
  if (action === "unload" && targetWallet.balance < amount) {
    return NextResponse.json(
      { error: `Saldo agente insufficiente (${targetWallet.balance})` },
      { status: 400 }
    );
  }

  // Update target wallet
  const newBalance =
    action === "load"
      ? targetWallet.balance + amount
      : targetWallet.balance - amount;

  await supabase
    .from("wallets")
    .update({ balance: newBalance })
    .eq("id", targetWallet.id);

  // If master is prepaid and unloading: credit back to master wallet
  if (agent.wallet_model === "prepaid" && action === "unload") {
    const { data: masterWallet } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("agent_id", agent.id)
      .eq("owner_type", "agent")
      .limit(1)
      .maybeSingle();

    if (masterWallet) {
      await supabase
        .from("wallets")
        .update({ balance: masterWallet.balance + amount })
        .eq("id", masterWallet.id);
    }
  }

  // Log transaction
  await supabase.from("agent_transactions").insert({
    agent_id: agent.id,
    type: action === "load" ? "sub_agent_load" : "sub_agent_unload",
    amount: action === "load" ? -amount : amount,
    balance_after: newBalance,
    target_user_id: targetAgent.id,
    notes:
      notes ||
      `${action === "load" ? "Caricamento" : "Scaricamento"} wallet agente ${targetAgent.name}`,
    performed_by: authUser.id,
  });

  // Also log on target agent's transaction history
  await supabase.from("agent_transactions").insert({
    agent_id: targetId,
    type: action === "load" ? "wallet_load" : "wallet_unload",
    amount: action === "load" ? amount : -amount,
    balance_after: newBalance,
    notes:
      notes ||
      `${action === "load" ? "Caricamento" : "Scaricamento"} da master`,
    performed_by: authUser.id,
  });

  return NextResponse.json({ success: true, balance: newBalance });
}
