export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════
// CRON: Consensus snapshot — Kambi vs 22bet outlier detection
// - Matches cross-source event pairs by normalized team names + hour
// - Compares current odds on common (market_type, outcome_name)
// - Upserts outliers exceeding threshold (default 15%) to consensus_snapshots
// - Should run every 15-60 min via crontab
// ═══════════════════════════════════════════════════

async function stampLastRun(sb: any, key: string, data: any) {
  await sb.from("system_config").upsert(
    { key, value: JSON.stringify({ at: new Date().toISOString(), ...data }) },
    { onConflict: "key" }
  );
}

async function handle(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? req.nextUrl.searchParams.get("key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threshold = Number(req.nextUrl.searchParams.get("threshold") ?? 15);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
    return NextResponse.json({ error: "Invalid threshold" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const t0 = Date.now();
  const { data, error } = await supabase.rpc("refresh_consensus_snapshots", {
    threshold_pct: threshold,
  });

  if (error) {
    return NextResponse.json(
      { error: "RPC failed", details: error.message },
      { status: 500 }
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const result = {
    upserted: Number(row?.upserted ?? 0),
    scanned_pairs: Number(row?.scanned_pairs ?? 0),
    candidate_deltas: Number(row?.candidate_deltas ?? 0),
    threshold_pct: threshold,
    duration_ms: Date.now() - t0,
  };

  await stampLastRun(supabase, "last_consensus_refresh", result);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
