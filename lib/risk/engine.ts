// @ts-nocheck
// ═══════════════════════════════════════════════════
// RISK ENGINE — Liability, Acceptance, Player Risk, AI Optimizer
// Shared library used by place-bet, risk-agent, cron jobs
// ═══════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any;

// ═══ INTERFACES ═══

export interface RiskAnalysis {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  flags: string[];
  recommendation: string;
  details: string;
}

export interface EnhancedAIResult {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  flags: string[];
  player_classification: string;
  confidence: number;
  recommended_actions: string[];
  reasoning: string;
}

export interface LiabilityInfo {
  outcome_id: string;
  outcome_name: string;
  market_id: string;
  current_liability: number;
  max_liability: number;
  pct_used: number;
}

export interface AcceptanceResult {
  decision: "accept" | "partial_accept" | "manual_review" | "reject";
  accepted_stake: number;
  requested_stake: number;
  reason: string;
  liability_exceeded: boolean;
  max_acceptable_stake: number;
}

export interface OddsAdjustmentSuggestion {
  outcome_id: string;
  outcome_name: string;
  current_odds: number;
  suggested_odds: number;
  reason: string;
  liability_before: number;
  expected_liability_after: number;
}

export interface RiskConfig {
  thresholds: Record<string, number>;
  auto_actions: Record<string, boolean>;
  rules: Record<string, number>;
  ai_settings: Record<string, any>;
  acceptance: Record<string, any>;
  liability: Record<string, any>;
}

// ═══ CONFIG LOADER ═══

export async function loadRiskConfig(supabase: Supabase): Promise<RiskConfig> {
  const defaults: RiskConfig = {
    thresholds: { auto_block: 85, auto_flag: 50, auto_reduce_limits: 60, auto_kyc: 40, ai_threshold: 60 },
    auto_actions: { enabled: true, block_account: true, reduce_limits: true, require_kyc: true, notify_admin: true },
    rules: {
      stake_spike_multiplier: 5, high_stake: 1000, very_high_stake: 5000,
      new_account_days: 1, young_account_days: 7, high_odds: 20, extreme_odds: 50,
      velocity_1h: 10, extreme_velocity_1h: 25, win_rate_threshold: 0.7,
      win_rate_min_bets: 20, unverified_stake: 200, free_bet_high_odds: 10,
    },
    ai_settings: { enabled: true, model: "claude-sonnet-4-20250514", max_tokens: 1500, auto_analyze_above: 60 },
    acceptance: {
      mode: "auto", partial_accept_enabled: true, manual_review_stake_threshold: 5000,
      live_bet_delay_seconds: 5, max_liability_per_outcome: 50000, max_liability_per_event: 100000,
      max_liability_per_market: 75000, sharp_player_mode: "manual", odds_change_tolerance: 0.05,
      auto_accept_max_stake: 1000, always_manual_classes: ["sharp", "syndicate"],
    },
    liability: {
      global_max_liability: 500000, alert_threshold_pct: 80, auto_suspend_threshold_pct: 95,
      rebalance_trigger_pct: 70, ai_optimizer_enabled: true,
      ai_optimizer_model: "claude-sonnet-4-20250514", min_margin_pct: 2.5,
    },
  };

  try {
    const { data } = await supabase.from("risk_config").select("key, value");
    if (data) {
      for (const row of data) {
        if (row.key in defaults) {
          (defaults as any)[row.key] = { ...(defaults as any)[row.key], ...row.value };
        }
      }
    }
  } catch { /* use defaults */ }

  return defaults;
}

// ═══ PLAYER PROFILE ═══

