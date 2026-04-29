export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// POST — Load/unload agent wallet (prepaid only)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();
  const body = await req.json();

  const { action, amount, notes } = body;

  if (!action || !amount || amount <= 0) {
    return NextResponse.json({ error: "action (load/unload) e amount richiesti" }, { status: 400 });
  }

  // Check agent exists and is prepaid
  const { data: agent } = await supabase
    .from("agents")
    .select("id, wallet_model, name")
    .eq("id", id)
    .single();

  if (!agent) return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });
  if (agent.wallet_model !== "prepaid") {
    return NextResponse.json({ error: "Operazione wallet disponibile solo per agenti prepaid" }, { status: 400 });
  }

  // Get wallet
  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("agent_id", id)
    .eq("owner_type", "agent")
    .single();

  if (!wallet) return NextResponse.json({ error: "Wallet agente non trovato" }, { status: 404 });

  const currentBalance = wallet.balance || 0;

  if (action === "unload" && currentBalance < amount) {
    return NextResponse.json({ error: `Saldo insufficiente (${currentBalance})` }, { status: 400 });
  }

  const newBalance = action === "load"
    ? currentBalance + amount
    : currentBalance - amount;

  // Update wallet
  await supabase
    .from("wallets")
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq("id", wallet.id);

  // Log transaction
  await supabase.from("agent_transactions").insert({
    agent_id: id,
    type: action === "load" ? "credit_load" : "credit_unload",
    amount: action === "load" ? amount : -amount,
    balance_after: newBalance,
    notes: notes || `${action === "load" ? "Caricamento" : "Scaricamento"} wallet agente`,
  });

  return NextResponse.json({ balance: newBalance });
}
