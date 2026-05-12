import { SupabaseClient } from "@supabase/supabase-js";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  extractStat,
  type FlashscoreStat,
} from "@/lib/settlement/stats-extractor";
import {
  classifyLeg as planDClassifyLeg,
  type ScoreResult as PlanDScoreResult,
  type Verdict as PlanDVerdict,
} from "@/lib/settlement/odds-api/classify";
import { aggregatePayout, type LegResult } from "@/lib/settlement/half-stake-payout";

// ═══ TYPES ═══

interface SettlementResult {
  // Full-time scores (all sports)
  home: number;
  away: number;
  total: number;
  // Half-time / first period (football: 1st half; basketball: Q1+Q2)
  ht_home?: number;
  ht_away?: number;
  ht_total?: number;
  // Second half / second period calculated
  sh_home?: number;
  sh_away?: number;
  sh_total?: number;
  // Raw per-period array from live_data (tennis: per-set games, basket: per-quarter pts)
  halfScores?: { home: number[]; away: number[] };
  // Sport name (lowercase)
  sport?: string;
  // Period string from event
  period?: string;
  // Match statistics (from Flashscore)
  corners_home?: number;
  corners_away?: number;
  corners_total?: number;
  ht_corners_home?: number;
  ht_corners_away?: number;
  ht_corners_total?: number;
  cards_home?: number;
  cards_away?: number;
  cards_total?: number;
  shots_on_target_home?: number;
  shots_on_target_away?: number;
  // Second-half corners
  sh_corners_home?: number;
  sh_corners_away?: number;
  sh_corners_total?: number;
  // Half-time yellow+red totals (Phase 2 consumers)
  ht_cards_home?: number;
  ht_cards_away?: number;
  ht_cards_total?: number;
  sh_cards_home?: number;
  sh_cards_away?: number;
  sh_cards_total?: number;
  // Total shots (tiri totali) FT/HT/SH
  shots_total_home?: number;
  shots_total_away?: number;
  ht_shots_total_home?: number;
  ht_shots_total_away?: number;
  sh_shots_total_home?: number;
  sh_shots_total_away?: number;
  // Shots on target HT/SH (shots_on_target_home/away FT already exist above)
  ht_shots_on_target_home?: number;
  ht_shots_on_target_away?: number;
  sh_shots_on_target_home?: number;
  sh_shots_on_target_away?: number;
}

