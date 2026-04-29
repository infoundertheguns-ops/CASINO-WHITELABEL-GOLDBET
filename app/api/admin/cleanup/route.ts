export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// One-shot cleanup: deactivate all markets/outcomes for finished events
// and set them to "ended". Run once, then delete this route.
export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const BATCH = 100;
  let totalEvents = 0;
  let totalMarkets = 0;
  let totalOutcomes = 0;
  let page = 0;

  while (true) {
    // Fetch batch of finished events
    const { data: events } = await supabase
      .from("events")
      .select("id")
      .eq("status", "finished")
      .range(page * BATCH, (page + 1) * BATCH - 1);

    if (!events || events.length === 0) break;

    const eventIds = events.map((e) => e.id);

    // Get all active markets for these events
    const { data: markets } = await supabase
      .from("markets")
      .select("id")
      .in("event_id", eventIds)
      .eq("is_active", true)
      .limit(5000);

    if (markets && markets.length > 0) {
      const marketIds = markets.map((m) => m.id);

      // Deactivate outcomes in chunks
      for (let i = 0; i < marketIds.length; i += 200) {
        const chunk = marketIds.slice(i, i + 200);
        // Count outcomes before deactivating
        const { count } = await supabase
          .from("outcomes")
          .select("*", { count: "exact", head: true })
          .in("market_id", chunk)
          .eq("is_active", true);
        totalOutcomes += count || 0;

        await supabase
          .from("outcomes")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in("market_id", chunk)
          .eq("is_active", true);
      }

      // Deactivate markets in chunks
      for (let i = 0; i < marketIds.length; i += 200) {
        const chunk = marketIds.slice(i, i + 200);
        await supabase
          .from("markets")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in("id", chunk);
      }
      totalMarkets += marketIds.length;
    }

    // Set events to ended
    await supabase
      .from("events")
      .update({ status: "ended", updated_at: new Date().toISOString() })
      .in("id", eventIds);

    totalEvents += eventIds.length;
    page++;

    // Safety: max 50 pages (5000 events)
    if (page >= 50) break;
  }

  return NextResponse.json({
    events_ended: totalEvents,
    markets_deactivated: totalMarkets,
    outcomes_deactivated: totalOutcomes,
  });
}