export async function getOrComputeProfile(supabase: Supabase, userId: string) {
  const { data: profile } = await supabase
    .from("player_profiles").select("*").eq("user_id", userId).single();

  if (profile) return profile;

  const { data: bets } = await supabase
    .from("bets").select("stake, total_odds, status, created_at").eq("user_id", userId);

  const allBets = bets || [];
  const settled = allBets.filter(b => b.status === "won" || b.status === "lost");
  const wins = settled.filter(b => b.status === "won");
  const totalStake = allBets.reduce((s, b) => s + (b.stake || 0), 0);
  const totalWon = wins.reduce((s, b) => s + (b.stake || 0) * (b.total_odds || 1), 0);

  const newProfile = {
    user_id: userId,
    classification: "recreational",
    risk_score: 0,
    total_bets: allBets.length,
    total_stake: totalStake,
    total_won: totalWon,
    total_lost: totalStake - totalWon,
    win_rate: settled.length > 0 ? wins.length / settled.length : 0,
    avg_stake: allBets.length > 0 ? totalStake / allBets.length : 0,
    avg_odds: allBets.length > 0 ? allBets.reduce((s, b) => s + (b.total_odds || 0), 0) / allBets.length : 0,
    max_stake: allBets.length > 0 ? Math.max(...allBets.map(b => b.stake || 0)) : 0,
    lifetime_ggr: totalStake - totalWon,
    last_bet_at: allBets.length > 0 ? allBets[0].created_at : null,
    flags_count: 0,
  };

  const { data: inserted } = await supabase
    .from("player_profiles").upsert(newProfile, { onConflict: "user_id" }).select().single();

  return inserted || newProfile;
}

// ═══ RULE-BASED PLAYER RISK ANALYSIS (12 rules) ═══

export function ruleBasedAnalysis(
  bet: any, history: any[], user: any, profile: any, rules: Record<string, number>
): RiskAnalysis {
  const flags: string[] = [];
  let score = 0;
  const r = rules;

  // 1. Stake spike
  const avgStake = profile?.avg_stake || (history.length > 0
    ? history.reduce((s: number, b: any) => s + (b.stake || 0), 0) / history.length : 0);
  if (avgStake > 0 && bet.stake > avgStake * r.stake_spike_multiplier) {
    flags.push("STAKE_SPIKE"); score += 25;
  }

  // 2. Absolute high stake
  if (bet.stake > r.high_stake) { flags.push("HIGH_STAKE"); score += 15; }
  if (bet.stake > r.very_high_stake) { flags.push("VERY_HIGH_STAKE"); score += 20; }

  // 3. New/young account
  const accountAge = user?.created_at
    ? (Date.now() - new Date(user.created_at).getTime()) / 86400000 : 999;
  if (accountAge < r.new_account_days && bet.stake > 100) {
    flags.push("NEW_ACCOUNT_HIGH_STAKE"); score += 30;
  }
  if (accountAge < r.young_account_days && bet.stake > 500) {
    flags.push("YOUNG_ACCOUNT_HIGH_STAKE"); score += 20;
  }

  // 4. High odds
  if (bet.total_odds > r.high_odds) { flags.push("HIGH_ODDS"); score += 15; }
  if (bet.total_odds > r.extreme_odds) { flags.push("EXTREME_ODDS"); score += 25; }

  // 5. Velocity
  const recentBets = history.filter((b: any) =>
    Date.now() - new Date(b.created_at).getTime() < 3600000);
  if (recentBets.length > r.velocity_1h) { flags.push("HIGH_VELOCITY"); score += 20; }
  if (recentBets.length > r.extreme_velocity_1h) { flags.push("EXTREME_VELOCITY"); score += 30; }

  // 6. Free bet abuse
  if (bet.is_free_bet && bet.total_odds > r.free_bet_high_odds) {
    flags.push("FREE_BET_HIGH_ODDS"); score += 20;
  }

  // 7. Win rate anomaly
  const settled = history.filter((b: any) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b: any) => b.status === "won").length;
  const winRate = settled.length > r.win_rate_min_bets ? wins / settled.length : 0;
  if (winRate > r.win_rate_threshold && settled.length > r.win_rate_min_bets) {
    flags.push("HIGH_WIN_RATE"); score += 25;
  }

  // 8. KYC unverified high stake
  if (user?.kyc_status !== "verified" && bet.stake > r.unverified_stake) {
    flags.push("UNVERIFIED_HIGH_STAKE"); score += 15;
  }

  // 9. Arb pattern
  const eventIds = (bet.selections || bet.bet_selections || []).map((s: any) => s.event_id);
  const sameBets = history.filter((b: any) =>
    b.id !== bet.id && Date.now() - new Date(b.created_at).getTime() < 3600000 * 2);
  for (const sb of sameBets) {
    if ((sb.selections || sb.bet_selections || []).some((sel: any) => eventIds.includes(sel.event_id))) {
      flags.push("POSSIBLE_ARB"); score += 30; break;
    }
  }

  // 10. Syndicate detection
  if (user?.ip_address && recentBets.length > 5) {
    flags.push("VELOCITY_IP_CHECK"); score += 10;
  }

  // 11. Deposit-to-bet ratio
  if (profile && profile.total_deposits > 0) {
    const ratio = profile.total_stake / profile.total_deposits;
    if (ratio > 10) { flags.push("HIGH_TURNOVER_RATIO"); score += 15; }
  }

  // 12. Large potential win
  if (bet.potential_win > 10000) { flags.push("LARGE_POTENTIAL_WIN"); score += 10; }
  if (bet.potential_win > 50000) { flags.push("VERY_LARGE_POTENTIAL_WIN"); score += 20; }

  score = Math.min(100, score);
  const level = score <= 25 ? "low" : score <= 50 ? "medium" : score <= 75 ? "high" : "critical";

  return {
    score, level, flags,
    recommendation:
      level === "critical" ? "BLOCK: Bloccare scommessa e sospendere account" :
      level === "high" ? "REVIEW: Verifica manuale richiesta" :
      level === "medium" ? "FLAG: Accettare con monitoraggio" : "ACCEPT: Nella norma",
    details: `Account: ${accountAge.toFixed(0)}d | Avg: $${avgStake.toFixed(2)} | Bets/h: ${recentBets.length} | WR: ${(winRate * 100).toFixed(0)}% | ${profile?.classification || "new"}`,
  };
}

