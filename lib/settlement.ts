import { SupabaseClient } from "@supabase/supabase-js";

// ═══ TYPES ═══

interface SettlementResult {
  home: number;
  away: number;
  total: number;
  ht_home?: number;
  ht_away?: number;
}

type Verdict = "won" | "lost" | "void" | "push";

type SettlerFn = (
  result: SettlementResult,
  outcomeName: string,
  line?: number
) => Verdict;

export interface SettleOutcome {
  success?: boolean;
  already_settled?: boolean;
  skipped_no_scores?: boolean;
  error?: string;
  legs_processed?: number;
  bets_settled?: number;
  total_payout?: number;
}

// ═══ buildResult ═══

function buildResult(
  event: Record<string, unknown>,
  manualResult?: { home: number; away: number }
): SettlementResult | null {
  const home =
    manualResult?.home ?? (event.score_home as number | null);
  const away =
    manualResult?.away ?? (event.score_away as number | null);

  if (home == null || away == null) return null;

  const sr: SettlementResult = { home, away, total: home + away };

  // Half-time scores from live_data JSONB
  const ld = (event.live_data as Record<string, unknown>) || {};
  const htHome = ld.halfScoreHome as number[] | undefined;
  const htAway = ld.halfScoreAway as number[] | undefined;
  if (htHome?.length) sr.ht_home = htHome[0];
  if (htAway?.length) sr.ht_away = htAway[0];

  return sr;
}

// ═══ resolveSettlerKey — maps Italian Goldbet market names → settler key ═══

