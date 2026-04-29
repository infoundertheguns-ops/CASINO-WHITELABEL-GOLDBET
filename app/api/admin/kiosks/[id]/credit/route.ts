export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Load or Unload credit
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: kioskId } = await params;
  const admin = getSupabase();

  const body = await req.json();
  const { action, amount } = body;

  if (!action || !["load", "unload"].includes(action)) {
    return NextResponse.json({ error: "action deve essere 'load' o 'unload'" }, { status: 400 });
  }
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "amount deve essere positivo" }, { status: 400 });
  }

  // Get kiosk wallet
  const { data: kioskWallet } = await admin
    .from("kiosk_wallets")
    .select("id, balance")
    .eq("kiosk_id", kioskId)
    .limit(1)
    .maybeSingle();

  if (!kioskWallet) {
    return NextResponse.json({ error: "Wallet kiosk non trovato" }, { status: 404 });
  }

  if (action === "load") {
    // Credit kiosk wallet
    const newBalance = kioskWallet.balance + amount;
    const { error: creditErr } = await admin
      .from("kiosk_wallets")
      .update({ balance: newBalance })
      .eq("id", kioskWallet.id);

    if (creditErr) {
      return NextResponse.json({ error: "Errore accredito kiosk: " + creditErr.message }, { status: 500 });
    }

    // Log transaction
    await admin.from("kiosk_transactions").insert({
      kiosk_id: kioskId,
      type: "credit_load",
      amount,
      balance_after: newBalance,
      performed_by: null,
    });

    return NextResponse.json({ success: true, newBalance });
  }

  // UNLOAD
  if (kioskWallet.balance < amount) {
    return NextResponse.json({ error: "Saldo kiosk insufficiente" }, { status: 400 });
  }

  // Debit kiosk wallet
  const newBalance = kioskWallet.balance - amount;
  const { error: debitErr } = await admin
    .from("kiosk_wallets")
    .update({ balance: newBalance })
    .eq("id", kioskWallet.id);

  if (debitErr) {
    return NextResponse.json({ error: "Errore addebito kiosk: " + debitErr.message }, { status: 500 });
  }

  // Log transaction
  await admin.from("kiosk_transactions").insert({
    kiosk_id: kioskId,
    type: "credit_unload",
    amount,
    balance_after: newBalance,
    performed_by: null,
  });

  return NextResponse.json({ success: true, newBalance });
}
