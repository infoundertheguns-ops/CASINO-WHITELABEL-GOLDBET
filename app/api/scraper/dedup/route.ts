import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/scraper/dedup
 * Cleanup: finds duplicate events (same home_team + away_team + league_id)
 * and merges them, keeping the oldest one and deleting newer duplicates.
 * Paginates to handle large datasets (Supabase default limit = 1000).
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-scraper-key");
  if (!key || key !== process.env.SCRAPER_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch ALL events (paginated, 1000 per page)
  const allEvents: any[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("id, external_id, home_team, away_team, league_id, is_live, status, created_at")
      .in("status", ["prematch", "live"])
      .order("created_at", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  // Group by home_team + away_team + league_id
  const groups = new Map<string, typeof allEvents>();
  for (const ev of allEvents) {
    const k = `${ev.home_team}|${ev.away_team}|${ev.league_id}`.toLowerCase();
    const group = groups.get(k) || [];
    group.push(ev);
    groups.set(k, group);
  }

  let deleted = 0;
  const errors: string[] = [];

  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    // Keep the first (oldest), delete the rest
    const [, ...dupes] = group;
    const dupeIds = dupes.map((d: any) => d.id);

    // Delete in chunks of 100 (Supabase .in() limit)
    for (let i = 0; i < dupeIds.length; i += 100) {
      const chunk = dupeIds.slice(i, i + 100);

      // Delete outcomes for dupe events' markets
      const { data: dupeMarkets } = await supabase
        .from("markets")
        .select("id")
        .in("event_id", chunk);

      if (dupeMarkets && dupeMarkets.length > 0) {
        const marketIds = dupeMarkets.map((m: any) => m.id);
        for (let j = 0; j < marketIds.length; j += 100) {
          const mChunk = marketIds.slice(j, j + 100);
          await supabase.from("outcomes").delete().in("market_id", mChunk);
        }
        await supabase.from("markets").delete().in("event_id", chunk);
      }

      // Delete duplicate events
      const { error: delErr } = await supabase
        .from("events")
        .delete()
        .in("id", chunk);

      if (delErr) {
        errors.push(`Delete failed: ${delErr.message}`);
      } else {
        deleted += chunk.length;
      }
    }
  }

  const remaining = allEvents.length - deleted;
  return NextResponse.json({
    total_fetched: allEvents.length,
    duplicates_deleted: deleted,
    remaining,
    errors: errors.slice(0, 10),
  });
}
