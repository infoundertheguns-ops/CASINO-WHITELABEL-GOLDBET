import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════
// ADMIN API: Trading Queue
// GET — list bets awaiting manual acceptance
// PATCH — accept, reject, or partial-accept a bet
// ═══════════════════════════════════════════════════

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    const { data, count } = await supabase
      .from("bets")
      .select(`
        *,
        users(username, email, kyc_status, user_class),
        bet_selections(
          odds_at_placement,
          events(home_team, away_team, starts_at, is_live, sports(name)),
          outcomes(name, odds),
          markets(name, market_type)
        )
      `, { count: "exact" })
      .eq("status", "pending_acceptance")
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    return NextResponse.json({
      bets: data || [],
      total: count || 0,
      page,
      total_pages: Math.ceil((count || 0) / limit),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { bet_id, action, accepted_stake, note } = await req.json();
    // action: "accept" | "reject" | "partial_accept"

    const { data: bet } = await supabase
      .from("bets")
      .select("*, users(id, username)")
      .eq("id", bet_id)
      .eq("status", "pending_acceptance")
      .single();

    if (!bet) {
      return NextResponse.json({ error: "Bet non trovata o gia' processata" }, { status: 404 });
    }

    if (action === "reject") {
      await supabase.from("bets").update({
        status: "rejected",
        acceptance_mode: "manual",
        accepted_by: "admin_trader",
        acceptance_note: note || "Rifiutata dall'admin",
        reviewed_at: new Date().toISOString(),
      }).eq("id", bet_id);

      await supabase.from("risk_actions").insert({
        action_type: "reject_bet",
        entity_type: "bet",
        entity_id: bet_id,
        performed_by: "admin_trader",
        performed_by_system: false,
        notes: note,
        details: { original_stake: bet.stake, reason: note },
      });

      return NextResponse.json({ success: true, action: "rejected" });
    }

    // Accept or partial accept
    const finalStake = action === "partial_accept" && accepted_stake
      ? Math.min(accepted_stake, bet.requested_stake || bet.stake)
      : bet.stake;

    const finalPotentialWin = parseFloat((finalStake * bet.total_odds).toFixed(2));

    // Check wallet
    const { data: wallet } = await supabase
      .from("wallets").select("*").eq("user_id", bet.user_id).single();

    if (!wallet || wallet.balance < finalStake) {
      return NextResponse.json({ error: "Saldo utente insufficiente" }, { status: 400 });
    }

    // Update bet
    await supabase.from("bets").update({
      status: "open",
      stake: finalStake,
      accepted_stake: finalStake,
      potential_win: finalPotentialWin,
      acceptance_mode: action === "partial_accept" ? "partial" : "manual",
      accepted_by: "admin_trader",
      acceptance_note: note || (action === "partial_accept"
        ? `Parziale: $${finalStake} di $${bet.requested_stake || bet.stake}`
        : "Accettata manualmente"),
      reviewed_at: new Date().toISOString(),
    }).eq("id", bet_id);

    // Deduct wallet
    const newBalance = parseFloat((wallet.balance - finalStake).toFixed(2));
    await supabase.from("wallets").update({ balance: newBalance }).eq("user_id", bet.user_id);

    // Create transaction
    await supabase.from("transactions").insert({
      user_id: bet.user_id,
      wallet_id: wallet.id,
      type: "bet",
      amount: -finalStake,
      balance_before: wallet.balance,
      balance_after: newBalance,
      reference_type: "bet",
      reference_id: bet_id,
      description: `Scommessa accettata (${action === "partial_accept" ? "parziale" : "manuale"})`,
      status: "completed",
    });

    // Audit
    await supabase.from("risk_actions").insert({
      action_type: action === "partial_accept" ? "partial_accept" : "accept_bet",
      entity_type: "bet",
      entity_id: bet_id,
      performed_by: "admin_trader",
      performed_by_system: false,
      notes: note,
      details: {
        original_stake: bet.requested_stake || bet.stake,
        accepted_stake: finalStake,
        potential_win: finalPotentialWin,
      },
    });

    return NextResponse.json({
      success: true,
      action: action === "partial_accept" ? "partially_accepted" : "accepted",
      stake: finalStake,
      potential_win: finalPotentialWin,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