// ═══ LIABILITY CALCULATION ═══

export async function getOutcomeLiability(supabase: Supabase, outcomeId: string): Promise<number> {
  const { data } = await supabase.rpc("compute_outcome_liability", { p_outcome_id: outcomeId });
  return typeof data === "number" ? data : 0;
}

export async function getEventLiability(supabase: Supabase, eventId: string): Promise<LiabilityInfo[]> {
  const { data } = await supabase.rpc("compute_event_liability", { p_event_id: eventId });
  if (!data) return [];
  return (data as any[]).map(r => ({
    outcome_id: r.outcome_id,
    outcome_name: r.outcome_name,
    market_id: r.market_id,
    current_liability: parseFloat(r.liability) || 0,
    max_liability: parseFloat(r.max_liability) || 50000,
    pct_used: parseFloat(r.pct_used) || 0,
  }));
}

/** Calculate how much liability a new bet would add to each outcome it touches */
export async function calculateBetLiabilityImpact(
  supabase: Supabase,
  selections: { outcome_id: string; odds: number }[],
  stake: number
): Promise<{ outcome_id: string; added_liability: number; current_liability: number; max_liability: number; would_exceed: boolean }[]> {
  const results = [];
  for (const sel of selections) {
    const addedLiability = stake * (sel.odds - 1);
    const currentLiability = await getOutcomeLiability(supabase, sel.outcome_id);

    const { data: outcome } = await supabase
      .from("outcomes").select("max_liability").eq("id", sel.outcome_id).single();
    const maxLiab = outcome?.max_liability || 50000;

    results.push({
      outcome_id: sel.outcome_id,
      added_liability: addedLiability,
      current_liability: currentLiability,
      max_liability: maxLiab,
      would_exceed: (currentLiability + addedLiability) > maxLiab,
    });
  }
  return results;
}

// ═══ BET ACCEPTANCE ENGINE ═══