function resolveSettlerKey(
  marketType: string
): { key: string; line?: number } | null {
  const mt = marketType.trim();

  // 1X2
  if (mt === "1X2") return { key: "1X2" };

  // Under/Over (any line) — "Under/Over 2.5", "Under/Over 1.5", etc.
  if (/^Under\/Over\b/i.test(mt)) {
    const lineMatch = mt.match(/([\d.]+)\s*$/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : undefined;
    return { key: "O/U", line };
  }

  // GG/NG, Gol/NoGol
  if (/^(GG\/NG|Gol\/NoGol)$/i.test(mt)) return { key: "GG/NG" };

  // Doppia Chance
  if (/^Doppia Chance$/i.test(mt)) return { key: "DC" };

  // Draw No Bet
  if (/^Draw No Bet$/i.test(mt)) return { key: "DNB" };

  // Risultato Esatto
  if (/^Risultato Esatto/i.test(mt)) return { key: "EXACT_SCORE" };

  // Handicap 1X2 (with line) — "Handicap 1X2 -1", "Handicap 1X2 (-1.5)", etc.
  if (/^Handicap/i.test(mt)) {
    const lineMatch = mt.match(/(-?[\d.]+)\s*\)?$/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : undefined;
    return { key: "HANDICAP", line };
  }

  // Somma Gol — "0-1", "2-3", "4-5", "6+"
  if (/^Somma Gol/i.test(mt)) return { key: "TOTAL_GOALS_BAND" };

  // 1X2 + Under/Over combo — "1X2 + Under/Over 2.5"
  if (/^1X2\s*\+\s*Under\/Over/i.test(mt)) {
    const lineMatch = mt.match(/([\d.]+)\s*$/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : undefined;
    return { key: "COMBO_1X2_OU", line };
  }

  // GG/NG + Under/Over combo
  if (/^(GG\/NG|Gol\/NoGol)\s*\+\s*Under\/Over/i.test(mt)) {
    const lineMatch = mt.match(/([\d.]+)\s*$/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : undefined;
    return { key: "COMBO_GG_OU", line };
  }

  // HT/FT — Primo Tempo / Finale, 1T/2T, etc.
  if (/Primo Tempo.*Finale|1T.*2T|HT.*FT/i.test(mt)) return { key: "HT_FT" };

  // Unknown market → void
  return null;
}

// ═══ SETTLERS ═══

const SETTLERS: Record<string, SettlerFn> = {
  "1X2": (r, sel) => {
    if (r.home > r.away && sel === "1") return "won";
    if (r.home === r.away && sel === "X") return "won";
    if (r.home < r.away && sel === "2") return "won";
    return "lost";
  },

  "O/U": (r, sel, line) => {
    if (line == null) return "void";
    const total = r.total;
    if (total === line) return "push";
    const isOver = /over/i.test(sel);
    const isUnder = /under/i.test(sel);
    if (isOver && total > line) return "won";
    if (isUnder && total < line) return "won";
    return "lost";
  },

  "GG/NG": (r, sel) => {
    const gg = r.home > 0 && r.away > 0;
    const selUp = sel.toUpperCase();
    // Outcome names: "GG", "NG", "Gol", "NoGol"
    if ((selUp === "GG" || selUp === "GOL") && gg) return "won";
    if ((selUp === "NG" || selUp === "NOGOL") && !gg) return "won";
    return "lost";
  },

  DC: (r, sel) => {
    if (sel === "1X" && r.home >= r.away) return "won";
    if (sel === "X2" && r.home <= r.away) return "won";
    if (sel === "12" && r.home !== r.away) return "won";
    return "lost";
  },

  DNB: (r, sel) => {
    if (r.home === r.away) return "void";
    if (sel === "1" && r.home > r.away) return "won";
    if (sel === "2" && r.home < r.away) return "won";
    return "lost";
  },

  EXACT_SCORE: (r, sel) => {
    // Outcome like "2-1", "0-0"
    if (sel === `${r.home}-${r.away}`) return "won";
    return "lost";
  },

  HANDICAP: (r, sel, line) => {
    if (line == null) return "void";
    const adjHome = r.home + line;
    if (adjHome === r.away) return "push";
    if (sel === "1" && adjHome > r.away) return "won";
    if (sel === "X" && adjHome === r.away) return "won";
    if (sel === "2" && adjHome < r.away) return "won";
    return "lost";
  },

  TOTAL_GOALS_BAND: (r, sel) => {
    // Outcomes: "0-1", "2-3", "4-5", "6+"
    const total = r.total;
    const selTrimmed = sel.trim();
    if (selTrimmed === "6+" && total >= 6) return "won";
    const rangeMatch = selTrimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (total >= lo && total <= hi) return "won";
    }
    return "lost";
  },

  COMBO_1X2_OU: (r, sel, line) => {
    // Outcome format: "1 - Over", "X - Under", "2 - Over", etc.
    // Also possible: "1-Over", "1 Over"
    const parts = sel.split(/\s*[-+&]\s*|\s+/);
    if (parts.length < 2) return "void";
    const ftSel = parts[0].trim();
    const ouSel = parts[parts.length - 1].trim();
    const ftResult = SETTLERS["1X2"](r, ftSel);
    const ouResult = SETTLERS["O/U"](r, ouSel, line);
    if (ftResult === "void" || ouResult === "void") return "void";
    if (ftResult === "push" || ouResult === "push") return "push";
    if (ftResult === "won" && ouResult === "won") return "won";
    return "lost";
  },

  COMBO_GG_OU: (r, sel, line) => {
    // Outcome format: "GG - Over", "NG - Under", etc.
    const parts = sel.split(/\s*[-+&]\s*|\s+/);
    if (parts.length < 2) return "void";
    const ggSel = parts[0].trim();
    const ouSel = parts[parts.length - 1].trim();
    const ggResult = SETTLERS["GG/NG"](r, ggSel);
    const ouResult = SETTLERS["O/U"](r, ouSel, line);
    if (ggResult === "void" || ouResult === "void") return "void";
    if (ggResult === "push" || ouResult === "push") return "push";
    if (ggResult === "won" && ouResult === "won") return "won";
    return "lost";
  },

  HT_FT: (r, sel) => {
    if (r.ht_home == null || r.ht_away == null) return "void";
    const htRes =
      r.ht_home > r.ht_away ? "1" : r.ht_home === r.ht_away ? "X" : "2";
    const ftRes =
      r.home > r.away ? "1" : r.home === r.away ? "X" : "2";
    // Outcome like "1/1", "X/2", "1/X"
    const expected = `${htRes}/${ftRes}`;
    if (sel === expected) return "won";
    // Also try with dash or space separator
    if (sel === `${htRes}-${ftRes}` || sel === `${htRes} ${ftRes}`)
      return "won";
    return "lost";
  },
};

// ═══ settleEvent — main orchestrator ═══

export async function settleEvent(
  supabase: SupabaseClient,
  eventId: string,
  manualResult?: { home: number; away: number }
): Promise<SettleOutcome> {
  // 1. Fetch event
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, score_home, score_away, status, live_data, settled_at")
    .eq("id", eventId)
    .single();

  if (evErr || !event) {
    return { error: evErr?.message || "Event not found" };
  }

  // 2. Already settled?
  if (event.settled_at) {
    return { already_settled: true };
  }

  // 3. Cancelled/postponed → void all legs, refund
  if (event.status === "cancelled" || event.status === "postponed") {
    return voidAllLegs(supabase, eventId, event.status);
  }

  // 4. Build result from DB data (or manual override)
  const result = buildResult(event, manualResult);
  if (!result) {
    return { skipped_no_scores: true, error: "No scores available" };
  }

  // 5. Optimistic lock — claim this event for settlement
  const { data: locked, error: lockErr } = await supabase
    .from("events")
    .update({ settled_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("settled_at", null)
    .select("id");

  if (lockErr || !locked?.length) {
    return { already_settled: true };
  }

  // 6. Fetch unsettled legs with JOINs
  const { data: legs, error: legsErr } = await supabase
    .from("bet_selections")
    .select(
      `id, bet_id, event_id, market_id, outcome_id, odds_at_placement,
       markets!inner(market_type, line),
       outcomes!inner(name),
       bets!inner(id, user_id, stake, potential_win, total_odds, status)`
    )
    .eq("event_id", eventId)
    .is("result", null);

  if (legsErr) {
    return { error: `Failed to fetch legs: ${legsErr.message}` };
  }

  if (!legs || legs.length === 0) {
    return { success: true, legs_processed: 0, bets_settled: 0, total_payout: 0 };
  }

  // 7. Settle each leg
  let legsProcessed = 0;
  const affectedBetIds = new Set<string>();

  for (const leg of legs) {
    const market = leg.markets as unknown as {
      market_type: string;
      line: number | null;
    };
    const outcome = leg.outcomes as unknown as { name: string };

    const resolved = resolveSettlerKey(market.market_type);
    let verdict: Verdict;

    if (!resolved) {
      // Unknown market → void
      verdict = "void";
    } else {
      const settler = SETTLERS[resolved.key];
      const line = resolved.line ?? market.line ?? undefined;
      verdict = settler(result, outcome.name, line);
    }

    // push = void for settlement purposes
    if (verdict === "push") verdict = "void";

    await supabase
      .from("bet_selections")
      .update({ result: verdict, settled_at: new Date().toISOString() })
      .eq("id", leg.id);

    affectedBetIds.add(leg.bet_id);
    legsProcessed++;
  }

  // 8. Resolve affected bets
  let betsSettled = 0;
  let totalPayout = 0;

  for (const betId of Array.from(affectedBetIds)) {
    const payout = await resolveBet(supabase, betId);
    if (payout !== null) {
      betsSettled++;
      totalPayout += payout;
    }
  }

  // 9. Settlement log
  await supabase.from("settlement_log").insert({
    event_id: eventId,
    action: "auto_settle",
    result: { ...result },
    bets_affected: betsSettled,
    total_payout: totalPayout,
    settled_by: "auto",
  });

  // 10. Mark event as ended and deactivate markets/outcomes
  await deactivateEvent(supabase, eventId);

  return {
    success: true,
    legs_processed: legsProcessed,
    bets_settled: betsSettled,
    total_payout: totalPayout,
  };
}

// ═══ resolveBet — check if all legs settled, determine bet outcome ═══

async function resolveBet(
  supabase: SupabaseClient,
  betId: string
): Promise<number | null> {
  // Fetch all legs for this bet
  const { data: allLegs } = await supabase
    .from("bet_selections")
    .select("result, odds_at_placement")
    .eq("bet_id", betId);

  if (!allLegs) return null;

  // If any leg still unsettled → skip (wait for other events)
  if (allLegs.some((l) => l.result == null)) return null;

  // Fetch the bet itself
  const { data: bet } = await supabase
    .from("bets")
    .select("id, user_id, stake, potential_win, status, parent_bet_id")
    .eq("id", betId)
    .single();

  if (!bet || bet.status !== "open") return null;

  // Determine outcome
  const hasLost = allLegs.some((l) => l.result === "lost");
  const allVoid = allLegs.every((l) => l.result === "void");
  const wonLegs = allLegs.filter((l) => l.result === "won");

  let betStatus: string;
  let payout = 0;

  if (allVoid) {
    betStatus = "void";
  } else if (hasLost) {
    betStatus = "lost";
  } else {
    betStatus = "won";
    // Payout = stake × product of odds for non-void legs
    const oddsProduct = wonLegs.reduce(
      (acc, l) => acc * parseFloat(String(l.odds_at_placement)),
      1
    );
    payout = parseFloat((bet.stake * oddsProduct).toFixed(2));
  }

  // Update bet
  await supabase
    .from("bets")
    .update({
      status: betStatus,
      actual_win: payout,
      settled_at: new Date().toISOString(),
    })
    .eq("id", betId);

  // Credit wallet
  if (betStatus === "won" && payout > 0) {
    await creditWallet(supabase, bet.user_id, betId, payout, "win");
  } else if (betStatus === "void") {
    await creditWallet(supabase, bet.user_id, betId, bet.stake, "refund");
  }

  // If this is a child of a sistema bet, check if parent can be resolved
  if (bet.parent_bet_id) {
    await resolveParentBet(supabase, bet.parent_bet_id);
  }

  return payout;
}

// ═══ resolveParentBet — aggregate child combo results into parent ═══

async function resolveParentBet(
  supabase: SupabaseClient,
  parentBetId: string
): Promise<void> {
  // Fetch all child bets
  const { data: children } = await supabase
    .from("bets")
    .select("id, status, actual_win, stake")
    .eq("parent_bet_id", parentBetId);

  if (!children || children.length === 0) return;

  // If any child still open/unsettled → skip
  if (children.some((c) => !c.status || c.status === "open" || c.status === "pending_acceptance")) return;

  // Fetch parent
  const { data: parent } = await supabase
    .from("bets")
    .select("id, status, user_id")
    .eq("id", parentBetId)
    .single();

  if (!parent || (parent.status !== "open" && parent.status !== "pending_acceptance")) return;

  // Calculate aggregates
  const combosWon = children.filter((c) => c.status === "won").length;
  const combosVoid = children.filter((c) => c.status === "void").length;
  const totalPayout = children.reduce((sum, c) => sum + (c.actual_win || 0), 0);
  const allVoid = combosVoid === children.length;
  const allLost = children.every((c) => c.status === "lost" || c.status === "void") && !allVoid;

  let parentStatus: string;
  if (allVoid) {
    parentStatus = "void";
  } else if (combosWon > 0) {
    parentStatus = "won";
  } else {
    parentStatus = "lost";
  }

  // Update parent — wallet already credited by each child individually
  await supabase
    .from("bets")
    .update({
      status: parentStatus,
      actual_win: parseFloat(totalPayout.toFixed(2)),
      combos_won: combosWon,
      settled_at: new Date().toISOString(),
    })
    .eq("id", parentBetId);
}

// ═══ creditWallet ═══

async function creditWallet(
  supabase: SupabaseClient,
  userId: string,
  betId: string,
  amount: number,
  type: "win" | "refund"
) {
  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, balance")
    .eq("user_id", userId)
    .single();

  if (!wallet) return;

  const balanceBefore = parseFloat(String(wallet.balance));
  const balanceAfter = parseFloat((balanceBefore + amount).toFixed(2));

  await supabase
    .from("wallets")
    .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
    .eq("id", wallet.id);

  await supabase.from("transactions").insert({
    user_id: userId,
    wallet_id: wallet.id,
    type,
    amount,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    reference_type: "bet",
    reference_id: betId,
    description:
      type === "win"
        ? `Vincita scommessa #${betId.slice(0, 8)}`
        : `Rimborso scommessa annullata #${betId.slice(0, 8)}`,
    status: "completed",
  });
}

// ═══ voidAllLegs — for cancelled/postponed events ═══

async function voidAllLegs(
  supabase: SupabaseClient,
  eventId: string,
  reason: string
): Promise<SettleOutcome> {
  // Lock event
  const { data: locked } = await supabase
    .from("events")
    .update({ settled_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("settled_at", null)
    .select("id");

  if (!locked?.length) return { already_settled: true };

  // Fetch unsettled legs
  const { data: legs } = await supabase
    .from("bet_selections")
    .select("id, bet_id")
    .eq("event_id", eventId)
    .is("result", null);

  if (!legs || legs.length === 0) {
    return { success: true, legs_processed: 0, bets_settled: 0, total_payout: 0 };
  }

  // Void all legs
  const betIds = new Set<string>();
  for (const leg of legs) {
    await supabase
      .from("bet_selections")
      .update({ result: "void", settled_at: new Date().toISOString() })
      .eq("id", leg.id);
    betIds.add(leg.bet_id);
  }

  // Resolve bets
  let betsSettled = 0;
  for (const betId of Array.from(betIds)) {
    const payout = await resolveBet(supabase, betId);
    if (payout !== null) betsSettled++;
  }

  // Log
  await supabase.from("settlement_log").insert({
    event_id: eventId,
    action: `void_${reason}`,
    result: { reason },
    bets_affected: betsSettled,
    total_payout: 0,
    settled_by: "auto",
  });

  // Deactivate markets/outcomes
  await deactivateEvent(supabase, eventId);

  return {
    success: true,
    legs_processed: legs.length,
    bets_settled: betsSettled,
    total_payout: 0,
  };
}

// ═══ deactivateEvent — set ended + deactivate markets/outcomes ═══

export async function deactivateEvent(
  supabase: SupabaseClient,
  eventId: string
) {
  const now = new Date().toISOString();

  // Set event to ended
  await supabase
    .from("events")
    .update({ status: "ended", updated_at: now })
    .eq("id", eventId);

  // Get market IDs for this event
  const { data: markets } = await supabase
    .from("markets")
    .select("id")
    .eq("event_id", eventId)
    .eq("is_active", true);

  if (markets && markets.length > 0) {
    const marketIds = markets.map((m) => m.id);

    // Deactivate markets
    await supabase
      .from("markets")
      .update({ is_active: false, updated_at: now })
      .in("id", marketIds);

    // Deactivate outcomes (batch in chunks of 200 to avoid query limits)
    for (let i = 0; i < marketIds.length; i += 200) {
      const chunk = marketIds.slice(i, i + 200);
      await supabase
        .from("outcomes")
        .update({ is_active: false, updated_at: now })
        .in("market_id", chunk);
    }
  }
}