type Verdict = "won" | "lost" | "void" | "push" | "half_won" | "half_lost";

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
  manualResult?: { home: number; away: number },
  sport?: string
): SettlementResult | null {
  const home =
    manualResult?.home ?? (event.score_home as number | null);
  const away =
    manualResult?.away ?? (event.score_away as number | null);

  if (home == null || away == null) return null;

  const sr: SettlementResult = {
    home,
    away,
    total: home + away,
    sport: sport || "",
    period: (event.period as string) || "",
  };

  // Per-period scores from live_data JSONB
  const ld = (event.live_data as Record<string, unknown>) || {};
  const htHome = ld.halfScoreHome as number[] | undefined;
  const htAway = ld.halfScoreAway as number[] | undefined;

  if (htHome?.length && htAway?.length) {
    sr.halfScores = { home: [...htHome], away: [...htAway] };

    // Football half-time: element[0] = 1st half score
    const sportLower = (sport || "").toLowerCase();
    const isFootball =
      sportLower === "calcio" ||
      sportLower === "football" ||
      sportLower === "soccer" ||
      sportLower === "";

    if (isFootball && htHome.length >= 1 && htAway.length >= 1) {
      const htH = htHome[0];
      const htA = htAway[0];
      // Safety: if ht > ft, data is corrupted (cumulative, not real HT)
      if (htH <= home && htA <= away) {
        sr.ht_home = htH;
        sr.ht_away = htA;
        sr.ht_total = htH + htA;
        sr.sh_home = home - htH;
        sr.sh_away = away - htA;
        sr.sh_total = sr.sh_home + sr.sh_away;
      }
    }
  }

  // Match statistics from Flashscore (persisted in live_data.stats, Italian names)
  const statsArr = ld.stats as FlashscoreStat[] | undefined;
  if (statsArr?.length) {
    const cornersFt = extractStat(statsArr, "ft", "corners");
    if (cornersFt) {
      sr.corners_home = cornersFt.home;
      sr.corners_away = cornersFt.away;
      sr.corners_total = cornersFt.total;
    }
    const cornersHt = extractStat(statsArr, "ht", "corners");
    if (cornersHt) {
      sr.ht_corners_home = cornersHt.home;
      sr.ht_corners_away = cornersHt.away;
      sr.ht_corners_total = cornersHt.total;
    }
    const yellowFt = extractStat(statsArr, "ft", "cards_yellow");
    const redFt = extractStat(statsArr, "ft", "cards_red");
    if (yellowFt) {
      sr.cards_home = yellowFt.home + (redFt?.home ?? 0);
      sr.cards_away = yellowFt.away + (redFt?.away ?? 0);
      sr.cards_total = sr.cards_home + sr.cards_away;
    }
    const shotsOn = extractStat(statsArr, "ft", "shots_on_target");
    if (shotsOn) {
      sr.shots_on_target_home = shotsOn.home;
      sr.shots_on_target_away = shotsOn.away;
    }
    const cornersSh = extractStat(statsArr, "sh", "corners");
    if (cornersSh) {
      sr.sh_corners_home = cornersSh.home;
      sr.sh_corners_away = cornersSh.away;
      sr.sh_corners_total = cornersSh.total;
    }
    const yellowHt = extractStat(statsArr, "ht", "cards_yellow");
    const redHt = extractStat(statsArr, "ht", "cards_red");
    if (yellowHt) {
      sr.ht_cards_home = yellowHt.home + (redHt?.home ?? 0);
      sr.ht_cards_away = yellowHt.away + (redHt?.away ?? 0);
      sr.ht_cards_total = sr.ht_cards_home + sr.ht_cards_away;
    }
    const yellowSh = extractStat(statsArr, "sh", "cards_yellow");
    const redSh = extractStat(statsArr, "sh", "cards_red");
    if (yellowSh) {
      sr.sh_cards_home = yellowSh.home + (redSh?.home ?? 0);
      sr.sh_cards_away = yellowSh.away + (redSh?.away ?? 0);
      sr.sh_cards_total = sr.sh_cards_home + sr.sh_cards_away;
    }
    const shotsFt = extractStat(statsArr, "ft", "shots_total");
    if (shotsFt) {
      sr.shots_total_home = shotsFt.home;
      sr.shots_total_away = shotsFt.away;
    }
    const shotsHt = extractStat(statsArr, "ht", "shots_total");
    if (shotsHt) {
      sr.ht_shots_total_home = shotsHt.home;
      sr.ht_shots_total_away = shotsHt.away;
    }
    const shotsSh = extractStat(statsArr, "sh", "shots_total");
    if (shotsSh) {
      sr.sh_shots_total_home = shotsSh.home;
      sr.sh_shots_total_away = shotsSh.away;
    }
    const shotsOnHt = extractStat(statsArr, "ht", "shots_on_target");
    if (shotsOnHt) {
      sr.ht_shots_on_target_home = shotsOnHt.home;
      sr.ht_shots_on_target_away = shotsOnHt.away;
    }
    const shotsOnSh = extractStat(statsArr, "sh", "shots_on_target");
    if (shotsOnSh) {
      sr.sh_shots_on_target_home = shotsOnSh.home;
      sr.sh_shots_on_target_away = shotsOnSh.away;
    }
  }

  return sr;
}

// ═══ settleEvent — main orchestrator ═══