export async function evaluateAcceptance(
  supabase: Supabase,
  bet: {
    stake: number;
    total_odds: number;
    is_live: boolean;
    selections: { outcome_id: string; odds: number; event_id: string }[];
  },
  user: any,
  profile: any,
  config: RiskConfig
): Promise<AcceptanceResult> {
  const acc = config.acceptance;
  const requestedStake = bet.stake;

  // 1. Check if player class forces manual review
  const alwaysManual: string[] = acc.always_manual_classes || [];
  if (alwaysManual.includes(profile?.classification) || alwaysManual.includes(user?.user_class)) {
    if (acc.sharp_player_mode === "block") {
      return {
        decision: "reject", accepted_stake: 0, requested_stake: requestedStake,
        reason: "Classe giocatore bloccata", liability_exceeded: false, max_acceptable_stake: 0,
      };
    }
    if (acc.sharp_player_mode === "manual") {
      return {
        decision: "manual_review", accepted_stake: requestedStake, requested_stake: requestedStake,
        reason: `Giocatore ${profile?.classification || user?.user_class}: revisione manuale richiesta`,
        liability_exceeded: false, max_acceptable_stake: requestedStake,
      };
    }
  }

  // 2. Check stake threshold for manual review
  if (requestedStake > (acc.manual_review_stake_threshold || 5000)) {
    if (acc.mode === "manual" || acc.mode === "hybrid") {
      return {
        decision: "manual_review", accepted_stake: requestedStake, requested_stake: requestedStake,
        reason: `Stake $${requestedStake} supera soglia manuale ($${acc.manual_review_stake_threshold})`,
        liability_exceeded: false, max_acceptable_stake: requestedStake,
      };
    }
  }

  // 3. Check liability per outcome
  const liabilityImpacts = await calculateBetLiabilityImpact(
    supabase,
    bet.selections.map(s => ({ outcome_id: s.outcome_id, odds: s.odds })),
    requestedStake
  );

  const exceeding = liabilityImpacts.filter(l => l.would_exceed);

  if (exceeding.length > 0) {
    // Find max acceptable stake (the smallest stake that keeps all outcomes under limit)
    let maxStake = requestedStake;
    for (const ex of exceeding) {
      const remaining = ex.max_liability - ex.current_liability;
      const odds = bet.selections.find(s => s.outcome_id === ex.outcome_id)?.odds || 2;
      const maxForThis = remaining / (odds - 1);
      maxStake = Math.min(maxStake, Math.max(0, maxForThis));
    }
    maxStake = Math.floor(maxStake * 100) / 100; // floor to cents

    if (maxStake <= 0) {
      return {
        decision: "reject", accepted_stake: 0, requested_stake: requestedStake,
        reason: "Liability massima raggiunta su uno o piu' esiti",
        liability_exceeded: true, max_acceptable_stake: 0,
      };
    }

    if (acc.partial_accept_enabled && maxStake >= 1) {
      return {
        decision: "partial_accept", accepted_stake: maxStake, requested_stake: requestedStake,
        reason: `Stake ridotto da $${requestedStake} a $${maxStake} per limite liability`,
        liability_exceeded: true, max_acceptable_stake: maxStake,
      };
    }

    // Partial not enabled — go to manual or reject
    if (acc.mode !== "auto") {
      return {
        decision: "manual_review", accepted_stake: requestedStake, requested_stake: requestedStake,
        reason: "Liability ecceduta, richiesta revisione manuale",
        liability_exceeded: true, max_acceptable_stake: maxStake,
      };
    }

    return {
      decision: "reject", accepted_stake: 0, requested_stake: requestedStake,
      reason: "Liability massima raggiunta e accettazione parziale disabilitata",
      liability_exceeded: true, max_acceptable_stake: 0,
    };
  }

  // 4. Mode-based decision
  if (acc.mode === "manual") {
    return {
      decision: "manual_review", accepted_stake: requestedStake, requested_stake: requestedStake,
      reason: "Modalita' manuale: tutte le bet richiedono approvazione",
      liability_exceeded: false, max_acceptable_stake: requestedStake,
    };
  }

  // Auto accept
  return {
    decision: "accept", accepted_stake: requestedStake, requested_stake: requestedStake,
    reason: "Accettazione automatica", liability_exceeded: false, max_acceptable_stake: requestedStake,
  };
}

// ═══ CLAUDE AI ANALYSIS ═══

