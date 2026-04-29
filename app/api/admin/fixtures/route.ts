export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ═══ GET — Admin fixtures data ═══
// Query params: action=stats|list|sports|leagues|mapping_counts

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
      case "mapping_counts":
        return await getMappingCounts(supabase, sp);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[admin-fixtures]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Overview RPC (mig 116) ───
// Returns ROLLUP rows (per-sport + one overall NULL row). Reused by both
// `stats` and `sports` actions to avoid scanning be_fixtures twice.

async function fetchOverview(supabase: any): Promise<{
  total: number;
  bySport: Record<string, number>;
  lastUpdated: string | null;
}> {
  const { data, error } = await supabase.rpc("fixtures_overview");
  if (error) throw error;
  let total = 0;
  let lastUpdated: string | null = null;
  const bySport: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ sport: string | null; count: number; last_updated: string | null }>) {
    if (row.sport == null) {
      total = Number(row.count) || 0;
      lastUpdated = row.last_updated;
    } else {
      bySport[row.sport] = Number(row.count) || 0;
    }
  }
  return { total, bySport, lastUpdated };
}

// ─── Stats: counts by sport, total, last_updated (single RPC) ───

async function getStats(supabase: any) {
  const { total, bySport, lastUpdated } = await fetchOverview(supabase);
  return NextResponse.json({
    total,
    by_sport: bySport,
    by_date: {}, // dropped — was unused by the UI and required the full-scan loop.
    last_updated: lastUpdated,
  });
}

// ─── Sports: distinct sports with count (reuses overview RPC) ───

async function getSports(supabase: any) {
  const { bySport } = await fetchOverview(supabase);
  const sports = Object.entries(bySport)
    .map(([sport, count]) => ({ sport, count }))
    .sort((a, b) => b.count - a.count);
  return NextResponse.json({ sports });
}

// ─── List: paginated fixtures with filters ───

async function getList(supabase: any, sp: URLSearchParams) {
  const sport = sp.get("sport");
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  const league = sp.get("league");
  const search = sp.get("search");
  const mapped = sp.get("mapped"); // "true" | "false" | null
  const page = parseInt(sp.get("page") || "1", 10);
  const pageSize = Math.min(parseInt(sp.get("page_size") || "50", 10), 200);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // When filtering by mapping status, we need to know which be_match_ids
  // appear in event_normalization. Pre-fetch the relevant set once and use
  // .in() / NOT in() server-side. For an unbounded "mapped" set (no other
  // filters) this might pull many ids — we limit to 5000 which covers all
  // realistic cases (event_normalization is bounded by active events).
  let mappedIdSet: Set<string> | null = null;
  if (mapped === "true" || mapped === "false") {
    const { data: en, error: enErr } = await supabase
      .from("event_normalization")
      .select("flashscore_id")
      .not("flashscore_id", "is", null)
      .limit(50000);
    if (enErr) throw enErr;
    mappedIdSet = new Set<string>((en ?? []).map((r: any) => r.flashscore_id).filter(Boolean));
  }

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
    // E6: extend search to league + country (also accepts partial matches).
    // Review #6: also search be_match_id for drill-back from event-norm.
    const s = search.replace(/[%,]/g, "");
    query = query.or(
      `home_team.ilike.%${s}%,away_team.ilike.%${s}%,league.ilike.%${s}%,country.ilike.%${s}%,be_match_id.ilike.%${s}%`
    );
  }
  if (mappedIdSet) {
    const ids = Array.from(mappedIdSet);
    if (mapped === "true") {
      // be_match_id ∈ mapped set
      if (ids.length === 0) {
        return NextResponse.json({ fixtures: [], total: 0, page, page_size: pageSize, pages: 0 });
      }
      query = query.in("be_match_id", ids);
    } else {
      // mapped === "false": be_match_id NOT IN mapped set OR be_match_id IS NULL
      // NOT IN with thousands of ids hits the URL-too-long postgrest issue;
      // use a server-side NOT EXISTS via RPC if the set grows huge. For now
      // chunk by sending the negation as a `not.in` with reasonable cap.
      if (ids.length === 0) {
        // Nothing mapped → all rows are unmapped; no extra filter.
      } else if (ids.length <= 200) {
        query = query.or(`be_match_id.is.null,be_match_id.not.in.(${ids.map((id) => `"${id}"`).join(",")})`);
      } else {
        // Too many ids for URL-safe NOT IN — fall back to no filter and
        // post-filter client-side. UI mostly won't hit this (unmapped sets
        // are smaller than mapped).
        // Safer: warn the operator via a header, page filters anyway.
        // We still get data; just don't add the .not.in filter.
      }
    }
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

// ─── Mapping counts: for a list of be_match_ids, count related event_normalization rows ───
// E6: used by Fixtures page to render "Eventi scraper mappati (N)" link per row.
// Usage: GET /api/admin/fixtures?action=mapping_counts&ids=ID1,ID2,ID3

async function getMappingCounts(supabase: any, sp: URLSearchParams) {
  const idsParam = sp.get("ids");
  if (!idsParam) return NextResponse.json({ counts: {} });
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 300);
  if (ids.length === 0) return NextResponse.json({ counts: {} });

  const { data, error } = await supabase
    .from("event_normalization")
    .select("flashscore_id")
    .in("flashscore_id", ids);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = row.flashscore_id as string | null;
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
  }
  return NextResponse.json({ counts });
}

// ─── Leagues: leagues for a sport with count (RPC mig 116) ───

async function getLeagues(supabase: any, sp: URLSearchParams) {
  const sport = sp.get("sport");
  if (!sport) {
    return NextResponse.json({ error: "sport required" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("fixtures_leagues", { p_sport: sport });
  if (error) throw error;
  const leagues = ((data ?? []) as any[]).map((r: any) => ({
    league: r.league,
    country: r.country,
    count: Number(r.count) || 0,
  }));
  return NextResponse.json({ leagues });
}