/**
 * Convert legacy SettlementResult to Plan D ScoreResult shape.
 * Plan D engine expects a flatter structure with optional stats fields.
 * Note: legacy uses shots_total_home/away and shots_on_target_home/away;
 * Plan D names them shots_home/away. We map shots_total_* -> shots_*.
 * Fields not on legacy (gk_saves, scorers, assists, player_shots) are
 * omitted - Plan D classifiers return null verdict (stats_missing)
 * and the existing legsSkipped logic handles those legs correctly.
 */
function toPlanDScoreResult(r: SettlementResult): PlanDScoreResult {
  return {
    home: r.home,
    away: r.away,
    ht_home: r.ht_home ?? null,
    ht_away: r.ht_away ?? null,
    corners_home: r.corners_home ?? null,
    corners_away: r.corners_away ?? null,
    ht_corners_home: r.ht_corners_home ?? null,
    ht_corners_away: r.ht_corners_away ?? null,
    cards_home: r.cards_home ?? null,
    cards_away: r.cards_away ?? null,
    shots_home: r.shots_total_home ?? null,
    shots_away: r.shots_total_away ?? null,
    shots_on_target_home: r.shots_on_target_home ?? null,
    shots_on_target_away: r.shots_on_target_away ?? null,
  };
}

/**
 * Map Plan D verdict to legacy Verdict.
 * Plan D Verdict (5 values) is now a subset of legacy Verdict (6 values incl. push).
 * Pass through unchanged — bet_selections.result column TEXT accepts all variants
 * (see migration 001_initial_schema.sql:290,329 comment).
 */
function planDVerdictToLegacy(v: PlanDVerdict | null): Verdict | null {
  return v;
}

