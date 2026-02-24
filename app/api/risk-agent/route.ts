import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { runRiskAnalysis } from "@/lib/risk/engine";

// ═══════════════════════════════════════════════════
// AI RISK AGENT — Thin wrapper over lib/risk/engine
// ═══════════════════════════════════════════════════

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    let { bet_id, use_ai } = await req.json();
    const supabase = getSupabase();

    // Strip # prefix if present
    bet_id = bet_id?.replace(/^#/, "");

    // If partial ID (not full UUID), resolve to full ID
    if (bet_id && bet_id.length < 36) {
      const { data } = await supabase
        .from("bets").select("id").ilike("id", `${bet_id}%`).limit(1).single();
      if (!data) return NextResponse.json({ error: "Bet non trovata con ID parziale" }, { status: 404 });
      bet_id = data.id;
    }

    const result = await runRiskAnalysis(supabase, bet_id, { use_ai });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Risk agent error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