export async function analyzeWithClaude(
  bet: any, user: any, profile: any, history: any[],
  ruleFlags: string[], aiSettings: Record<string, any>
): Promise<EnhancedAIResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !aiSettings.enabled) return null;

  const last50 = (history || []).slice(0, 50).map((b: any) => ({
    stake: b.stake, odds: b.total_odds, status: b.status, time: b.created_at, type: b.bet_type,
  }));

  const prompt = `Analyze this betting activity for risk in an iGaming platform:

BET: stake=$${bet.stake}, odds=${bet.total_odds}, type=${bet.bet_type}, potential_win=$${bet.potential_win}

USER: kyc=${user?.kyc_status}, class=${user?.user_class}, account_age=${user?.created_at}, country=${user?.country}

PLAYER PROFILE: ${JSON.stringify({
  classification: profile?.classification, total_bets: profile?.total_bets,
  total_stake: profile?.total_stake, win_rate: profile?.win_rate,
  avg_stake: profile?.avg_stake, lifetime_ggr: profile?.lifetime_ggr,
  flags_count: profile?.flags_count,
})}

RECENT HISTORY (last 50): ${JSON.stringify(last50)}

RULE ENGINE FLAGS: ${ruleFlags.join(", ") || "none"}

Respond ONLY with valid JSON:
{
  "score": 0-100,
  "level": "low"|"medium"|"high"|"critical",
  "flags": ["detected issues"],
  "player_classification": "recreational"|"semi_pro"|"sharp"|"syndicate",
  "confidence": 0.0-1.0,
  "recommended_actions": ["actions"],
  "reasoning": "brief explanation"
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: aiSettings.model || "claude-sonnet-4-20250514",
        max_tokens: aiSettings.max_tokens || 1500,
        messages: [{ role: "user", content: prompt }],
        system: "You are an iGaming risk analysis AI for an Italian betting platform. Analyze for: arbitrage, stake manipulation, bonus abuse, syndicate activity, money laundering, sharp betting. Score: 0-25 low, 26-50 medium, 51-75 high, 76-100 critical.",
      }),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || "{}";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

// ═══ AI ODDS OPTIMIZER ═══

export async function aiOptimizeOdds(
  supabase: Supabase,
  eventId: string,
  config: RiskConfig
): Promise<OddsAdjustmentSuggestion[]> {
  const liabConfig = config.liability;
  if (!liabConfig.ai_optimizer_enabled) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  // Get event info
  const { data: event } = await supabase
    .from("events").select("*, sport:sports(name), league:leagues(name)").eq("id", eventId).single();
  if (!event) return [];

  // Get all markets + outcomes + liability
  const { data: markets } = await supabase
    .from("markets").select("*, outcomes(*)").eq("event_id", eventId).eq("is_active", true);
  if (!markets || markets.length === 0) return [];

  // Compute liability for each outcome
  const marketData = [];
  for (const m of markets) {
    const outcomes = [];
    for (const o of (m.outcomes || [])) {
      if (!o.is_active) continue;
      const liability = await getOutcomeLiability(supabase, o.id);
      outcomes.push({
        id: o.id, name: o.name, odds: parseFloat(o.odds),
        liability, max_liability: o.max_liability || 50000,
        pct_used: o.max_liability > 0 ? (liability / o.max_liability * 100) : 0,
      });
    }

    // Calculate total stake and margin for this market
    const totalStake = outcomes.reduce((s, o) => s + o.liability + (o.odds > 1 ? o.liability / (o.odds - 1) : 0), 0);
    const impliedProb = outcomes.reduce((s, o) => s + (o.odds > 0 ? 1 / o.odds : 0), 0);
    const margin = ((impliedProb - 1) * 100);

    marketData.push({
      market_id: m.id, market_name: m.name, market_type: m.market_type,
      outcomes, total_stake: totalStake, margin_pct: margin,
    });
  }

  const prompt = `You are an odds optimization AI for an Italian sportsbook. Analyze this event's liability and suggest odds adjustments to balance the book.