export async function settleEvent(
  supabase: SupabaseClient,
  eventId: string,
  manualResult?: { home: number; away: number }
): Promise<SettleOutcome> {
  // 1. Fetch event with sport slug.
  // Plan D S6 cutover: read from events_v2 (English sport_slug, no JOIN).
  // The `sport` string passed to buildResult/classifiers below tolerates both
  // English ("football") and Italian ("calcio") forms — see buildResult.
  const { data: event, error: evErr } = await supabase
    .from("events_v2")
    .select("id, score_home, score_away, status, live_data, last_settled_at, period, sport_slug")
    .eq("id", eventId)
    .single();

  if (evErr || !event) {
    return { error: evErr?.message || "Event not found" };
  }

  // 2. Already settled?
  if ((event as { last_settled_at?: string | null }).last_settled_at) {
    return { already_settled: true };
  }

  // 3. Cancelled/postponed → void all legs, refund
  if (event.status === "cancelled" || event.status === "postponed") {
    return voidAllLegs(supabase, eventId, event.status);
  }

  // 4. Build result from DB data (or manual override)
  const sport = ((event as { sport_slug?: string }).sport_slug || "").toLowerCase();
  const result = buildResult(event, manualResult, sport);
  if (!result) {
    return { skipped_no_scores: true, error: "No scores available" };
  }

  // 5. Optimistic lock — claim this event for settlement
  const { data: locked, error: lockErr } = await supabase
    .from("events_v2")
    .update({ last_settled_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("last_settled_at", null)
    .select("id");

  if (lockErr || !locked?.length) {
    return { already_settled: true };
  }

  // 6. Fetch unsettled legs with JOINs
  const { data: legs, error: legsErr } = await supabase
    .from("bet_selections")
    .select(
      `id, bet_id, event_id, market_id, outcome_id, odds_at_placement,
       markets_v2!inner(market_name),
       outcomes_v2!inner(outcome_key, line),
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
  let legsSkipped = 0;
  const affectedBetIds = new Set<string>();

  for (const leg of legs) {
    const market = leg.markets_v2 as unknown as { market_name: string };
    const outcome = leg.outcomes_v2 as unknown as {
      outcome_key: string;
      line: number | null;
    };

    // Plan D path — classifier-based verdict.
    // Side effects (wallet credits, agent commissions, Telegram alerts,
    // event deactivation) remain untouched below.
    const planDResult = toPlanDScoreResult(result);
    const planDLeg = {
      market_type: market.market_name,
      outcome_name: outcome.outcome_key,
      line: outcome.line,
    };
    const { verdict: planDVerdict } = planDClassifyLeg(planDLeg, planDResult);
    let verdict: Verdict | null = planDVerdictToLegacy(planDVerdict);

    // null = stats not available yet — skip this leg for later settlement
    if (verdict === null) {
      legsSkipped++;
      continue;
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

  // 8. If legs were skipped (stats not yet available), release the lock
  // so a future settlement attempt (after stats arrive) can process them
  if (legsSkipped > 0) {
    await supabase
      .from("events_v2")
      .update({ last_settled_at: null })
      .eq("id", eventId);
  }

  // 9. Resolve affected bets
  let betsSettled = 0;
  let totalPayout = 0;

  for (const betId of Array.from(affectedBetIds)) {
    const payout = await resolveBet(supabase, betId);
    if (payout !== null) {
      betsSettled++;
      totalPayout += payout;
    }
  }

  // 10. Settlement log + deactivate only when ALL legs are done
  if (legsSkipped === 0) {
    await deactivateEvent(supabase, eventId);
  }

  return {
    success: true,
    legs_processed: legsProcessed,
    bets_settled: betsSettled,
    total_payout: totalPayout,
  };
}

// ═══ resolveBet — check if all legs settled, determine bet outcome ═══

export async function resolveBet(
  supabase: SupabaseClient,
  betId: string
): Promise<number | null> {
  // Fetch all legs for this bet
  const { data: allLegs } = await supabase
    .from("bet_selections")
    .select("result, odds_at_placement")
    .eq("bet_id", betId);

  if (!allLegs) return null;

  // Fetch the bet itself (need stake/user before we can aggregate)
  const { data: bet } = await supabase
    .from("bets")
    .select("id, user_id, stake, potential_win, status, parent_bet_id")
    .eq("id", betId)
    .single();

  if (!bet || bet.status !== "open") return null;

  // Pure aggregation: returns null if waiting on more legs.
  const aggregated = aggregatePayout(
    allLegs.map((l) => ({ result: l.result as LegResult | null, odds_at_placement: l.odds_at_placement })),
    Number(bet.stake)
  );
  if (aggregated === null) return null;

  const { status: betStatus, payout } = aggregated;

  // Persist bet outcome
  await supabase
    .from("bets")
    .update({
      status: betStatus,
      actual_win: payout,
      settled_at: new Date().toISOString(),
    })
    .eq("id", betId);

  // Wallet credit: always credit the numeric payout (zero is a no-op).
  // The bet status enum just labels the net outcome — the wallet sees money.
  if (payout > 0) {
    const ledgerType = betStatus === "won" ? "win" : "refund";
    await creditWallet(supabase, bet.user_id, betId, payout, ledgerType);
  }

  // Telegram alert only for net wins (status === "won")
  if (betStatus === "won") {
    const { data: winner } = await supabase.from("users").select("username").eq("id", bet.user_id).single();
    sendTelegramMessage(
      `🏆 <b>SCOMMESSA VINTA</b>\n👤 @${winner?.username || bet.user_id}\n💰 +€${payout.toFixed(2)} (stake: €${bet.stake})`
    ).catch(() => {});
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
    .from("events_v2")
    .update({ last_settled_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("last_settled_at", null)
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

  // Post-bigbang: events_v2 status enum uses 'settled' (not 'ended').
  // markets_v2/outcomes_v2 require no per-event deactivation cascade —
  // outcomes_v2.is_active is managed by the live scraper.
  await supabase
    .from("events_v2")
    .update({ status: "settled", updated_at: now })
    .eq("id", eventId);
}

// Test-only exports — do not use in production code paths
export const __test__buildResult = buildResult;
