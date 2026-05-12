// Plan D Phase 2 — shadow settlement cron endpoint.
// Runs every 5min via crontab. Replays settled legs through odds-api engine,
// writes ONLY to settlement_log_shadow. Never mutates bet_selections.

export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { runSettlementPass } from "@/lib/settlement/odds-api/settle-leg";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startedAt = Date.now();
  const hoursWindow = Number(req.nextUrl.searchParams.get("hours") || 24);

  try {
    const result = await runSettlementPass(supabase, hoursWindow);
    const elapsedMs = Date.now() - startedAt;

    // Stamp last run for monitoring
    await supabase.from("system_config").upsert(
      { key: "last_run_settlement", value: JSON.stringify({ ts: new Date().toISOString(), ...result }) },
      { onConflict: "key" }
    );

    return NextResponse.json({
      ok: true,
      elapsed_ms: elapsedMs,
      hours_window: hoursWindow,
      ...result,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 500 }
    );
  }
}