EVENT: ${event.home_team} vs ${event.away_team} | ${event.sport?.name} | ${event.league?.name}
STATUS: ${event.status} | ${event.is_live ? `LIVE ${event.minute}'` : `Kickoff: ${event.starts_at}`}

MARKETS AND LIABILITY:
${JSON.stringify(marketData, null, 2)}

RULES:
- Minimum margin: ${liabConfig.min_margin_pct}%
- Rebalance trigger: when one outcome has >${liabConfig.rebalance_trigger_pct}% of max liability
- Odds must stay > 1.01
- Small adjustments preferred (0.05-0.20 increments)
- Lower odds on overexposed outcomes, raise on underexposed
- Keep total margin reasonable (2-8%)

Respond ONLY with valid JSON array:
[{
  "outcome_id": "uuid",
  "outcome_name": "name",
  "current_odds": 1.50,
  "suggested_odds": 1.45,
  "reason": "brief explanation"
}]

Return empty array [] if no adjustments needed.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: liabConfig.ai_optimizer_model || "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        system: "You are a professional sportsbook trading AI. Your job is to suggest odds adjustments that balance the book's liability exposure while maintaining competitive margins. Be conservative — only suggest changes when there's clear imbalance.",
      }),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || "[]";
    const suggestions: any[] = JSON.parse(text.replace(/```json|```/g, "").trim());

    return suggestions.map(s => ({
      outcome_id: s.outcome_id,
      outcome_name: s.outcome_name || "",
      current_odds: s.current_odds,
      suggested_odds: s.suggested_odds,
      reason: s.reason || "",
      liability_before: marketData.flatMap(m => m.outcomes).find(o => o.id === s.outcome_id)?.liability || 0,
      expected_liability_after: 0,
    }));
  } catch {
    return [];
  }
}

/** Apply approved odds adjustments */
export async function applyOddsAdjustments(
  supabase: Supabase,
  adjustments: { outcome_id: string; new_odds: number; reason: string; auto_applied: boolean }[],
  approvedBy?: string
) {
  for (const adj of adjustments) {
    // Get current odds
    const { data: outcome } = await supabase
      .from("outcomes").select("odds, market_id").eq("id", adj.outcome_id).single();
    if (!outcome) continue;

    const oldOdds = parseFloat(outcome.odds);
    if (Math.abs(oldOdds - adj.new_odds) < 0.01) continue; // no meaningful change

    // Get event_id from market
    const { data: market } = await supabase
      .from("markets").select("event_id").eq("id", outcome.market_id).single();

    // Update odds
    await supabase.from("outcomes").update({
      previous_odds: oldOdds,
      odds: adj.new_odds,
    }).eq("id", adj.outcome_id);

    // Log adjustment
    await supabase.from("odds_adjustments").insert({
      outcome_id: adj.outcome_id,
      market_id: outcome.market_id,
      event_id: market?.event_id,
      old_odds: oldOdds,
      new_odds: adj.new_odds,
      reason: adj.reason,
      suggested_by: adj.auto_applied ? "ai" : "admin",
      approved_by: approvedBy || null,
      auto_applied: adj.auto_applied,
    });
  }
}

// ═══ AUTO-ACTIONS (player-level) ═══

