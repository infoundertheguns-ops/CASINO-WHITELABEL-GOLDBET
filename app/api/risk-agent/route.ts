import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// AI Risk Agent — Claude API integration for bet risk analysis
// Analyzes: unusual patterns, stake spikes, arbitrage detection, account velocity

interface RiskAnalysis {
  score: number; // 0-100
  level: "low" | "medium" | "high" | "critical";
  flags: string[];
  recommendation: string;
  details: string;
}

async function analyzeWithClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return JSON.stringify({ score: 0, level: "low", flags: [], recommendation: "API key not configured", details: "" });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      system: `You are an iGaming risk analysis AI. Analyze betting patterns and return ONLY valid JSON with this structure:
{"score": number 0-100, "level": "low"|"medium"|"high"|"critical", "flags": ["string array"], "recommendation": "string", "details": "string"}
Score thresholds: 0-25 low, 26-50 medium, 51-75 high, 76-100 critical.
Look for: arbitrage, stake manipulation, bonus abuse, account velocity anomalies, syndicate patterns, money laundering indicators.`,
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text || "{}";
}

function ruleBasedAnalysis(bet: any, history: any[], user: any): RiskAnalysis {
  const flags: string[] = [];
  let score = 0;

  // Stake spike detection
  const avgStake = history.length > 0 ? history.reduce((s: number, b: any) => s + (b.stake || 0), 0) / history.length : 0;
  if (avgStake > 0 && bet.stake > avgStake * 5) {
    flags.push("STAKE_SPIKE");
    score += 25;
  }

  // High stake absolute
  if (bet.stake > 1000) { flags.push("HIGH_STAKE"); score += 15; }
  if (bet.stake > 5000) { flags.push("VERY_HIGH_STAKE"); score += 20; }

  // New account high betting
  const accountAge = user?.created_at ? (Date.now() - new Date(user.created_at).getTime()) / 86400000 : 999;
  if (accountAge < 1 && bet.stake > 100) { flags.push("NEW_ACCOUNT_HIGH_STAKE"); score += 30; }
  if (accountAge < 7 && bet.stake > 500) { flags.push("YOUNG_ACCOUNT_HIGH_STAKE"); score += 20; }

  // High odds (potential arb)
  if (bet.total_odds > 20) { flags.push("HIGH_ODDS"); score += 15; }
  if (bet.total_odds > 50) { flags.push("EXTREME_ODDS"); score += 25; }

  // Rapid betting velocity
  const recentBets = history.filter((b: any) => Date.now() - new Date(b.created_at).getTime() < 3600000);
  if (recentBets.length > 10) { flags.push("HIGH_VELOCITY"); score += 20; }
  if (recentBets.length > 25) { flags.push("EXTREME_VELOCITY"); score += 30; }

  // Potential bonus abuse
  if (bet.is_free_bet && bet.total_odds > 10) { flags.push("FREE_BET_HIGH_ODDS"); score += 20; }

  // Win rate anomaly
  const settled = history.filter((b: any) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b: any) => b.status === "won").length;
  const winRate = settled.length > 10 ? wins / settled.length : 0;
  if (winRate > 0.7 && settled.length > 20) { flags.push("HIGH_WIN_RATE"); score += 25; }

  // KYC status
  if (user?.kyc_status !== "verified" && bet.stake > 200) { flags.push("UNVERIFIED_HIGH_STAKE"); score += 15; }

  score = Math.min(100, score);
  const level = score <= 25 ? "low" : score <= 50 ? "medium" : score <= 75 ? "high" : "critical";

  const recommendation =
    level === "critical" ? "BLOCK: Bloccare scommessa e sospendere account per review" :
    level === "high" ? "REVIEW: Richiedere verifica manuale prima di accettare" :
    level === "medium" ? "FLAG: Accettare con monitoraggio rafforzato" :
    "ACCEPT: Scommessa nella norma";

  return { score, level, flags, recommendation, details: `Account age: ${accountAge.toFixed(0)}d, Avg stake: $${avgStake.toFixed(2)}, Recent bets/h: ${recentBets.length}, Win rate: ${(winRate * 100).toFixed(0)}%` };
}

export async function POST(req: NextRequest) {
  try {
    const { bet_id, use_ai } = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get bet
    const { data: bet } = await supabase.from("bets").select("*").eq("id", bet_id).single();
    if (!bet) return NextResponse.json({ error: "Bet not found" }, { status: 404 });

    // Get user
    const { data: user } = await supabase.from("users").select("*").eq("id", bet.user_id).single();

    // Get betting history
    const { data: history } = await supabase
      .from("bets")
      .select("*")
      .eq("user_id", bet.user_id)
      .order("created_at", { ascending: false })
      .limit(100);

    // Rule-based analysis (always runs)
    const ruleAnalysis = ruleBasedAnalysis(bet, history || [], user);

    // AI analysis (optional, if API key configured)
    let aiAnalysis: RiskAnalysis | null = null;
    if (use_ai && process.env.ANTHROPIC_API_KEY) {
      const prompt = `Analyze this betting activity for risk:
BET: stake=$${bet.stake}, odds=${bet.total_odds}, type=${bet.bet_type}, potential_win=$${bet.potential_win}
USER: kyc=${user?.kyc_status}, class=${user?.user_class}, account_age=${user?.created_at}, country=${user?.country}
HISTORY: ${(history || []).length} total bets, last 10: ${JSON.stringify((history || []).slice(0, 10).map((b: any) => ({ stake: b.stake, odds: b.total_odds, status: b.status, time: b.created_at })))}
RULE_FLAGS: ${ruleAnalysis.flags.join(", ")}`;

      try {
        const aiResult = await analyzeWithClaude(prompt);
        const cleaned = aiResult.replace(/```json|```/g, "").trim();
        aiAnalysis = JSON.parse(cleaned);
      } catch {}
    }

    // Store risk score on bet
    await supabase.from("bets").update({
      risk_score: ruleAnalysis.score,
      risk_flags: ruleAnalysis.flags,
    }).eq("id", bet_id);

    // Create alert if high risk
    if (ruleAnalysis.score > 50) {
      await supabase.from("risk_flags").insert({
        user_id: bet.user_id,
        flag_type: ruleAnalysis.level === "critical" ? "auto_block" : "manual_review",
        severity: ruleAnalysis.level,
        description: `${ruleAnalysis.recommendation}. Flags: ${ruleAnalysis.flags.join(", ")}`,
        related_entity_type: "bet",
        related_entity_id: bet_id,
        status: "open",
      });
    }

    return NextResponse.json({
      bet_id,
      rule_analysis: ruleAnalysis,
      ai_analysis: aiAnalysis,
      action_taken: ruleAnalysis.score > 75 ? "blocked" : ruleAnalysis.score > 50 ? "flagged" : "accepted",
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
