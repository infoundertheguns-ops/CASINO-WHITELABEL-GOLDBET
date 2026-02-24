import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  loadRiskConfig,
  getOrComputeProfile,
  evaluateAcceptance,
  runRiskAnalysis,
} from "@/lib/risk/engine";

// ═══════════════════════════════════════════════════
// PLACE BET API — Secure server-side bet placement
// Handles: auth, limits, odds validation, liability,
// acceptance (auto/manual/partial), risk analysis, wallet
// ═══════════════════════════════════════════════════

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. Auth: verify user session ──
    const userSupabase = await createServerClient();
    const { data: { user: authUser } } = await userSupabase.auth.getUser();
    if (!authUser) {
      return NextResponse.json({ error: "Non autenticato", code: "AUTH_REQUIRED" }, { status: 401 });
    }

    const supabase = getAdminSupabase();

    // Check user not blocked
    const { data: user } = await supabase
      .from("users").select("*").eq("id", authUser.id).single();
    if (!user) {
      return NextResponse.json({ error: "Utente non trovato", code: "USER_NOT_FOUND" }, { status: 404 });
    }
    if (user.is_blocked || user.is_banned) {
      return NextResponse.json({ error: "Account sospeso", code: "ACCOUNT_BLOCKED" }, { status: 403 });
    }

    // ── 2. Parse request ──
    const body = await req.json();
    const {
      stake,
      selections, // [{ eventId, marketId, outcomeId, odds }]
      fingerprint,
    } = body;

    if (!stake || !selections || selections.length === 0) {
      return NextResponse.json({ error: "Dati mancanti", code: "INVALID_REQUEST" }, { status: 400 });
    }
    if (stake < 1) return NextResponse.json({ error: "Puntata minima: $1", code: "MIN_STAKE" }, { status: 400 });
    if (stake > 10000) return NextResponse.json({ error: "Puntata massima: $10,000", code: "MAX_STAKE" }, { status: 400 });

    // ── 3. Check user_limits ──
    const { data: limits } = await supabase
      .from("user_limits")
      .select("limit_type, limit_value")
      .eq("user_id", authUser.id)
      .eq("is_active", true);

    if (limits) {
      const maxBet = limits.find(l => l.limit_type === "max_bet");
      if (maxBet && stake > maxBet.limit_value) {
        return NextResponse.json({
          error: `Limite puntata: $${maxBet.limit_value}`,
          code: "LIMIT_EXCEEDED",
          max_stake: maxBet.limit_value,
        }, { status: 400 });
      }

      const maxDaily = limits.find(l => l.limit_type === "max_daily_bet");
      if (maxDaily) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const { data: todayBets } = await supabase
          .from("bets").select("stake")
          .eq("user_id", authUser.id)
          .gte("created_at", today.toISOString())
          .not("status", "eq", "rejected");
        const todayTotal = (todayBets || []).reduce((s, b) => s + (b.stake || 0), 0);
        if (todayTotal + stake > maxDaily.limit_value) {
          return NextResponse.json({
            error: `Limite giornaliero: $${maxDaily.limit_value} (usato: $${todayTotal.toFixed(2)})`,
            code: "DAILY_LIMIT_EXCEEDED",
            remaining: Math.max(0, maxDaily.limit_value - todayTotal),
          }, { status: 400 });
        }
      }
    }

    // ── 4. Validate odds & markets ──
    const config = await loadRiskConfig(supabase);
    const tolerance = config.acceptance.odds_change_tolerance || 0.05;
    const validatedSelections = [];
    let totalOdds = 1;
    let hasLive = false;

    for (const sel of selections) {
      const { data: outcome } = await supabase
        .from("outcomes")
        .select("id, odds, is_active, is_suspended, market_id, name, markets(event_id, is_active, is_suspended, name, market_type)")
        .eq("id", sel.outcomeId)
        .single();

      if (!outcome) {
        return NextResponse.json({ error: `Esito non trovato: ${sel.outcomeId}`, code: "OUTCOME_NOT_FOUND" }, { status: 400 });
      }

      const market = (outcome as any).markets;
      if (!outcome.is_active || outcome.is_suspended) {
        return NextResponse.json({
          error: `Esito sospeso: ${outcome.name}`, code: "OUTCOME_SUSPENDED",
        }, { status: 400 });
      }
      if (!market?.is_active || market?.is_suspended) {
        return NextResponse.json({
          error: `Mercato sospeso: ${market?.name}`, code: "MARKET_SUSPENDED",
        }, { status: 400 });
      }

      const currentOdds = parseFloat(outcome.odds);
      const clientOdds = parseFloat(sel.odds);

      // Check if odds changed beyond tolerance
      if (Math.abs(currentOdds - clientOdds) > tolerance) {
        return NextResponse.json({
          error: "Le quote sono cambiate",
          code: "ODDS_CHANGED",
          updated_selections: selections.map((s: any) => ({
            ...s,
            current_odds: s.outcomeId === outcome.id ? currentOdds : s.odds,
          })),
        }, { status: 409 });
      }

      // Check if event is live
      const { data: event } = await supabase
        .from("events").select("is_live, starts_at, status").eq("id", market.event_id).single();

      if (event?.status === "ended" || event?.status === "cancelled") {
        return NextResponse.json({
          error: "Evento terminato o annullato", code: "EVENT_ENDED",
        }, { status: 400 });
      }
      if (event?.is_live) hasLive = true;

      // Calculate time to kickoff
      let timeToKickoff: number | null = null;
      if (event?.starts_at) {
        timeToKickoff = Math.round((new Date(event.starts_at).getTime() - Date.now()) / 60000);
      }

      totalOdds *= currentOdds;
      validatedSelections.push({
        outcome_id: outcome.id,
        market_id: outcome.market_id,
        event_id: market.event_id,
        odds: currentOdds,
        outcome_name: outcome.name,
        time_to_kickoff: timeToKickoff,
      });
    }

    totalOdds = parseFloat(totalOdds.toFixed(4));
    const potentialWin = parseFloat((stake * totalOdds).toFixed(2));
    const betType = selections.length === 1 ? "singola" : selections.length <= 3 ? "multi" : "sistema";

    // ── 5. Get player profile ──
    const profile = await getOrComputeProfile(supabase, authUser.id);

    // ── 6. Evaluate acceptance (liability + config) ──
    const acceptance = await evaluateAcceptance(
      supabase,
      {
        stake,
        total_odds: totalOdds,
        is_live: hasLive,
        selections: validatedSelections,
      },
      user,
      profile,
      config
    );

    const finalStake = acceptance.accepted_stake;
    const finalPotentialWin = parseFloat((finalStake * totalOdds).toFixed(2));

    // ── 7. Check wallet balance ──
    const { data: wallet } = await supabase
      .from("wallets").select("*").eq("user_id", authUser.id).single();

    if (!wallet || wallet.balance < finalStake) {
      return NextResponse.json({
        error: `Saldo insufficiente (disponibile: $${wallet?.balance?.toFixed(2) || "0.00"})`,
        code: "INSUFFICIENT_BALANCE",
      }, { status: 400 });
    }

    // ── 8. Determine bet status based on acceptance ──
    let betStatus: string;
    if (acceptance.decision === "reject") {
      return NextResponse.json({
        error: acceptance.reason,
        code: "BET_REJECTED",
        acceptance,
      }, { status: 400 });
    } else if (acceptance.decision === "manual_review") {
      betStatus = "pending_acceptance";
    } else {
      betStatus = "open"; // auto-accepted
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip") || "unknown";

    const minTimeToKickoff = validatedSelections
      .map(s => s.time_to_kickoff)
      .filter((t): t is number => t !== null)
      .reduce((min, t) => Math.min(min, t), 9999);

    // ── 9. Insert bet ──
    const { data: bet, error: betError } = await supabase
      .from("bets")
      .insert({
        user_id: authUser.id,
        bet_type: betType,
        total_odds: totalOdds,
        stake: finalStake,
        requested_stake: stake,
        accepted_stake: finalStake,
        potential_win: finalPotentialWin,
        status: betStatus,
        is_live: hasLive,
        selections_count: selections.length,
        acceptance_mode: acceptance.decision === "partial_accept" ? "partial"
          : acceptance.decision === "manual_review" ? "manual" : "auto",
        acceptance_note: acceptance.reason,
        placed_ip: ip,
        placed_fingerprint: fingerprint || null,
        time_to_kickoff_minutes: minTimeToKickoff < 9999 ? minTimeToKickoff : null,
      })
      .select("id")
      .single();

    if (betError || !bet) {
      return NextResponse.json({ error: "Errore inserimento bet: " + (betError?.message || ""), code: "INSERT_ERROR" }, { status: 500 });
    }

    // ── 10. Insert bet selections ──
    const legs = validatedSelections.map(s => ({
      bet_id: bet.id,
      event_id: s.event_id,
      market_id: s.market_id,
      outcome_id: s.outcome_id,
      odds_at_placement: s.odds,
    }));

    const { error: legsError } = await supabase.from("bet_selections").insert(legs);
    if (legsError) {
      await supabase.from("bets").delete().eq("id", bet.id);
      return NextResponse.json({ error: "Errore selezioni: " + legsError.message, code: "LEGS_ERROR" }, { status: 500 });
    }

    // ── 11. Risk analysis (inline, no HTTP) ──
    let riskResult: any = null;
    try {
      riskResult = await runRiskAnalysis(supabase, bet.id);

      if (riskResult.action_taken === "blocked") {
        // Cancel bet
        await supabase.from("bets").update({ status: "rejected", acceptance_note: "Bloccato dal sistema di rischio" }).eq("id", bet.id);
        return NextResponse.json({
          error: "Scommessa bloccata dal sistema di sicurezza",
          code: "RISK_BLOCKED",
          risk_score: riskResult.final_score,
        }, { status: 403 });
      }
    } catch {
      // Risk engine failure — continue (don't block the bet)
    }

    // ── 12. If pending_acceptance, don't deduct wallet yet ──
    if (betStatus === "pending_acceptance") {
      return NextResponse.json({
        success: true,
        bet_id: bet.id,
        status: "pending_acceptance",
        message: "Scommessa in attesa di approvazione",
        acceptance,
        risk_score: riskResult?.final_score || 0,
      });
    }

    // ── 13. Deduct wallet with optimistic concurrency ──
    const newBalance = parseFloat((wallet.balance - finalStake).toFixed(2));
    const { data: updatedWallet, error: walletError } = await supabase
      .from("wallets")
      .update({ balance: newBalance })
      .eq("user_id", authUser.id)
      .eq("balance", wallet.balance) // optimistic lock
      .select("balance")
      .single();

    if (walletError || !updatedWallet) {
      // Concurrent modification — refetch and retry once
      const { data: freshWallet } = await supabase.from("wallets").select("balance").eq("user_id", authUser.id).single();
      if (!freshWallet || freshWallet.balance < finalStake) {
        await supabase.from("bets").update({ status: "rejected", acceptance_note: "Saldo modificato durante piazzamento" }).eq("id", bet.id);
        return NextResponse.json({ error: "Saldo insufficiente (aggiornato)", code: "BALANCE_RACE" }, { status: 400 });
      }
      await supabase.from("wallets").update({ balance: parseFloat((freshWallet.balance - finalStake).toFixed(2)) }).eq("user_id", authUser.id);
    }

    // ── 14. Create transaction ──
    await supabase.from("transactions").insert({
      user_id: authUser.id,
      wallet_id: wallet.id,
      type: "bet",
      amount: -finalStake,
      balance_before: wallet.balance,
      balance_after: wallet.balance - finalStake,
      reference_type: "bet",
      reference_id: bet.id,
      description: `Scommessa ${betType}: ${selections.length} selezione/i`,
      status: "completed",
    });

    // ── 15. Log risk action ──
    await supabase.from("risk_actions").insert({
      action_type: acceptance.decision === "partial_accept" ? "partial_accept" : "accept_bet",
      entity_type: "bet",
      entity_id: bet.id,
      performed_by_system: true,
      details: { acceptance, risk_score: riskResult?.final_score || 0 },
    });

    return NextResponse.json({
      success: true,
      bet_id: bet.id,
      status: betStatus,
      acceptance,
      stake: finalStake,
      total_odds: totalOdds,
      potential_win: finalPotentialWin,
      risk_score: riskResult?.final_score || 0,
      flagged: riskResult?.action_taken === "flagged",
      partial: acceptance.decision === "partial_accept",
    });

  } catch (err: any) {
    console.error("[place-bet] Error:", err);
    return NextResponse.json({ error: err.message || "Errore imprevisto", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