export async function executeAutoActions(
  supabase: Supabase,
  score: number,
  user: any,
  betId: string,
  config: RiskConfig,
  aiResult: EnhancedAIResult | null
): Promise<string[]> {
  const { thresholds, auto_actions } = config;
  const actions: string[] = [];

  if (!auto_actions.enabled) return actions;

  // Auto-block
  if (score >= thresholds.auto_block && auto_actions.block_account) {
    await supabase
      .from("users")
      .update({ is_blocked: true, is_banned: true, ban_reason: `Auto-blocked: risk score ${score}` })
      .eq("id", user.id);
    actions.push("account_blocked");
  }

  // Auto-reduce limits
  if (score >= thresholds.auto_reduce_limits && score < thresholds.auto_block && auto_actions.reduce_limits) {
    await supabase.from("user_limits").insert({
      user_id: user.id, limit_type: "max_bet", limit_value: 50,
      reason: `Auto-reduced: risk score ${score}`, set_by: "system",
    });
    actions.push("limits_reduced");
  }

  // Auto-require KYC
  if (score >= thresholds.auto_kyc && user?.kyc_status === "unverified" && auto_actions.require_kyc) {
    actions.push("kyc_required");
  }

  // Create risk flag + notification
  if (score >= thresholds.auto_flag && auto_actions.notify_admin) {
    const severity = score > 75 ? "critical" : score > 50 ? "high" : "medium";
    await supabase.from("risk_flags").insert({
      user_id: user.id,
      flag_type: score >= thresholds.auto_block ? "auto_block" : score >= thresholds.auto_reduce_limits ? "limit_reduce" : "manual_review",
      severity,
      description: `Risk score ${score}. ${aiResult?.reasoning || "Rule-based detection."}`,
      ai_analysis: aiResult || {},
      related_entity_type: "bet",
      related_entity_id: betId,
      status: "open",
      sla_deadline: new Date(Date.now() + (severity === "critical" ? 4 : severity === "high" ? 24 : 72) * 3600000).toISOString(),
    });
    actions.push("alert_created");

    // Create admin notification for critical/high
    if (severity === "critical" || severity === "high") {
      await supabase.from("admin_notifications").insert({
        type: "risk_alert",
        severity: severity === "critical" ? "critical" : "warning",
        title: `Risk ${severity.toUpperCase()}: ${user?.username || "Utente"}`,
        message: `Score ${score} — ${aiResult?.reasoning || "Rilevato dal rule engine"}`,
        link: `/admin/risk?tab=alerts`,
        related_entity_type: "bet",
        related_entity_id: betId,
      });
    }
  }

  return actions;
}

// ═══ BATCH RULES (for cron scanner) ═══

export async function batchPatternDetection(
  supabase: Supabase,
  userId: string,
  config: RiskConfig
): Promise<{ flags: string[]; score: number }> {
  const flags: string[] = [];
  let score = 0;

  // Rule 13: Multi-account (same IP/fingerprint on different users)
  const { data: userFps } = await supabase
    .from("login_fingerprints").select("ip_address, fingerprint").eq("user_id", userId).limit(20);

  if (userFps && userFps.length > 0) {
    const ips = [...new Set(userFps.map(f => f.ip_address).filter(Boolean))];
    for (const ip of ips) {
      const { data: others } = await supabase
        .from("login_fingerprints").select("user_id")
        .eq("ip_address", ip).neq("user_id", userId).limit(5);
      if (others && others.length > 0) {
        const uniqueUsers = new Set(others.map(o => o.user_id));
        if (uniqueUsers.size >= 2) {
          flags.push("MULTI_ACCOUNT_IP"); score += 35; break;
        }
      }
    }
  }

  // Rule 14: Bot detection (regular betting intervals, std dev < 5s)
  const { data: recentBets } = await supabase
    .from("bets").select("created_at").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(20);

  if (recentBets && recentBets.length >= 10) {
    const intervals = [];
    for (let i = 1; i < recentBets.length; i++) {
      intervals.push(
        (new Date(recentBets[i - 1].created_at).getTime() - new Date(recentBets[i].created_at).getTime()) / 1000
      );
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length);
    if (stdDev < 5 && mean < 60) {
      flags.push("BOT_PATTERN"); score += 30;
    }
  }

  // Rule 15: League specialist (>80% bets on one non-top league)
  const { data: leagueBets } = await supabase
    .from("bet_selections")
    .select("events(league_id, leagues(name, slug))")
    .eq("bets.user_id", userId)
    .limit(100);
  // Simplified: check from bets directly
  const { data: userBetsWithLeague } = await supabase
    .from("bets").select("bet_selections(events(leagues(name, slug)))").eq("user_id", userId).limit(100);

  if (userBetsWithLeague && userBetsWithLeague.length >= 20) {
    const leagueCounts: Record<string, number> = {};
    for (const b of userBetsWithLeague) {
      const league = (b as any).bet_selections?.[0]?.events?.leagues?.slug || "unknown";
      leagueCounts[league] = (leagueCounts[league] || 0) + 1;
    }
    const total = Object.values(leagueCounts).reduce((a, b) => a + b, 0);
    const topLeagues = ["serie-a", "premier-league", "la-liga", "bundesliga", "ligue-1", "champions-league"];
    for (const [league, count] of Object.entries(leagueCounts)) {
      if (count / total > 0.8 && !topLeagues.includes(league)) {
        flags.push("LEAGUE_SPECIALIST"); score += 20; break;
      }
    }
  }

  // Rule 16: Late odds exploitation (bets within 2min of kickoff at high odds)
  const { data: lateBets } = await supabase
    .from("bets").select("time_to_kickoff_minutes, total_odds")
    .eq("user_id", userId).not("time_to_kickoff_minutes", "is", null).limit(50);

  if (lateBets) {
    const lateHighOdds = lateBets.filter(b =>
      (b.time_to_kickoff_minutes || 999) <= 2 && (b.total_odds || 0) > 3.0);
    if (lateHighOdds.length >= 3) {
      flags.push("LATE_ODDS_EXPLOITATION"); score += 25;
    }
  }

  return { flags, score: Math.min(100, score) };
}

