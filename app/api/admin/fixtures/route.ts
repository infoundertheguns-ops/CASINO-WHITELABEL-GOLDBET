import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ═══ GET — Admin fixtures data ═══
// Query params: action=stats|list|sports|leagues

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "stats";

  const supabase = createAdminClient();

  try {
    switch (action) {
      case "stats":
        return await getStats(supabase);
      case "list":
        return await getList(supabase, sp);
      case "sports":
        return await getSports(supabase);
      case "leagues":
        return await getLeagues(supabase, sp);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[admin-fixtures]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Stats: counts by sport, by date, total, last_updated ───

async function getStats(supabase: any) {
  const PAGE = 1000;

  // Count by sport
  const sportCounts: Record<string, number> = {};
  // Count by date
  const dateCounts: Record<string, number> = {};
  let total = 0;
  let lastUpdated: string | null = null;

  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("be_fixtures")
      .select("sport, match_date, updated_at")
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      total++;
      sportCounts[row.sport] = (sportCounts[row.sport] || 0) + 1;
      const dateKey = new Date(row.match_date).toISOString().split("T")[0];
      dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
      if (!lastUpdated) lastUpdated = row.updated_at;
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return NextResponse.json({
    total,
    by_sport: sportCounts,
    by_date: dateCounts,
    last_updated: lastUpdated,
  });
}

// ─── List: paginated fixtures with filters ───

async function getList(supabase: any, sp: URLSearchParams) {
  const sport = sp.get("sport");
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  const league = sp.get("league");
  const search = sp.get("search");
  const page = parseInt(sp.get("page") || "1", 10);
  const pageSize = Math.min(parseInt(sp.get("page_size") || "50", 10), 200);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("be_fixtures")
    .select("*", { count: "exact" })
    .order("match_date", { ascending: true })
    .range(from, to);

  if (sport) query = query.eq("sport", sport);
  if (dateFrom) query = query.gte("match_date", dateFrom);
  if (dateTo) query = query.lte("match_date", dateTo + "T23:59:59Z");
  if (league) query = query.eq("league", league);
  if (search) {
    query = query.or(
      `home_team.ilike.%${search}%,away_team.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return NextResponse.json({
    fixtures: data || [],
    total: count || 0,
    page,
    page_size: pageSize,
    pages: Math.ceil((count || 0) / pageSize),
  });
}

// ─── Sports: distinct sports with count ───

async function getSports(supabase: any) {
  const PAGE = 1000;
  const sportCounts: Record<string, number> = {};

  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("be_fixtures")
      .select("sport")
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      sportCounts[row.sport] = (sportCounts[row.sport] || 0) + 1;
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const sports = Object.entries(sportCounts)
    .map(([sport, count]) => ({ sport, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ sports });
}

// ─── Leagues: leagues for a sport with count ───

async function getLeagues(supabase: any, sp: URLSearchParams) {
  const sport = sp.get("sport");
  if (!sport) {
    return NextResponse.json({ error: "sport required" }, { status: 400 });
  }

  const PAGE = 1000;
  const leagueCounts: Record<string, { country: string | null; count: number }> = {};

  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("be_fixtures")
      .select("league, country")
      .eq("sport", sport)
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const key = row.league || "Unknown";
      if (!leagueCounts[key]) {
        leagueCounts[key] = { country: row.country, count: 0 };
      }
      leagueCounts[key].count++;
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const leagues = Object.entries(leagueCounts)
    .map(([league, { country, count }]) => ({ league, country, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ leagues });
}
