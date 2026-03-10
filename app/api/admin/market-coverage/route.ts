import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ═══ GET — Market Coverage Report (Source vs Vincitu Gap) ═══
// Query params: action=stats|event-detail|sport-leagues|league-events

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "stats";

  const supabase = createAdminClient();

  try {
    switch (action) {
      case "stats":
        return await getStats(supabase);
      case "event-detail":
        return await getEventDetail(supabase, sp);
      case "sport-leagues":
        return await getSportLeagues(supabase, sp);
      case "league-events":
        return await getLeagueEvents(supabase, sp);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[market-coverage]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Stats: RPC summary + gap events ───

async function getStats(supabase: any) {
  const { data, error } = await supabase.rpc("get_market_coverage").single();
  if (error) throw error;

  return NextResponse.json({
    summary: data.summary || [],
    gap_events: data.gap_events || [],
    total_events: data.total_events || 0,
    events_with_source: data.events_with_source || 0,
    generated_at: data.generated_at,
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
      source_markets_count: event.source_markets_count,
    },
    vincitu_count: markets.length,
    market_types: marketTypes,
  });
}

// ─── Sport Leagues: aggregate coverage by league for a sport ───

async function getSportLeagues(supabase: any, sp: URLSearchParams) {
  const sportSlug = sp.get("sport");
  if (!sportSlug) return NextResponse.json({ error: "sport required" }, { status: 400 });

  const status = sp.get("status");

  // Resolve sport
  const { data: sportRow, error: sErr } = await supabase
    .from("sports")
    .select("id, name, slug")
    .eq("slug", sportSlug)
    .limit(1)
    .single();
  if (sErr || !sportRow) return NextResponse.json({ error: "Sport not found" }, { status: 404 });

  // Fetch all events for this sport (include source_markets_count)
  let query = supabase
    .from("events")
    .select("id, league_id, status, source_markets_count, leagues(id, name, country)")
    .eq("sport_id", sportRow.id)
    .in("status", ["prematch", "live"]);

  if (status === "live") query = query.eq("status", "live");
  else if (status === "prematch") query = query.eq("status", "prematch");

  // Paginate to get all events
  const allEvents: any[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: batch, error: bErr } = await query.range(offset, offset + PAGE - 1);
    if (bErr) throw bErr;
    if (!batch || batch.length === 0) break;
    allEvents.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  // Get active market counts for all events (batched)
  const eventIds = allEvents.map((e: any) => e.id);
  const countMap = new Map<string, number>();

  for (let i = 0; i < eventIds.length; i += 50) {
    const batch = eventIds.slice(i, i + 50);
    let mOffset = 0;
    while (true) {
      const { data: mkts } = await supabase
        .from("markets")
        .select("event_id")
        .in("event_id", batch)
        .eq("is_active", true)
        .range(mOffset, mOffset + 999);

      if (!mkts || mkts.length === 0) break;
      for (const m of mkts) {
        countMap.set(m.event_id, (countMap.get(m.event_id) || 0) + 1);
      }
      if (mkts.length < 1000) break;
      mOffset += 1000;
    }
  }

  // Aggregate by league
  const leagueMap = new Map<string, {
    league_id: string;
    league_name: string;
    country: string;
    events_count: number;
    events_with_source: number;
    total_vincitu: number;
    total_source: number;
    zero_markets: number;
    gap_events: number;
  }>();

  for (const ev of allEvents) {
    const lid = ev.league_id || "unknown";
    const lname = ev.leagues?.name || "Sconosciuto";
    const lcountry = ev.leagues?.country || "";
    const vincituCount = countMap.get(ev.id) || 0;
    const sourceCount = ev.source_markets_count as number | null;

    let entry = leagueMap.get(lid);
    if (!entry) {
      entry = {
        league_id: lid,
        league_name: lname,
        country: lcountry,
        events_count: 0,
        events_with_source: 0,
        total_vincitu: 0,
        total_source: 0,
        zero_markets: 0,
        gap_events: 0,
      };
      leagueMap.set(lid, entry);
    }

    entry.events_count++;
    entry.total_vincitu += vincituCount;
    if (vincituCount === 0) entry.zero_markets++;
    if (sourceCount != null) {
      entry.events_with_source++;
      entry.total_source += sourceCount;
      if (sourceCount > vincituCount) entry.gap_events++;
    }
  }

  const leagues = Array.from(leagueMap.values()).map((l) => {
    const avgVincitu = l.events_count > 0 ? Math.round((l.total_vincitu / l.events_count) * 10) / 10 : 0;
    const avgSource = l.events_with_source > 0 ? Math.round((l.total_source / l.events_with_source) * 10) / 10 : null;
    const gapPct = avgSource != null && avgSource > 0
      ? Math.round((1 - avgVincitu / avgSource) * 1000) / 10
      : null;
    const gapTotal = l.total_source > l.total_vincitu ? l.total_source - l.total_vincitu : 0;

    return {
      league_id: l.league_id,
      league_name: l.league_name,
      country: l.country,
      events_count: l.events_count,
      events_with_source: l.events_with_source,
      avg_vincitu: avgVincitu,
      avg_source: avgSource,
      gap_pct: gapPct,
      gap_total: gapTotal,
      zero_markets: l.zero_markets,
      gap_events: l.gap_events,
    };
  });

  // Sort by gap_events DESC, then zero_markets DESC
  leagues.sort((a, b) => b.gap_events - a.gap_events || b.zero_markets - a.zero_markets);

  // KPIs
  const totalEvents = allEvents.length;
  const eventsWithSource = allEvents.filter((e: any) => e.source_markets_count != null).length;
  const totalVincitu = Array.from(countMap.values()).reduce((a, b) => a + b, 0);
  const totalSource = allEvents.reduce((s: number, e: any) => s + (e.source_markets_count || 0), 0);
  const avgVincitu = totalEvents > 0 ? Math.round(totalVincitu / totalEvents * 10) / 10 : 0;
  const avgSource = eventsWithSource > 0 ? Math.round(totalSource / eventsWithSource * 10) / 10 : 0;
  const gapPct = avgSource > 0 ? Math.round((1 - avgVincitu / avgSource) * 1000) / 10 : null;
  const totalZero = leagues.reduce((s, l) => s + l.zero_markets, 0);
  const totalGapEvents = leagues.reduce((s, l) => s + l.gap_events, 0);

  return NextResponse.json({
    sport: { id: sportRow.id, name: sportRow.name, slug: sportRow.slug },
    leagues,
    kpis: {
      total_events: totalEvents,
      events_with_source: eventsWithSource,
      avg_vincitu: avgVincitu,
      avg_source: avgSource,
      gap_pct: gapPct,
      zero_markets: totalZero,
      gap_events: totalGapEvents,
    },
  });
}

// ─── League Events: events for a specific league with coverage data ───

async function getLeagueEvents(supabase: any, sp: URLSearchParams) {
  const leagueId = sp.get("league_id");
  if (!leagueId) return NextResponse.json({ error: "league_id required" }, { status: 400 });

  const status = sp.get("status");
  const limit = Math.min(parseInt(sp.get("limit") || "200"), 200);

  let query = supabase
    .from("events")
    .select("id, external_id, home_team, away_team, starts_at, status, source, source_markets_count, leagues(name), sports(slug)")
    .eq("league_id", leagueId)
    .in("status", ["prematch", "live"])
    .order("starts_at", { ascending: true })
    .limit(limit);

  if (status === "live") query = query.eq("status", "live");
  else if (status === "prematch") query = query.eq("status", "prematch");

  const { data: events, error } = await query;
  if (error) throw error;

  // Get active market counts
  const eventIds = (events || []).map((e: any) => e.id);
  const countMap = new Map<string, number>();

  for (let i = 0; i < eventIds.length; i += 50) {
    const batch = eventIds.slice(i, i + 50);
    let mOffset = 0;
    while (true) {
      const { data: mkts } = await supabase
        .from("markets")
        .select("event_id")
        .in("event_id", batch)
        .eq("is_active", true)
        .range(mOffset, mOffset + 999);

      if (!mkts || mkts.length === 0) break;
      for (const m of mkts) {
        countMap.set(m.event_id, (countMap.get(m.event_id) || 0) + 1);
      }
      if (mkts.length < 1000) break;
      mOffset += 1000;
    }
  }

  const enriched = (events || []).map((e: any) => {
    const vincituCount = countMap.get(e.id) || 0;
    const sourceCount = e.source_markets_count as number | null;
    const gap = sourceCount != null ? sourceCount - vincituCount : null;
    const coveragePct = sourceCount != null && sourceCount > 0
      ? Math.round((vincituCount / sourceCount) * 1000) / 10
      : null;

    return {
      id: e.id,
      external_id: e.external_id,
      home_team: e.home_team,
      away_team: e.away_team,
      starts_at: e.starts_at,
      status: e.status,
      source: e.source,
      league_name: e.leagues?.name,
      source_count: sourceCount,
      vincitu_count: vincituCount,
      gap,
      coverage_pct: coveragePct,
    };
  });

  // Sort by gap DESC (worst first), events without source at end
  enriched.sort((a: any, b: any) => {
    if (a.gap == null && b.gap == null) return 0;
    if (a.gap == null) return 1;
    if (b.gap == null) return -1;
    return b.gap - a.gap;
  });

  return NextResponse.json({ events: enriched });
}
