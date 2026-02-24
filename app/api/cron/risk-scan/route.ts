import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  loadRiskConfig,
  getOrComputeProfile,
  batchPatternDetection,
  aiOptimizeOdds,
  applyOddsAdjustments,
  getEventLiability,
} from "@/lib/risk/engine";

// ═══════════════════════════════════════════════════
// CRON: Hourly Risk Scanner
// - Finds active bettors (>=10 bets in 24h)
// - Recomputes player profiles
// - Runs batch pattern detection (rules 13-16)
// - Creates risk flags for anomalies
// - Runs AI odds optimizer on high-liability events
// ═══════════════════════════════════════════════════

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  // Auth
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const config = await loadRiskConfig(supabase);
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const results = { scanned_users: 0, flags_created: 0, profiles_updated: 0, odds_adjusted: 0, errors: [] as string[] };

  try {
    // ── 1. Find active bettors (>=10 bets in 24h) ──
    const { data: activeBettors } = await supabase
      .from("bets")
      .select("user_id")
      .gte("created_at", since)
      .not("status", "eq", "rejected");

    if (!activeBettors) {
      return NextResponse.json({ ...results, message: "No bets in last 24h" });
    }

    // Count bets per user
    const userCounts: Record<string, number> = {};
    for (const b of activeBettors) {
      userCounts[b.user_id] = (userCounts[b.user_id] || 0) + 1;
    }

    const targetUsers = Object.entries(userCounts)
      .filter(([, count]) => count >= 10)
      .map(([userId]) => userId);

    results.scanned_users = targetUsers.length;

    // ── 2. Process each user ──
    for (const userId of targetUsers) {
      try {
        // Recompute profile
        const { data: bets } = await supabase
          .from("bets")
          .select("stake, total_odds, status, created_at, actual_win")
          .eq("user_id", userId);

        const allBets = bets || [];
        const settled = allBets.filter(b => b.status === "won" || b.status === "lost");
        const wins = settled.filter(b => b.status === "won");
        const totalStake = allBets.reduce((s, b) => s + (b.stake || 0), 0);
        const totalWon = wins.reduce((s, b) => s + ((b.actual_win || b.stake * (b.total_odds || 1)) || 0), 0);

        const profileData = {
          total_bets: allBets.length,
          total_stake: totalStake,
          total_won: totalWon,
          total_lost: totalStake - totalWon,
          win_rate: settled.length > 0 ? wins.length / settled.length : 0,
          avg_stake: allBets.length > 0 ? totalStake / allBets.length : 0,
          avg_odds: allBets.length > 0 ? allBets.reduce((s, b) => s + (b.total_odds || 0), 0) / allBets.length : 0,
          max_stake: allBets.length > 0 ? Math.max(...allBets.map(b => b.stake || 0)) : 0,
          lifetime_ggr: totalStake - totalWon,
          last_bet_at: allBets.length > 0 ? allBets[allBets.length - 1].created_at : null,
          updated_at: new Date().toISOString(),
        };

        await supabase
          .from("player_profiles")
          .upsert({ user_id: userId, ...profileData }, { onConflict: "user_id" });

        results.profiles_updated++;

        // Batch pattern detection (rules 13-16)
        const patterns = await batchPatternDetection(supabase, userId, config);

        if (patterns.flags.length > 0 && patterns.score >= 20) {
          const severity = patterns.score > 60 ? "high" : patterns.score > 30 ? "medium" : "low";

          await supabase.from("risk_flags").insert({
            user_id: userId,
            flag_type: "monitoring",
            severity,
            description: `Batch scan: ${patterns.flags.join(", ")} (score: ${patterns.score})`,
            status: "open",
            sla_deadline: new Date(Date.now() + (severity === "high" ? 24 : 72) * 3600000).toISOString(),
          });
          results.flags_created++;

          // Notification for high severity
          if (severity === "high") {
            const { data: user } = await supabase.from("users").select("username").eq("id", userId).single();
            await supabase.from("admin_notifications").insert({
              type: "risk_alert",
              severity: "warning",
              title: `Pattern rilevato: ${user?.username || userId.substring(0, 8)}`,
              message: `${patterns.flags.join(", ")} — Score: ${patterns.score}`,
              link: `/admin/risk/player/${userId}`,
              related_entity_type: "user",
              related_entity_id: userId,
            });
          }

          // Update profile risk score
          await supabase
            .from("player_profiles")
            .update({ risk_score: Math.max(patterns.score, profileData.lifetime_ggr < 0 ? 10 : 0) })
            .eq("user_id", userId);
        }
      } catch (err: any) {
        results.errors.push(`User ${userId}: ${err.message}`);
      }
    }

    // ── 3. AI Odds Optimizer — check high-liability events ──
    try {
      const { data: liveEvents } = await supabase
        .from("events")
        .select("id")
        .in("status", ["prematch", "live"])
        .limit(50);

      for (const event of liveEvents || []) {
        const liability = await getEventLiability(supabase, event.id);
        const highLiab = liability.filter(l => l.pct_used > (config.liability.rebalance_trigger_pct || 70));

        if (highLiab.length > 0) {
          const suggestions = await aiOptimizeOdds(supabase, event.id, config);

          if (suggestions.length > 0) {
            // Auto-apply if configured, otherwise just notify
            const autoApply = config.liability.ai_optimizer_enabled;

            if (autoApply) {
              await applyOddsAdjustments(
                supabase,
                suggestions.map(s => ({
                  outcome_id: s.outcome_id,
                  new_odds: s.suggested_odds,
                  reason: s.reason,
                  auto_applied: true,
                }))
              );
              results.odds_adjusted += suggestions.length;
            }

            // Always notify
            await supabase.from("admin_notifications").insert({
              type: "odds_suggestion",
              severity: "info",
              title: `AI Odds: ${suggestions.length} aggiustamenti`,
              message: suggestions.map(s => `${s.outcome_name}: ${s.current_odds} → ${s.suggested_odds}`).join(", "),
              link: `/admin/risk?tab=dashboard`,
            });
          }
        }
      }
    } catch (err: any) {
      results.errors.push(`Odds optimizer: ${err.message}`);
    }

    return NextResponse.json({ ...results, message: "Scan completed" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, ...results }, { status: 500 });
  }
}
