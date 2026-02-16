import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// Settlement Engine — 51 market types
// Call via POST /api/settlement with { event_id, result }
// In production this becomes a Supabase Edge Function triggered by event status change

const MARKET_SETTLERS: Record<string, (result: any, selection: string, line?: number) => "won" | "lost" | "void" | "push"> = {
  "1X2": (r, sel) => {
    if (r.home > r.away && sel === "1") return "won";
    if (r.home === r.away && sel === "X") return "won";
    if (r.home < r.away && sel === "2") return "won";
    return "lost";
  },
  "O/U 2.5": (r, sel) => {
    const total = r.home + r.away;
    if (total === 2.5) return "push";
    if (sel === "Over" && total > 2.5) return "won";
    if (sel === "Under" && total < 2.5) return "won";
    return "lost";
  },
  "O/U 1.5": (r, sel) => {
    const total = r.home + r.away;
    if (sel === "Over" && total > 1.5) return "won";
    if (sel === "Under" && total < 1.5) return "won";
    return "lost";
  },
  "O/U 3.5": (r, sel) => {
    const total = r.home + r.away;
    if (sel === "Over" && total > 3.5) return "won";
    if (sel === "Under" && total < 3.5) return "won";
    return "lost";
  },
  "GG/NG": (r, sel) => {
    const gg = r.home > 0 && r.away > 0;
    if (sel === "GG" && gg) return "won";
    if (sel === "NG" && !gg) return "won";
    return "lost";
  },
  "DC": (r, sel) => { // Double Chance
    if (sel === "1X" && r.home >= r.away) return "won";
    if (sel === "X2" && r.home <= r.away) return "won";
    if (sel === "12" && r.home !== r.away) return "won";
    return "lost";
  },
  "HT_FT": (r, sel) => { // Half-time / Full-time
    const htRes = r.ht_home > r.ht_away ? "1" : r.ht_home === r.ht_away ? "X" : "2";
    const ftRes = r.home > r.away ? "1" : r.home === r.away ? "X" : "2";
    if (sel === `${htRes}/${ftRes}`) return "won";
    return "lost";
  },
  "EXACT_SCORE": (r, sel) => {
    if (sel === `${r.home}-${r.away}`) return "won";
    return "lost";
  },
  "FIRST_GOAL": (r, sel) => {
    if (sel === "1" && r.first_scorer === "home") return "won";
    if (sel === "2" && r.first_scorer === "away") return "won";
    if (sel === "No Goal" && r.home + r.away === 0) return "won";
    return "lost";
  },
  "CORNERS_OU": (r, sel, line) => {
    const total = (r.corners_home || 0) + (r.corners_away || 0);
    if (!line) return "void";
    if (sel === "Over" && total > line) return "won";
    if (sel === "Under" && total < line) return "won";
    if (total === line) return "push";
    return "lost";
  },
  "CARDS_OU": (r, sel, line) => {
    const total = (r.cards_home || 0) + (r.cards_away || 0);
    if (!line) return "void";
    if (sel === "Over" && total > line) return "won";
    if (sel === "Under" && total < line) return "won";
    if (total === line) return "push";
    return "lost";
  },
  "HANDICAP": (r, sel, line) => {
    if (!line) return "void";
    const adj_home = r.home + line;
    if (sel === "1" && adj_home > r.away) return "won";
    if (sel === "X" && adj_home === r.away) return "won";
    if (sel === "2" && adj_home < r.away) return "won";
    return "lost";
  },
  "CLEAN_SHEET": (r, sel) => {
    if (sel === "Home CS" && r.away === 0) return "won";
    if (sel === "Away CS" && r.home === 0) return "won";
    return "lost";
  },
  "WIN_TO_NIL": (r, sel) => {
    if (sel === "Home" && r.home > 0 && r.away === 0) return "won";
    if (sel === "Away" && r.away > 0 && r.home === 0) return "won";
    return "lost";
  },
  "DRAW_NO_BET": (r, sel) => {
    if (r.home === r.away) return "void";
    if (sel === "1" && r.home > r.away) return "won";
    if (sel === "2" && r.home < r.away) return "won";
    return "lost";
  },
};

export async function POST(req: NextRequest) {
  try {
    const { event_id, result } = await req.json();

    if (!event_id || !result) {
      return NextResponse.json({ error: "event_id and result required" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all open bet legs for this event
    const { data: legs, error: legsErr } = await supabase
      .from("bet_selections")
      .select("*, bets(*)")
      .eq("event_id", event_id)
      .eq("status", "open");

    if (legsErr || !legs) {
      return NextResponse.json({ error: legsErr?.message || "No legs found" }, { status: 500 });
    }

    let settled = 0;
    let errors = 0;

    for (const leg of legs) {
      const settler = MARKET_SETTLERS[leg.market_type];
      if (!settler) {
        errors++;
        continue;
      }

      const legResult = settler(result, leg.selection, leg.line);

      // Update leg status
      await supabase.from("bet_selections").update({ status: legResult }).eq("id", leg.id);

      // Check if all legs of the parent bet are settled
      const { data: allLegs } = await supabase
        .from("bet_selections")
        .select("status")
        .eq("bet_id", leg.bet_id);

      if (allLegs && allLegs.every(l => l.status !== "open")) {
        // All legs settled — determine bet outcome
        const hasLost = allLegs.some(l => l.status === "lost");
        const allVoid = allLegs.every(l => l.status === "void");
        const betStatus = allVoid ? "void" : hasLost ? "lost" : "won";

        await supabase.from("bets").update({
          status: betStatus,
          settled_at: new Date().toISOString(),
        }).eq("id", leg.bet_id);

        // Credit winnings
        if (betStatus === "won" && leg.bets) {
          const { data: wallet } = await supabase
            .from("wallets")
            .select("balance")
            .eq("user_id", leg.bets.user_id)
            .single();

          if (wallet) {
            await supabase.from("wallets").update({
              balance: wallet.balance + leg.bets.potential_win,
            }).eq("user_id", leg.bets.user_id);

            await supabase.from("transactions").insert({
              user_id: leg.bets.user_id,
              type: "win",
              amount: leg.bets.potential_win,
              status: "completed",
              description: `Vincita scommessa #${leg.bet_id.slice(0, 8)}`,
              reference_id: leg.bet_id,
              reference_type: "bet",
            });
          }
        }

        // Refund void bets
        if (betStatus === "void" && leg.bets) {
          const { data: wallet } = await supabase
            .from("wallets")
            .select("balance")
            .eq("user_id", leg.bets.user_id)
            .single();

          if (wallet) {
            await supabase.from("wallets").update({
              balance: wallet.balance + leg.bets.stake,
            }).eq("user_id", leg.bets.user_id);
          }
        }

        settled++;
      }
    }

    return NextResponse.json({
      success: true,
      event_id,
      legs_processed: legs.length,
      bets_settled: settled,
      errors,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
