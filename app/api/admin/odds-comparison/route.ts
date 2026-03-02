import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ═══ GET — Admin odds comparison data ═══
// Query params: action=events|event-detail|sports|match-suggestions

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "sports";

  const supabase = createAdminClient();

  try {
    switch (action) {
      case "sports":
        return await getSports(supabase);
      case "events":
        return await getEvents(supabase, sp);
      case "event-detail":
        return await getEventDetail(supabase, sp);
      case "match-suggestions":
        return await getMatchSuggestions(supabase, sp);
      case "leagues":
        return await getLeagues(supabase, sp);
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[odds-comparison]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Sports with active event counts ───

async function getSports(supabase: any) {
  // Count per source separately
  const sportMap = new Map<string, { id: string; name: string; goldbet: number; kambi: number }>();
  const PAGE = 1000;

  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("sport_id, source, sports(name)")
      .in("status", ["prematch", "live"])
      .range(offset, offset + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const id = row.sport_id;
      const name = row.sports?.name || "Unknown";
      const src = row.source as string;
      const existing = sportMap.get(id) || { id, name, goldbet: 0, kambi: 0 };
      if (src === "kambi") existing.kambi++;
      else existing.goldbet++;
      sportMap.set(id, existing);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const sports = Array.from(sportMap.values()).sort((a, b) =>
    (b.goldbet + b.kambi) - (a.goldbet + a.kambi)
  );
  return NextResponse.json({ sports });
}

// ─── Events list by source/sport/status ───

async function getEvents(supabase: any, sp: URLSearchParams) {
  const source = sp.get("source") || "goldbet";
  const sportId = sp.get("sport_id");
  const leagueId = sp.get("league_id");
  const status = sp.get("status"); // live, prematch, or null for all

  // Paginate to get all events (not just 500)
  const allData: any[] = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from("events")
      .select("id, external_id, home_team, away_team, starts_at, score_home, score_away, status, is_live, source, sport_id, league_id, sports(name), leagues(name)")
      .eq("source", source)
      .order("starts_at", { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (sportId) query = query.eq("sport_id", sportId);
    if (leagueId) query = query.eq("league_id", leagueId);
    if (status === "live") query = query.eq("status", "live");
    else if (status === "prematch") query = query.eq("status", "prematch");
    else query = query.in("status", ["prematch", "live"]);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const data = allData;

  // Add market/outcome counts per event (batch)
  const eventIds = (data || []).map((e: any) => e.id);
  const countMap = new Map<string, { markets: number; outcomes: number }>();

  if (eventIds.length > 0) {
    // Count markets per event — paginate to handle > 1000 results
    const PAGE = 1000;
    const BATCH_IDS = 50; // Smaller batches of event IDs to keep results under 1000
    for (let i = 0; i < eventIds.length; i += BATCH_IDS) {
      const batch = eventIds.slice(i, i + BATCH_IDS);
      let offset = 0;
      while (true) {
        const { data: mkts } = await supabase
          .from("markets")
          .select("event_id")
          .in("event_id", batch)
          .eq("is_active", true)
          .range(offset, offset + PAGE - 1);

        if (!mkts || mkts.length === 0) break;
        for (const m of mkts) {
          const c = countMap.get(m.event_id) || { markets: 0, outcomes: 0 };
          c.markets++;
          countMap.set(m.event_id, c);
        }
        if (mkts.length < PAGE) break;
        offset += PAGE;
      }
    }
  }

  const events = (data || []).map((e: any) => ({
    ...e,
    sport_name: e.sports?.name,
    league_name: e.leagues?.name,
    market_count: countMap.get(e.id)?.markets || 0,
  }));

  // Sort by market count descending — most important matches first
  events.sort((a: any, b: any) => b.market_count - a.market_count);

  return NextResponse.json({ events });
}

// ─── Event detail with all markets + outcomes ───

async function getEventDetail(supabase: any, sp: URLSearchParams) {
  const eventId = sp.get("event_id");
  if (!eventId) return NextResponse.json({ error: "event_id required" }, { status: 400 });

  // Fetch event
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("*, sports(name), leagues(name)")
    .eq("id", eventId)
    .limit(1)
    .single();

  if (evErr) throw evErr;

  // Fetch markets (paginated)
  const markets: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data: page, error: mErr } = await supabase
      .from("markets")
      .select("id, event_id, market_type, name, line, is_active")
      .eq("event_id", eventId)
      .eq("is_active", true)
      .order("name")
      .range(offset, offset + PAGE - 1);

    if (mErr) throw mErr;
    if (!page || page.length === 0) break;
    markets.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  // Fetch outcomes for all markets (paginated, batched by market IDs)
  const marketIds = markets.map((m: any) => m.id);
  const outcomeMap = new Map<string, any[]>();

  for (let i = 0; i < marketIds.length; i += 200) {
    const batchIds = marketIds.slice(i, i + 200);
    let oOffset = 0;
    while (true) {
      const { data: outcomes, error: oErr } = await supabase
        .from("outcomes")
        .select("id, market_id, name, odds, previous_odds, is_active")
        .in("market_id", batchIds)
        .eq("is_active", true)
        .range(oOffset, oOffset + PAGE - 1);

      if (oErr) throw oErr;
      if (!outcomes || outcomes.length === 0) break;
      for (const o of outcomes) {
        const arr = outcomeMap.get(o.market_id) || [];
        arr.push(o);
        outcomeMap.set(o.market_id, arr);
      }
      if (outcomes.length < PAGE) break;
      oOffset += PAGE;
    }
  }

  // Merge
  const marketsWithOutcomes = markets.map((m: any) => ({
    ...m,
    outcomes: outcomeMap.get(m.id) || [],
  }));

  return NextResponse.json({
    event: {
      ...event,
      sport_name: event.sports?.name,
      league_name: event.leagues?.name,
    },
    markets: marketsWithOutcomes,
    market_count: markets.length,
    outcome_count: Array.from(outcomeMap.values()).reduce((s, arr) => s + arr.length, 0),
  });
}

// ─── Match suggestions: fuzzy match across sources ───

async function getMatchSuggestions(supabase: any, sp: URLSearchParams) {
  const eventId = sp.get("event_id");
  if (!eventId) return NextResponse.json({ error: "event_id required" }, { status: 400 });

  // Fetch the source event
  const { data: srcEvent, error: srcErr } = await supabase
    .from("events")
    .select("id, home_team, away_team, sport_id, starts_at, source")
    .eq("id", eventId)
    .limit(1)
    .single();

  if (srcErr) throw srcErr;

  const targetSource = srcEvent.source === "goldbet" ? "kambi" : "goldbet";

  // Tokenize team names for fuzzy search
  const tokens = [
    ...(srcEvent.home_team || "").split(/\s+/),
    ...(srcEvent.away_team || "").split(/\s+/),
  ].filter((t: string) => t.length >= 3).map((t: string) => t.toLowerCase());

  // Search by sport + time window (±2h)
  const startsAt = new Date(srcEvent.starts_at);
  const from = new Date(startsAt.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const to = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: cErr } = await supabase
    .from("events")
    .select("id, external_id, home_team, away_team, starts_at, score_home, score_away, status, source, sport_id, league_id, sports(name), leagues(name)")
    .eq("source", targetSource)
    .eq("sport_id", srcEvent.sport_id)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .in("status", ["prematch", "live"])
    .limit(100);

  if (cErr) throw cErr;

  // Score candidates by token overlap
  const scored = (candidates || []).map((c: any) => {
    const cTokens = [
      ...(c.home_team || "").toLowerCase().split(/\s+/),
      ...(c.away_team || "").toLowerCase().split(/\s+/),
    ];
    const matches = tokens.filter((t: string) => cTokens.some((ct: string) => ct.includes(t) || t.includes(ct)));
    return { ...c, sport_name: c.sports?.name, league_name: c.leagues?.name, score: matches.length };
  });

  scored.sort((a: any, b: any) => b.score - a.score);

  return NextResponse.json({ suggestions: scored.slice(0, 10) });
}

// ─── Leagues with event counts per source ───

async function getLeagues(supabase: any, sp: URLSearchParams) {
  const sportId = sp.get("sport_id");
  if (!sportId) return NextResponse.json({ error: "sport_id required" }, { status: 400 });

  const status = sp.get("status");
  const leagueMap = new Map<string, { id: string; name: string; goldbet: number; kambi: number }>();
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    let query = supabase
      .from("events")
      .select("league_id, source, leagues(name)")
      .eq("sport_id", sportId)
      .range(offset, offset + PAGE - 1);

    if (status === "live") query = query.eq("status", "live");
    else if (status === "prematch") query = query.eq("status", "prematch");
    else query = query.in("status", ["prematch", "live"]);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const id = row.league_id;
      if (!id) continue;
      const name = row.leagues?.name || "Sconosciuta";
      const src = row.source as string;
      const existing = leagueMap.get(id) || { id, name, goldbet: 0, kambi: 0 };
      if (src === "kambi") existing.kambi++;
      else existing.goldbet++;
      leagueMap.set(id, existing);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const leagues = Array.from(leagueMap.values()).sort((a, b) =>
    (b.goldbet + b.kambi) - (a.goldbet + a.kambi)
  );
  return NextResponse.json({ leagues });
}
