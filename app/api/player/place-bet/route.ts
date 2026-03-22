import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  loadRiskConfig,
  getOrComputeProfile,
  evaluateAcceptance,
  runRiskAnalysis,
} from "@/lib/risk/engine";
import { sendTelegramMessage } from "@/lib/telegram";

// ═══════════════════════════════════════════════════
// PLACE BET API — Secure server-side bet placement
// Handles: auth, limits, odds validation, liability,
// acceptance (auto/manual/partial), risk analysis, wallet
// Supports: singola, multipla, sistema (system bets)
// ═══════════════════════════════════════════════════

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const combo of rest) result.push([arr[i], ...combo]);
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. Auth: verify user session (cookies OR Authorization header) ──
    let authUser: any = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const adminSb = getAdminSupabase();
      const { data: { user } } = await adminSb.auth.getUser(token);
      authUser = user;
    } else {
      const userSupabase = await createServerClient();
      const { data: { user } } = await userSupabase.auth.getUser();
      authUser = user;
    }
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
      selections, // [{ eventId, marketId, outcomeId, odds }] or ippica format
      fingerprint,
      systemType, // e.g. "2/3", "3/5" — optional, triggers sistema bet
    } = body;
    const isIppica = body.source === "ippica";

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
    const validatedSelections: {
      outcome_id: string;
      market_id: string;
      event_id: string;
      odds: number;
      outcome_name: string;
      time_to_kickoff: number | null;
    }[] = [];
    let totalOdds = 1;
    let hasLive = false;

    // ── IPPICA PATH — validate against ippica tables ──
    if (isIppica) {
      for (const sel of selections) {
        const { data: odds } = await supabase
          .from("ippica_odds")
          .select("id, odds, status, market_id, selection_name, ippica_markets!inner(race_id, market_type, is_active, ippica_races!inner(status, scheduled_at, title))")
          .eq("id", sel.oddsId)
          .single();

        if (!odds) {
          return NextResponse.json({ error: `Quota ippica non trovata: ${sel.oddsId}`, code: "OUTCOME_NOT_FOUND" }, { status: 400 });
        }

        const market = (odds as any).ippica_markets;
        const race = market?.ippica_races;

        if (odds.status !== "active") {
          return NextResponse.json({ error: `Quota sospesa: ${odds.selection_name}`, code: "OUTCOME_SUSPENDED" }, { status: 400 });
        }
        if (!market?.is_active) {
          return NextResponse.json({ error: `Mercato chiuso`, code: "MARKET_SUSPENDED" }, { status: 400 });
        }
        if (race?.status === "finished" || race?.status === "abandoned" || race?.status === "running") {
          return NextResponse.json({ error: `Corsa non accetta scommesse (${race.status})`, code: "EVENT_ENDED" }, { status: 400 });
        }

        const currentOdds = parseFloat(odds.odds);
        const clientOdds = parseFloat(sel.odds);
        if (Math.abs(currentOdds - clientOdds) > tolerance) {
          return NextResponse.json({ error: "Le quote sono cambiate", code: "ODDS_CHANGED" }, { status: 409 });
        }

        let timeToKickoff: number | null = null;
        if (race?.scheduled_at) {
          timeToKickoff = Math.round((new Date(race.scheduled_at).getTime() - Date.now()) / 60000);
        }

        totalOdds *= currentOdds;
        validatedSelections.push({
          outcome_id: odds.id,
          market_id: odds.market_id,
          event_id: market.race_id,
          odds: currentOdds,
          outcome_name: odds.selection_name,
          time_to_kickoff: timeToKickoff,
        });
      }
    } else {
    // ── SPORT PATH — existing validation ──

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

      if (event?.status === "finished" || event?.status === "ended" || event?.status === "cancelled" || event?.status === "postponed") {
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
    } // end else (sport path)

    totalOdds = parseFloat(totalOdds.toFixed(4));
    const potentialWin = parseFloat((stake * totalOdds).toFixed(2));

    // ── Validate systemType if provided ──
    const isSystem = !!systemType;
    let comboK = 0, comboN = 0, numCombos = 0;
    if (isSystem) {
      const parts = systemType.split("/");
      if (parts.length !== 2) {
        return NextResponse.json({ error: "Formato sistema non valido (es. 2/3)", code: "INVALID_SYSTEM" }, { status: 400 });
      }
      comboK = parseInt(parts[0], 10);
      comboN = parseInt(parts[1], 10);
      if (isNaN(comboK) || isNaN(comboN) || comboK < 2 || comboN < 3 || comboK >= comboN) {
        return NextResponse.json({ error: "Sistema non valido: K deve essere >= 2, N >= 3, K < N", code: "INVALID_SYSTEM" }, { status: 400 });
      }
      if (comboN !== selections.length) {
        return NextResponse.json({ error: `Sistema ${systemType} richiede ${comboN} selezioni, ricevute ${selections.length}`, code: "INVALID_SYSTEM" }, { status: 400 });
      }
      numCombos = combinations(validatedSelections, comboK).length;
    }

    const betType = isSystem ? "sistema" : selections.length === 1 ? "singola" : "multi";

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

    // ═══════════════════════════════════════════════════
    // SISTEMA PATH — parent bet + child combo bets
    // ═══════════════════════════════════════════════════
    if (isSystem) {
      const comboIndices = combinations(
        validatedSelections.map((_, i) => i),
        comboK
      );
      const stakePerCombo = Math.floor((finalStake * 100) / numCombos) / 100;
      const totalSystemStake = parseFloat((stakePerCombo * numCombos).toFixed(2));

      // Re-check wallet for actual system stake
      if (!wallet || wallet.balance < totalSystemStake) {
        return NextResponse.json({
          error: `Saldo insufficiente per sistema (necessario: $${totalSystemStake.toFixed(2)})`,
          code: "INSUFFICIENT_BALANCE",
        }, { status: 400 });
      }

      // Calculate potential win per combo and total
      let totalPotentialWin = 0;
      const comboDetails: { indices: number[]; comboOdds: number; potentialWin: number }[] = [];
      for (const indices of comboIndices) {
        const comboOdds = parseFloat(
          indices.reduce((acc: number, i: number) => acc * validatedSelections[i].odds, 1).toFixed(4)
        );
        const pw = parseFloat((stakePerCombo * comboOdds).toFixed(2));
        totalPotentialWin += pw;
        comboDetails.push({ indices, comboOdds, potentialWin: pw });
      }
      totalPotentialWin = parseFloat(totalPotentialWin.toFixed(2));

      // Insert parent bet
      const { data: parentBet, error: parentError } = await supabase
        .from("bets")
        .insert({
          user_id: authUser.id,
          bet_type: "sistema",
          total_odds: totalOdds,
          stake: totalSystemStake,
          requested_stake: stake,
          accepted_stake: totalSystemStake,
          potential_win: totalPotentialWin,
          status: betStatus,
          is_live: hasLive,
          selections_count: selections.length,
          combo_type: systemType,
          combo_count: numCombos,
          combos_won: 0,
          acceptance_mode: acceptance.decision === "partial_accept" ? "partial"
            : acceptance.decision === "manual_review" ? "manual" : "auto",
          acceptance_note: acceptance.reason,
          placed_ip: ip,
          placed_fingerprint: fingerprint || null,
          time_to_kickoff_minutes: minTimeToKickoff < 9999 ? minTimeToKickoff : null,
        })
        .select("id")
        .single();

      if (parentError || !parentBet) {
        return NextResponse.json({ error: "Errore inserimento sistema: " + (parentError?.message || ""), code: "INSERT_ERROR" }, { status: 500 });
      }

      // Insert child bets + their selections
      const comboIds: string[] = [];
      for (const combo of comboDetails) {
        const { data: childBet, error: childError } = await supabase
          .from("bets")
          .insert({
            user_id: authUser.id,
            bet_type: "sistema_combo",
            parent_bet_id: parentBet.id,
            total_odds: combo.comboOdds,
            stake: stakePerCombo,
            requested_stake: stakePerCombo,
            accepted_stake: stakePerCombo,
            potential_win: combo.potentialWin,
            status: betStatus,
            is_live: hasLive,
            selections_count: comboK,
            acceptance_mode: "auto",
            placed_ip: ip,
            placed_fingerprint: fingerprint || null,
            time_to_kickoff_minutes: minTimeToKickoff < 9999 ? minTimeToKickoff : null,
          })
          .select("id")
          .single();

        if (childError || !childBet) {
          // Rollback: delete parent + any already-created children
          await supabase.from("bet_selections").delete().in("bet_id", comboIds);
          await supabase.from("bets").delete().in("id", comboIds);
          await supabase.from("bets").delete().eq("id", parentBet.id);
          return NextResponse.json({ error: "Errore inserimento combo: " + (childError?.message || ""), code: "INSERT_ERROR" }, { status: 500 });
        }

        comboIds.push(childBet.id);

        // Insert selections for this combo
        const comboLegs = combo.indices.map((i: number) => ({
          bet_id: childBet.id,
          event_id: validatedSelections[i].event_id,
          market_id: validatedSelections[i].market_id,
          outcome_id: validatedSelections[i].outcome_id,
          odds_at_placement: validatedSelections[i].odds,
        }));

        const { error: legsErr } = await supabase.from("bet_selections").insert(comboLegs);
        if (legsErr) {
          await supabase.from("bet_selections").delete().in("bet_id", comboIds);
          await supabase.from("bets").delete().in("id", comboIds);
          await supabase.from("bets").delete().eq("id", parentBet.id);
          return NextResponse.json({ error: "Errore selezioni combo: " + legsErr.message, code: "LEGS_ERROR" }, { status: 500 });
        }
      }

      // Risk analysis on parent bet
      let riskResult: any = null;
      try {
        riskResult = await runRiskAnalysis(supabase, parentBet.id);
        if (riskResult.action_taken === "blocked") {
          await supabase.from("bets").update({ status: "rejected", acceptance_note: "Bloccato dal sistema di rischio" }).eq("id", parentBet.id);
          await supabase.from("bets").update({ status: "rejected" }).in("id", comboIds);
          return NextResponse.json({
            error: "Sistema bloccato dal sistema di sicurezza",
            code: "RISK_BLOCKED",
            risk_score: riskResult.final_score,
          }, { status: 403 });
        }
      } catch {
        // Risk engine failure — continue
      }

      if (betStatus === "pending_acceptance") {
        return NextResponse.json({
          success: true,
          bet_id: parentBet.id,
          status: "pending_acceptance",
          message: "Sistema in attesa di approvazione",
          combo_count: numCombos,
          stake_per_combo: stakePerCombo,
          combo_ids: comboIds,
          acceptance,
          risk_score: riskResult?.final_score || 0,
        });
      }

      // Deduct wallet
      const sysNewBalance = parseFloat((wallet.balance - totalSystemStake).toFixed(2));
      const { data: sysUpdatedWallet, error: sysWalletError } = await supabase
        .from("wallets")
        .update({ balance: sysNewBalance })
        .eq("user_id", authUser.id)
        .eq("balance", wallet.balance)
        .select("balance")
        .single();

      if (sysWalletError || !sysUpdatedWallet) {
        const { data: freshWallet } = await supabase.from("wallets").select("balance").eq("user_id", authUser.id).single();
        if (!freshWallet || freshWallet.balance < totalSystemStake) {
          await supabase.from("bets").update({ status: "rejected", acceptance_note: "Saldo modificato durante piazzamento" }).eq("id", parentBet.id);
          await supabase.from("bets").update({ status: "rejected" }).in("id", comboIds);
          return NextResponse.json({ error: "Saldo insufficiente (aggiornato)", code: "BALANCE_RACE" }, { status: 400 });
        }
        await supabase.from("wallets").update({ balance: parseFloat((freshWallet.balance - totalSystemStake).toFixed(2)) }).eq("user_id", authUser.id);
      }

      // Transaction
      await supabase.from("transactions").insert({
        user_id: authUser.id,
        wallet_id: wallet.id,
        type: "bet",
        amount: -totalSystemStake,
        balance_before: wallet.balance,
        balance_after: wallet.balance - totalSystemStake,
        reference_type: "bet",
        reference_id: parentBet.id,
        description: `Sistema ${systemType}: ${numCombos} combo da ${comboK} selezioni`,
        status: "completed",
      });

      // Risk action log
      await supabase.from("risk_actions").insert({
        action_type: acceptance.decision === "partial_accept" ? "partial_accept" : "accept_bet",
        entity_type: "bet",
        entity_id: parentBet.id,
        performed_by_system: true,
        details: { acceptance, risk_score: riskResult?.final_score || 0, system: systemType, combo_count: numCombos },
      });

      // Telegram alert (fire-and-forget)
      const sysSelNames = validatedSelections.map(s => s.outcome_name).join(", ");
      const sysHighStake = totalSystemStake >= 50 ? " \u26a0\ufe0f HIGH STAKE" : "";
      sendTelegramMessage(
        `\ud83c\udfb0 <b>NUOVA SCOMMESSA</b>${sysHighStake}\n\ud83d\udc64 @${user.username || user.id} \u2022 \u20ac${totalSystemStake} \u2022 sistema ${systemType}\n\ud83d\udccb ${sysSelNames}\n\ud83d\udcca Quota: ${totalOdds.toFixed(2)} \u2192 Vincita: \u20ac${totalPotentialWin.toFixed(2)}`
      ).catch(() => {});

      return NextResponse.json({
        success: true,
        bet_id: parentBet.id,
        status: betStatus,
        acceptance,
        stake: totalSystemStake,
        stake_per_combo: stakePerCombo,
        combo_count: numCombos,
        combo_ids: comboIds,
        potential_win: totalPotentialWin,
        risk_score: riskResult?.final_score || 0,
        flagged: riskResult?.action_taken === "flagged",
        partial: acceptance.decision === "partial_accept",
      });
    }

    // ═══════════════════════════════════════════════════
    // SINGOLA / MULTIPLA PATH (existing logic)
    // ═══════════════════════════════════════════════════

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
      event_id: isIppica ? null : s.event_id,
      market_id: isIppica ? null : s.market_id,
      outcome_id: isIppica ? null : s.outcome_id,
      odds_at_placement: s.odds,
      source: isIppica ? "ippica" : "sport",
      ippica_race_id: isIppica ? s.event_id : null,
      ippica_market_id: isIppica ? s.market_id : null,
      ippica_odds_id: isIppica ? s.outcome_id : null,
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

    // Telegram alert (fire-and-forget)
    const selNames = validatedSelections.map(s => s.outcome_name).join(", ");
    const highStake = finalStake >= 50 ? " \u26a0\ufe0f HIGH STAKE" : "";
    sendTelegramMessage(
      `\ud83c\udfb0 <b>NUOVA SCOMMESSA</b>${highStake}\n\ud83d\udc64 @${user.username || user.id} \u2022 \u20ac${finalStake} \u2022 ${betType}\n\ud83d\udccb ${selNames}\n\ud83d\udcca Quota: ${totalOdds.toFixed(2)} \u2192 Vincita: \u20ac${finalPotentialWin.toFixed(2)}`
    ).catch(() => {});

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
