export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { settleEvent } from "@/lib/settlement";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_id, result } = body;

    if (!event_id) {
      return NextResponse.json(
        { error: "event_id is required" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // result is optional — if provided, used as manual override { home, away }
    const manualResult =
      result && typeof result.home === "number" && typeof result.away === "number"
        ? { home: result.home, away: result.away }
        : undefined;

    const outcome = await settleEvent(supabase, event_id, manualResult);

    const status = outcome.error ? 400 : 200;
    return NextResponse.json(outcome, { status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
