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
    const { bet_id, use_ai } = await req.json();
    const supabase = getSupabase();

    const result = await runRiskAnalysis(supabase, bet_id, { use_ai });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Risk agent error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
