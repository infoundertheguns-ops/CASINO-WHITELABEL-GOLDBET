import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { detectAgent, hasPermission } from "@/lib/agent-permissions";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Agent loads/unloads player credit
export async function POST(req: NextRequest) {
  // Auth
  const userSupabase = await createServerClient();
  const { data: { user: authUser } } = await userSupabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const supabase = getAdminSupabase();

  // Detect agent
  const agent = await detectAgent(supabase, authUser.id);
  if (!agent) return NextResponse.json({ error: "Non sei un agente" }, { status: 403 });

  // Check permission
  if (!hasPermission(agent.permissions, "credit", "editor")) {
    return NextResponse.json({ error: "Non hai permesso di gestire il credito" }, { status: 403 });
  }

  const body = await req.json();
  const { player_id, action, amount, notes } = body;

  if (!player_id || !action || !amount || amount <= 0) {
    return NextResponse.json({ error: "player_id, action (load/unload), amount richiesti" }, { status: 400 });
  }

  // Check player belongs to this agent
  const { data: player } = await supabase
    .from("users")
    .select("id, agent_id, username")
    .eq("id", player_id)
    .single();

  if (!player || player.agent_id !== agent.id) {
    return NextResponse.json({ error: "Giocatore non trovato o non appartenente a questo agente" }, { status: 403 });
  }

  // Get player wallet
  const { data: playerWallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", player_id)
    .eq("owner_type", "player")
    .single();

  if (!playerWallet) return NextResponse.json({ error: "Wallet giocatore non trovato" }, { status: 404 });

  // For prepaid agents, check agent wallet
  if (agent.wallet_model === "prepaid" && action === "load") {
    const { data: agentWallet } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("agent_id", agent.id)
      .eq("owner_type", "agent")
      .single();

    if (!agentWallet || agentWallet.balance < amount) {
      return NextResponse.json({ error: `Credito agente insufficiente (${agentWallet?.balance ?? 0})` }, { status: 400 });
    }

    // Deduct from agent wallet
    await supabase
      .from("wallets")
      .update({ balance: agentWallet.balance - amount })
      .eq("id", agentWallet.id);
  }

  // For unload, check player balance
  if (action === "unload" && playerWallet.balance < amount) {
    return NextResponse.json({ error: `Saldo giocatore insufficiente (${playerWallet.balance})` }, { status: 400 });
  }

  // Update player wallet
  const newPlayerBalance = action === "load"
    ? playerWallet.balance + amount
    : playerWallet.balance - amount;

  await supabase
    .from("wallets")
    .update({ balance: newPlayerBalance, updated_at: new Date().toISOString() })
    .eq("id", playerWallet.id);

  // For prepaid + unload, credit back to agent wallet
  if (agent.wallet_model === "prepaid" && action === "unload") {
    const { data: agentWallet } = await supabase
      .from("wallets")
      .select("id, balance")
      .eq("agent_id", agent.id)
      .eq("owner_type", "agent")
      .single();

    if (agentWallet) {
      await supabase
        .from("wallets")
        .update({ balance: agentWallet.balance + amount })
        .eq("id", agentWallet.id);
    }
  }

  // Log transaction
  await supabase.from("agent_transactions").insert({
    agent_id: agent.id,
    type: action === "load" ? "credit_distribute" : "credit_collect",
    amount: action === "load" ? -amount : amount,
    target_user_id: player_id,
    notes: notes || `${action === "load" ? "Caricamento" : "Scaricamento"} credito ${player.username}`,
    performed_by: authUser.id,
  });

  return NextResponse.json({
    success: true,
    player_balance: newPlayerBalance,
  });
}