// ═══ FULL RISK ANALYSIS (used by place-bet and risk-agent) ═══

export async function runRiskAnalysis(
  supabase: Supabase,
  betId: string,
  options: { use_ai?: boolean } = {}
) {
  const config = await loadRiskConfig(supabase);

  // Get bet
  const { data: bet } = await supabase
    .from("bets").select("*, bet_selections(*)").eq("id", betId).single();
  if (!bet) throw new Error("Bet not found");

  // Get user
  const { data: user } = await supabase
    .from("users").select("*").eq("id", bet.user_id).single();

  // Get profile
  const profile = await getOrComputeProfile(supabase, bet.user_id);

  // Get history
  const { data: history } = await supabase
    .from("bets").select("*, bet_selections(event_id)")
    .eq("user_id", bet.user_id).order("created_at", { ascending: false }).limit(100);

  // Rule-based
  const ruleAnalysis = ruleBasedAnalysis(bet, history || [], user, profile, config.rules);

  // AI analysis
  let aiAnalysis: EnhancedAIResult | null = null;
  const shouldUseAI = options.use_ai ||
    (config.ai_settings.enabled && ruleAnalysis.score >= config.ai_settings.auto_analyze_above);
  if (shouldUseAI) {
    aiAnalysis = await analyzeWithClaude(bet, user, profile, history || [], ruleAnalysis.flags, config.ai_settings);
  }

  // Final score
  const finalScore = aiAnalysis ? Math.max(ruleAnalysis.score, aiAnalysis.score) : ruleAnalysis.score;
  const finalLevel = finalScore <= 25 ? "low" : finalScore <= 50 ? "medium" : finalScore <= 75 ? "high" : "critical";

  // Auto-actions
  const actionsExecuted = await executeAutoActions(supabase, finalScore, user, betId, config, aiAnalysis);

  // Update bet risk score
  const allFlags = [...new Set([...ruleAnalysis.flags, ...(aiAnalysis?.flags || [])])];
  await supabase.from("bets").update({ risk_score: finalScore, risk_flags: allFlags }).eq("id", betId);

  // Update profile
  if (profile?.user_id) {
    await supabase.from("player_profiles").update({
      risk_score: finalScore,
      classification: aiAnalysis?.player_classification || profile.classification,
      flags_count: (profile.flags_count || 0) + (finalScore >= config.thresholds.auto_flag ? 1 : 0),
      updated_at: new Date().toISOString(),
    }).eq("user_id", bet.user_id);
  }

  return {
    bet_id: betId,
    rule_analysis: ruleAnalysis,
    ai_analysis: aiAnalysis,
    final_score: finalScore,
    final_level: finalLevel,
    actions_executed: actionsExecuted,
    action_taken: finalScore >= config.thresholds.auto_block ? "blocked"
      : finalScore >= config.thresholds.auto_flag ? "flagged" : "accepted",
  };
}
