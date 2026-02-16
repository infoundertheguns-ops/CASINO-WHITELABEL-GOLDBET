import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// Promo Engine — processes wagering contributions from bets and casino rounds
// Called after each bet placement or casino round

// Game category contribution weights (standard industry)
const GAME_CONTRIBUTIONS: Record<string, number> = {
  slots: 1.0,      // 100%
  crash: 1.0,      // 100%
  scratch: 1.0,    // 100%
  live_casino: 0.1, // 10%
  table_games: 0.1, // 10%
  video_poker: 0.05, // 5%
  sport: 1.0,       // 100% for sport bonuses
};

export async function POST(req: NextRequest) {
  try {
    const { user_id, amount, source, game_category } = await req.json();

    if (!user_id || !amount) {
      return NextResponse.json({ error: "user_id and amount required" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get active user promotions
    const { data: activePromos } = await supabase
      .from("user_promotions")
      .select("*")
      .eq("user_id", user_id)
      .eq("status", "active");

    if (!activePromos || activePromos.length === 0) {
      return NextResponse.json({ processed: 0, message: "No active promotions" });
    }

    let processed = 0;
    const results: any[] = [];

    for (const promo of activePromos) {
      // Calculate contribution
      const contribution = GAME_CONTRIBUTIONS[game_category || source || "slots"] || 0;
      const wagerAmount = amount * contribution;

      if (wagerAmount <= 0) continue;

      const newWagered = (promo.wagered_amount || 0) + wagerAmount;
      const wageringReq = promo.wagering_required || 0;

      // Check if wagering completed
      const completed = wageringReq > 0 && newWagered >= wageringReq;

      const updateData: any = {
        wagered_amount: newWagered,
      };

      if (completed) {
        updateData.status = "completed";

        // Convert bonus to real balance
        if (promo.bonus_amount > 0) {
          const { data: wallet } = await supabase
            .from("wallets")
            .select("balance, bonus_balance")
            .eq("user_id", user_id)
            .single();

          if (wallet) {
            await supabase.from("wallets").update({
              balance: wallet.balance + promo.bonus_amount,
              bonus_balance: Math.max(0, (wallet.bonus_balance || 0) - promo.bonus_amount),
            }).eq("user_id", user_id);

            await supabase.from("transactions").insert({
              user_id,
              type: "bonus_conversion",
              amount: promo.bonus_amount,
              status: "completed",
              description: `Bonus ${promo.promo_name || ""} convertito in saldo reale`,
              reference_id: promo.id,
              reference_type: "promotion",
            });
          }
        }
      }

      await supabase.from("user_promotions").update(updateData).eq("id", promo.id);

      // Log wagering
      await supabase.from("wagering_log").insert({
        user_promotion_id: promo.id,
        user_id,
        bet_amount: amount,
        contribution_pct: contribution * 100,
        contributed_amount: wagerAmount,
        game_category: game_category || source || "unknown",
      }); // wagering_log might not exist

      processed++;
      results.push({
        promo_id: promo.id,
        promo_name: promo.promo_name,
        wagered: newWagered,
        required: wageringReq,
        progress: wageringReq > 0 ? Math.min(100, (newWagered / wageringReq) * 100) : 100,
        completed,
      });
    }

    return NextResponse.json({ processed, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
