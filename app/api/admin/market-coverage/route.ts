import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ═══ GET — Market Coverage Report ═══
// Query params: action=stats|events|event-detail

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "stats";

  const supabase = createAdminClient();

  try {
    switch (action) {
      case "stats":
        return await getStats(supabase);
      case "events":
        return await getEvents(supabase, sp);
      case "event-detail":
        return await getEventDetail(supabase, sp);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[market-coverage]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Stats: RPC summary + scraper snapshot merge ───

async function getStats(supabase: any) {
  const { data, error } = await supabase.rpc("get_market_coverage").single();
  if (error) throw error;

  const result = data as {
    summary: any[];
    low_coverage_events: any[];
    generated_at: string;
  };

  // Merge scraper snapshot data if available
  const g = globalThis as any;
  const snapshotsBySource: Record<string, any[]> = g.__scraperSnapshotsBySource || {};

  const scraperAvg: Record<string, { live: number; prematch: number }> = {};

  for (const [source, snapshots] of Object.entries(snapshotsBySource)) {
    if (!snapshots || snapshots.length === 0) continue;
    const latest = snapshots[snapshots.length - 1];
    if (!latest?.by_sport) continue;

    for (const [sportName, sportData] of Object.entries(latest.by_sport as Record<string, any>)) {
      const gb = sportData.goldbet;
      if (!gb) continue;

      const key = `${sportName}:${source}`;
      const liveAvg = gb.live?.events > 0 ? gb.live.markets / gb.live.events : 0;
      const prematchAvg = gb.prematch?.events > 0 ? gb.prematch.markets / gb.prematch.events : 0;

      scraperAvg[sportName] = {
        live: Math.max(scraperAvg[sportName]?.live || 0, liveAvg),
        prematch: Math.max(scraperAvg[sportName]?.prematch || 0, prematchAvg),
      };
    }
  }

  // Enrich summary with scraper avg
  const enrichedSummary = (result.summary || []).map((row: any) => {
    const scraperData = scraperAvg[row.sport_name];
    const goldbet_avg = scraperData
      ? (row.status === "live" ? scraperData.live : scraperData.prematch)
      : null;
    const diff_pct = goldbet_avg && goldbet_avg > 0
      ? Math.round((row.avg_markets / goldbet_avg) * 1000) / 10
      : null;

    return { ...row, goldbet_avg: goldbet_avg ? Math.round(goldbet_avg * 10) / 10 : null, diff_pct };
  });

  return NextResponse.json({
    summary: enrichedSummary,
    low_coverage_events: result.low_coverage_events || [],
    generated_at: result.generated_at,
    has_scraper_data: Object.keys(scraperAvg).length > 0,
  });
}

// ─── Events: paginated list with market counts ───

async function getEvents(supabase: any, sp: URLSearchParams) {
  const sportSlug = sp.get("sport");
  const source = sp.get("source");
  const status = sp.get("status");
  const page = parseInt(sp.get("page") || "1");
  const limit = Math.min(parseInt(sp.get("limit") || "50"), 200);
  const offset = (page - 1) * limit;

  // Resolve sport_id from slug (filtering on joined table doesn't work without !inner)
  let sportId: string | null = null;
  if (sportSlug) {
    const { data: sportRow } = await supabase
      .from("sports")
      .select("id")
      .eq("slug", sportSlug)
      .limit(1)
      .single();
    sportId = sportRow?.id || null;
  }

  let query = supabase
    .from("events")
    .select("id, external_id, home_team, away_team, starts_at, status, is_live, source, sport_id, league_id, sports(name, slug), leagues(name)", { count: "exact" })
    .in("status", ["prematch", "live"])
    .order("starts_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (sportId) {
    query = query.eq("sport_id", sportId);
  }
  if (source && source !== "all") {
    query = query.eq("source", source);
  }
  if (status === "live") query = query.eq("status", "live");
  else if (status === "prematch") query = query.eq("status", "prematch");

  const { data: events, error, count } = await query;
  if (error) throw error;

  // Get market counts for these events
  const eventIds = (events || []).map((e: any) => e.id);
  const countMap = new Map<string, number>();

  if (eventIds.length > 0) {
    const PAGE = 1000;
    for (let i = 0; i < eventIds.length; i += 50) {
      const batch = eventIds.slice(i, i + 50);
      let mOffset = 0;
      while (true) {
        const { data: mkts } = await supabase
          .from("markets")
          .select("event_id")
          .in("event_id", batch)
          .eq("is_active", true)
          .range(mOffset, mOffset + PAGE - 1);

        if (!mkts || mkts.length === 0) break;
        for (const m of mkts) {
          countMap.set(m.event_id, (countMap.get(m.event_id) || 0) + 1);
        }
        if (mkts.length < PAGE) break;
        mOffset += PAGE;
      }
    }
  }

  // Compute sport averages from the RPC data
  const { data: rpcData } = await supabase.rpc("get_market_coverage").single();
  const sportAvgMap = new Map<string, number>();
  if (rpcData?.summary) {
    for (const row of rpcData.summary) {
      const key = `${row.sport_slug}:${row.source}:${row.status}`;
      sportAvgMap.set(key, row.avg_markets);
    }
  }

  const enrichedEvents = (events || []).map((e: any) => {
    const marketCount = countMap.get(e.id) || 0;
    const sportSlug = e.sports?.slug || "";
    const statusBucket = e.status === "live" ? "live" : "prematch";
    const avgKey = `${sportSlug}:${e.source}:${statusBucket}`;
    const sportAvg = sportAvgMap.get(avgKey) || 0;
    const coveragePct = sportAvg > 0 ? Math.round((marketCount / sportAvg) * 1000) / 10 : null;

    return {
      id: e.id,
      external_id: e.external_id,
      home_team: e.home_team,
      away_team: e.away_team,
      starts_at: e.starts_at,
      status: e.status,
      source: e.source,
      sport_name: e.sports?.name,
      sport_slug: e.sports?.slug,
      league_name: e.leagues?.name,
      market_count: marketCount,
      sport_avg: sportAvg,
      coverage_pct: coveragePct,
    };
  });

  // Sort by coverage ascending (worst first)
  enrichedEvents.sort((a: any, b: any) => (a.coverage_pct ?? 999) - (b.coverage_pct ?? 999));

  return NextResponse.json({
    events: enrichedEvents,
    total: count || 0,
    page,
    limit,
  });
}

// ─── Event detail: single event with market breakdown ───

async function getEventDetail(supabase: any, sp: URLSearchParams) {
  const eventId = sp.get("event_id");
  if (!eventId) return NextResponse.json({ error: "event_id required" }, { status: 400 });

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("*, sports(name, slug), leagues(name)")
    .eq("id", eventId)
    .limit(1)
    .single();

  if (evErr) throw evErr;

  // Fetch active markets
  const markets: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data: page, error: mErr } = await supabase
      .from("markets")
      .select("id, event_id, market_type, name, line, is_active, updated_at")
      .eq("event_id", eventId)
      .eq("is_active", true)
      .order("market_type")
      .range(offset, offset + PAGE - 1);

    if (mErr) throw mErr;
    if (!page || page.length === 0) break;
    markets.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  // Group by market_type
  const byType = new Map<string, { type: string; count: number; markets: string[] }>();
  for (const m of markets) {
    const t = m.market_type || "unknown";
    const existing = byType.get(t);
    if (existing) {
      existing.count++;
      existing.markets.push(m.name);
    } else {
      byType.set(t, { type: t, count: 1, markets: [m.name] });
    }
  }

  const marketTypes = Array.from(byType.values()).sort((a, b) => b.count - a.count);

  return NextResponse.json({
    event: {
      id: event.id,
      external_id: event.external_id,
      home_team: event.home_team,
      away_team: event.away_team,
      starts_at: event.starts_at,
      status: event.status,
      source: event.source,
      sport_name: event.sports?.name,
      league_name: event.leagues?.name,
    },
    market_count: markets.length,
    market_types: marketTypes,
  });
}
