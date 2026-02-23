import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════
// AI RISK AGENT v2 — Enhanced with configurable rules,
// pattern detection, Claude AI analysis, auto-actions
// ═══════════════════════════════════════════════════

interface RiskAnalysis {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  flags: string[];
  recommendation: string;
  details: string;
}

interface EnhancedAIResult {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  flags: string[];
  player_classification: string;
  confidence: number;
  recommended_actions: string[];
  reasoning: string;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ═══ Load configurable thresholds from risk_config ═══
async function loadRiskConfig(supabase: ReturnType<typeof getSupabase>) {
  const defaults = {
    thresholds: { auto_block: 85, auto_flag: 50, auto_reduce_limits: 60, auto_kyc: 40, ai_threshold: 60 },
    auto_actions: { enabled: true, block_account: true, reduce_limits: true, require_kyc: true, notify_admin: true },
    rules: {
      stake_spike_multiplier: 5, high_stake: 1000, very_high_stake: 5000,
      new_account_days: 1, young_account_days: 7, high_odds: 20, extreme_odds: 50,
      velocity_1h: 10, extreme_velocity_1h: 25, win_rate_threshold: 0.7,
      win_rate_min_bets: 20, unverified_stake: 200, free_bet_high_odds: 10,
    },
    ai_settings: { enabled: true, model: "claude-sonnet-4-20250514", max_tokens: 1500, auto_analyze_above: 60 },
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

// ═══ Get or compute player profile ═══
async function getOrComputeProfile(supabase: ReturnType<typeof getSupabase>, userId: string) {
  const { data: profile } = await supabase
    .from("player_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (profile) return profile;

  // Compute from history
  const { data: bets } = await supabase
    .from("bets")
    .select("stake, total_odds, status, created_at")
    .eq("user_id", userId);

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
    .from("player_profiles")
    .upsert(newProfile, { onConflict: "user_id" })
    .select()
    .single();

  return inserted || newProfile;
}

// ═══ Rule-based analysis with configurable thresholds ═══
function ruleBasedAnalysis(
  bet: any,
  history: any[],
  user: any,
  profile: any,
  rules: any
): RiskAnalysis {
  const flags: string[] = [];
  let score = 0;

  const r = rules;

  // 1. Stake spike vs historical average
  const avgStake = profile?.avg_stake || (history.length > 0
    ? history.reduce((s: number, b: any) => s + (b.stake || 0), 0) / history.length
    : 0);
  if (avgStake > 0 && bet.stake > avgStake * r.stake_spike_multiplier) {
    flags.push("STAKE_SPIKE");
    score += 25;
  }

  // 2. Absolute high stake
  if (bet.stake > r.high_stake) { flags.push("HIGH_STAKE"); score += 15; }
  if (bet.stake > r.very_high_stake) { flags.push("VERY_HIGH_STAKE"); score += 20; }

  // 3. New/young account high betting
  const accountAge = user?.created_at
    ? (Date.now() - new Date(user.created_at).getTime()) / 86400000
    : 999;
  if (accountAge < r.new_account_days && bet.stake > 100) {
    flags.push("NEW_ACCOUNT_HIGH_STAKE");
    score += 30;
  }
  if (accountAge < r.young_account_days && bet.stake > 500) {
    flags.push("YOUNG_ACCOUNT_HIGH_STAKE");
    score += 20;
  }

  // 4. High odds (potential arb)
  if (bet.total_odds > r.high_odds) { flags.push("HIGH_ODDS"); score += 15; }
  if (bet.total_odds > r.extreme_odds) { flags.push("EXTREME_ODDS"); score += 25; }

  // 5. Rapid betting velocity
  const recentBets = history.filter((b: any) =>
    Date.now() - new Date(b.created_at).getTime() < 3600000
  );
  if (recentBets.length > r.velocity_1h) { flags.push("HIGH_VELOCITY"); score += 20; }
  if (recentBets.length > r.extreme_velocity_1h) { flags.push("EXTREME_VELOCITY"); score += 30; }

  // 6. Free bet abuse
  if (bet.is_free_bet && bet.total_odds > r.free_bet_high_odds) {
    flags.push("FREE_BET_HIGH_ODDS");
    score += 20;
  }

  // 7. Win rate anomaly
  const settled = history.filter((b: any) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b: any) => b.status === "won").length;
  const winRate = settled.length > r.win_rate_min_bets ? wins / settled.length : 0;
  if (winRate > r.win_rate_threshold && settled.length > r.win_rate_min_bets) {
    flags.push("HIGH_WIN_RATE");
    score += 25;
  }

  // 8. KYC unverified high stake
  if (user?.kyc_status !== "verified" && bet.stake > r.unverified_stake) {
    flags.push("UNVERIFIED_HIGH_STAKE");
    score += 15;
  }

  // 9. Arb pattern: opposite bets on same event
  const eventIds = (bet.selections || []).map((s: any) => s.event_id);
  const sameBets = history.filter((b: any) =>
    b.id !== bet.id &&
    Date.now() - new Date(b.created_at).getTime() < 3600000 * 2
  );
  for (const sb of sameBets) {
    if ((sb.selections || []).some((sel: any) => eventIds.includes(sel.event_id))) {
      flags.push("POSSIBLE_ARB");
      score += 30;
      break;
    }
  }

  // 10. Syndicate detection: same IP rapid bets
  if (user?.ip_address && recentBets.length > 5) {
    flags.push("VELOCITY_IP_CHECK");
    score += 10;
  }

  // 11. Deposit-to-bet ratio anomaly
  if (profile && profile.total_deposits > 0) {
    const ratio = profile.total_stake / profile.total_deposits;
    if (ratio > 10) { flags.push("HIGH_TURNOVER_RATIO"); score += 15; }
  }

  // 12. Large potential win
  if (bet.potential_win > 10000) { flags.push("LARGE_POTENTIAL_WIN"); score += 10; }
  if (bet.potential_win > 50000) { flags.push("VERY_LARGE_POTENTIAL_WIN"); score += 20; }

  score = Math.min(100, score);
  const level = score <= 25 ? "low" : score <= 50 ? "medium" : score <= 75 ? "high" : "critical";

  const recommendation =
    level === "critical" ? "BLOCK: Bloccare scommessa e sospendere account per review" :
    level === "high" ? "REVIEW: Richiedere verifica manuale prima di accettare" :
    level === "medium" ? "FLAG: Accettare con monitoraggio rafforzato" :
    "ACCEPT: Scommessa nella norma";

  return {
    score,
    level,
    flags,
    recommendation,
    details: `Account: ${accountAge.toFixed(0)}d | Avg stake: $${avgStake.toFixed(2)} | Bets/h: ${recentBets.length} | Win rate: ${(winRate * 100).toFixed(0)}% | Profile: ${profile?.classification || "new"}`,
  };
}

// ═══ Claude AI analysis ═══
async function analyzeWithClaude(
  bet: any,
  user: any,
  profile: any,
  history: any[],
  ruleFlags: string[],
  aiSettings: any
): Promise<EnhancedAIResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !aiSettings.enabled) return null;

  const last50 = history.slice(0, 50).map((b: any) => ({
    stake: b.stake,
    odds: b.total_odds,
    status: b.status,
    time: b.created_at,
    type: b.bet_type,
  }));

  const prompt = `Analyze this betting activity for risk in an iGaming platform:

BET: stake=$${bet.stake}, odds=${bet.total_odds}, type=${bet.bet_type}, potential_win=$${bet.potential_win}

USER: kyc=${user?.kyc_status}, class=${user?.user_class}, account_age=${user?.created_at}, country=${user?.country}, ip=${user?.ip_address}

PLAYER PROFILE: ${JSON.stringify({
  classification: profile?.classification,
  total_bets: profile?.total_bets,
  total_stake: profile?.total_stake,
  win_rate: profile?.win_rate,
  avg_stake: profile?.avg_stake,
  lifetime_ggr: profile?.lifetime_ggr,
  flags_count: profile?.flags_count,
})}

RECENT HISTORY (last 50): ${JSON.stringify(last50)}

RULE ENGINE FLAGS: ${ruleFlags.join(", ") || "none"}

Respond ONLY with valid JSON:
{
  "score": 0-100,
  "level": "low"|"medium"|"high"|"critical",
  "flags": ["string array of detected issues"],
  "player_classification": "recreational"|"semi_pro"|"sharp"|"syndicate",
  "confidence": 0.0-1.0,
  "recommended_actions": ["array of recommended actions"],
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
        system: `You are an iGaming risk analysis AI for an Italian betting platform. Analyze betting patterns for: arbitrage, stake manipulation, bonus abuse, syndicate activity, money laundering, sharp betting. Be thorough but avoid false positives. Score: 0-25 low, 26-50 medium, 51-75 high, 76-100 critical.`,
      }),
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || "{}";
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ═══ Execute auto-actions ═══
async function executeAutoActions(
  supabase: ReturnType<typeof getSupabase>,
  score: number,
  user: any,
  betId: string,
  config: any,
  aiResult: EnhancedAIResult | null
) {
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
      user_id: user.id,
      limit_type: "max_bet",
      limit_value: 50,
      reason: `Auto-reduced: risk score ${score}`,
      set_by: "system",
    });
    actions.push("limits_reduced");
  }

  // Auto-require KYC
  if (score >= thresholds.auto_kyc && user?.kyc_status === "unverified" && auto_actions.require_kyc) {
    actions.push("kyc_required");
  }

  // Create risk flag alert
  if (score >= thresholds.auto_flag && auto_actions.notify_admin) {
    await supabase.from("risk_flags").insert({
      user_id: user.id,
      flag_type: score >= thresholds.auto_block ? "auto_block" : score >= thresholds.auto_reduce_limits ? "limit_reduce" : "manual_review",
      severity: score > 75 ? "critical" : score > 50 ? "high" : "medium",
      description: `Risk score ${score}. ${aiResult?.reasoning || "Rule-based detection."}`,
      ai_analysis: aiResult || {},
      related_entity_type: "bet",
      related_entity_id: betId,
      status: "open",
    });
    actions.push("alert_created");
  }

  return actions;
}

// ═══ Main POST handler ═══
export async function POST(req: NextRequest) {
  try {
    const { bet_id, use_ai } = await req.json();
    const supabase = getSupabase();

    // Load config
    const config = await loadRiskConfig(supabase);

    // Get bet with selections
    const { data: bet } = await supabase
      .from("bets")
      .select("*, bet_selections(*)")
      .eq("id", bet_id)
      .single();
    if (!bet) return NextResponse.json({ error: "Bet not found" }, { status: 404 });

    // Get user
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", bet.user_id)
      .single();

    // Get player profile (or compute it)
    const profile = await getOrComputeProfile(supabase, bet.user_id);

    // Get betting history
    const { data: history } = await supabase
      .from("bets")
      .select("*, bet_selections(event_id)")
      .eq("user_id", bet.user_id)
      .order("created_at", { ascending: false })
      .limit(100);

    // Rule-based analysis
    const ruleAnalysis = ruleBasedAnalysis(bet, history || [], user, profile, config.rules);

    // AI analysis (if score > threshold or explicitly requested)
    let aiAnalysis: EnhancedAIResult | null = null;
    const shouldUseAI = use_ai ||
      (config.ai_settings.enabled && ruleAnalysis.score >= config.ai_settings.auto_analyze_above);

    if (shouldUseAI) {
      aiAnalysis = await analyzeWithClaude(bet, user, profile, history || [], ruleAnalysis.flags, config.ai_settings);
    }

    // Final score = max of rule + AI
    const finalScore = aiAnalysis
      ? Math.max(ruleAnalysis.score, aiAnalysis.score)
      : ruleAnalysis.score;
    const finalLevel = finalScore <= 25 ? "low" : finalScore <= 50 ? "medium" : finalScore <= 75 ? "high" : "critical";

    // Execute auto-actions
    const actionsExecuted = await executeAutoActions(supabase, finalScore, user, bet_id, config, aiAnalysis);

    // Update bet risk score
    const allFlags = [...new Set([...ruleAnalysis.flags, ...(aiAnalysis?.flags || [])])];
    await supabase.from("bets").update({
      risk_score: finalScore,
      risk_flags: allFlags,
    }).eq("id", bet_id);

    // Update player profile
    if (profile?.user_id) {
      await supabase.from("player_profiles").update({
        risk_score: finalScore,
        classification: aiAnalysis?.player_classification || profile.classification,
        flags_count: (profile.flags_count || 0) + (finalScore >= config.thresholds.auto_flag ? 1 : 0),
        updated_at: new Date().toISOString(),
      }).eq("user_id", bet.user_id);
    }

    return NextResponse.json({
      bet_id,
      rule_analysis: ruleAnalysis,
      ai_analysis: aiAnalysis,
      final_score: finalScore,
      final_level: finalLevel,
      actions_executed: actionsExecuted,
      action_taken: finalScore >= config.thresholds.auto_block ? "blocked"
        : finalScore >= config.thresholds.auto_flag ? "flagged"
        : "accepted",
    });

  } catch (err: any) {
    console.error("Risk agent error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
