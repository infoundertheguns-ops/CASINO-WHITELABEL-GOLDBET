export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/scraper/upcoming-events?hours=6
 *
 * Returns prematch events starting within the next N hours.
 * Used by the camoufox scraper at startup to bootstrap priority tiers
 * (so it knows which events are imminent before the first overview sweep).
 *
 * Auth: x-scraper-key header.
 * Response: { total, hours, events: [{ external_id, starts_at }] }
 */
export async function GET(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hours = Math.min(
    parseInt(req.nextUrl.searchParams.get("hours") || "6", 10) || 6,
    48,
  );

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() + hours * 60 * 60_000).toISOString();

  const { data, error } = await supabase
    .from("events")
    .select("external_id, starts_at")
    .eq("status", "prematch")
    .gte("starts_at", now)
    .lte("starts_at", cutoff)
    .order("starts_at", { ascending: true })
    .limit(5000);

  if (error) {
    console.error("[upcoming-events] query error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    total: data?.length || 0,
    hours,
    events: data || [],
  });
}
