import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getShadeEnabled, resolveShadeOdds, applyShadeToOutcome } from "@/lib/shade";
import { loadSportsbookDetailV2 } from "@/lib/queries/sportsbook-detail-v2";
import { loadSportsbookListingV2 } from "@/lib/queries/sportsbook-listing-v2";
import { cacheGet, cacheSet } from "@/lib/redis-cache";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Plan D / Elimina-derive Fase 2 — server-side flag.
// When true, detail-mode requests use v_player_* views (S3c).
// Listing path (detail=false) still uses legacy v_events_unified — refactor in S3d.
function isReadFromV2() {
  return process.env.READ_FROM_V2 === "true";
}

// Exact market types for listing (football + some others).
// Includes Kambi naming + common 22bet naming (short forms with " - 1T" / " - 2T").
const LISTING_MARKET_TYPES_EXACT = [
  "1X2", "DC", "1 2",
  // Multi-sport
  "Vincente Incontro",       // tennis, basket, table tennis, baseball
  "Tempo Regolamentare",     // handball 1X2
  "Supplementari Inclusi",   // hockey T/T
  "Esito finale 1x2",       // darts T/T
  "Testa a Testa",           // snooker T/T
  "Più giochi",              // tennis more games
  "Risultato Esatto",        // tennis/TT exact score
  "1° Periodo",              // hockey 1st period
  "2° Periodo",              // hockey 2nd period
  "3° Periodo",              // hockey 3rd period
  // ─── 22bet half-specific short forms ───
  "1X2 - 1T",                // canonical 1x2_1h
  "1X2 - 2T",                // canonical 1x2_2h
  "DC - 1T",                 // canonical dc_1h
  "DC - 2T",                 // canonical dc_2h
  "GG/NG - 1T",              // canonical gg_ng_1h
  "GG/NG - 2T",              // canonical gg_ng_2h
  "Pari/Dispari - 1T",       // canonical oe_1h
];

// Pattern filters (ilike) for variable market types
// Patterns WITHOUT slashes — safe for PostgREST .or() filter
const LISTING_MARKET_PATTERNS = [
  "Esito Finale 1x2%",                          // hockey/cricket 1X2
  "Esito dell'incontro%",                        // boxing/mma T/T
  "Esito finale%",                               // darts/other T/T
  "Doppia Chance - Tempo%",                      // hockey DC
  "Gol totali - Tempo Regolamentare%",           // hockey U/O
  "Entrambe le squadre segnano - Tempo%",        // hockey GG/NG
  "Risultato al termine%",                       // basket 1X2
  "Totale giochi%",                              // tennis U/O games
  "Totale set%",                                 // tennis U/O sets
  "Leg totali%",                                 // darts U/O legs
  "Run totali %",                                // baseball total runs
  "Mappe totali%",                               // esports total maps
  "Mappa %",                                     // esports map winner
  "Match Odds",                                  // esports/cricket match odds
  "Handicap Mappa%",                             // esports map handicap
  "Tempo regolamentare%",                        // rugby 1X2
  "Totale punti -%",                             // rugby U/O points
  "Primo tempo (1X2)",                           // rugby 1st half
  "Prossimo Gol%",                               // football next goal
  "Più giochi",                                  // tennis more games
  "Risultato Esatto",                            // tennis/TT exact score
  "Frame totali%",                               // snooker U/O frames
  "Frame Handicap%",                             // snooker frame handicap
  "Totali 180%",                                 // darts total 180s
  "Totale punti - Supplementari%",               // rugby U/O points
  "Totale gol - Supplementari%",                 // hockey U/O goals incl. OT
  "Tempo regolamentare (1X2)",                   // rugby 1X2
  "Vincente",                                    // golf outright winner
  "Doppia Chance%",                              // all DC variants
];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const sportSlug = params.get("sport") || undefined;
  const leagueSlug = params.get("league") || undefined;
  const statusParam = params.get("status") || "prematch,live";
  const liveOnly = params.get("liveOnly") === "true";
  const limitParam = parseInt(params.get("limit") || "50", 10);
  const offsetParam = parseInt(params.get("offset") || "0", 10);
  const detail = params.get("detail") === "true"; // full markets for single event

  const statusList = statusParam.split(",").filter(Boolean);

  // V2 path branch (Plan D Fase 2 / S3c+S3d).
  // Skips canonical enrichment + shade overlay — those still apply only on legacy paths.
  if (isReadFromV2()) {
    try {
      const prematchOnly =
        !liveOnly && statusList.length === 1 && statusList[0] === "prematch";
      const filter = {
        sportSlug,
        leagueSlug,
        statusList,
        liveOnly,
        prematchOnly,
        limit: limitParam,
        offset: offsetParam,
      };
      // Bug 4 perf fix (2026-05-02): 30s Redis cache for listing payloads.
      // Detail bypasses cache (per-event hot path with bet flow).
      const cacheKey = !detail
        ? `sb:listing:v2:${sportSlug || ""}:${leagueSlug || ""}:${statusList.join(",")}:${liveOnly ? 1 : 0}:${prematchOnly ? 1 : 0}:${limitParam}:${offsetParam}`
        : null;
      if (cacheKey) {
        const cached = await cacheGet<unknown>(cacheKey);
        if (cached !== null) {
          return NextResponse.json(cached);
        }
      }
      const events = detail
        ? await loadSportsbookDetailV2(supabase, filter)
        : await loadSportsbookListingV2(supabase, filter);
      const payload =
        offsetParam > 0 || limitParam <= 200
          ? { events, hasMore: events.length === limitParam }
          : events;
      if (cacheKey) {
        // fire-and-forget; don't block response on cache write
        void cacheSet(cacheKey, payload, 30);
      }
      return NextResponse.json(payload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  try {
    let sportId: string | null = null;
    if (sportSlug) {
      const { data: sportRow } = await supabase
        .from("sports")
        .select("id")
        .eq("slug", sportSlug)
        .maybeSingle();
      sportId = sportRow?.id ?? null;
      if (!sportId) {
        return NextResponse.json([]);
      }
    }

    let leagueId: string | null = null;
    if (leagueSlug) {
      const { data: leagueRow } = await supabase
        .from("leagues")
        .select("id")
        .eq("slug", leagueSlug)
        .maybeSingle();
      leagueId = leagueRow?.id ?? null;
    }

    // For listing: load events WITHOUT nested markets (fast query)
    // For detail: load single event WITH all markets
    const selectFields = detail
      ? `*, sport:sports(name, slug, icon), league:leagues(name, slug, country, logo_url),
         markets(id, name, slug, market_type, line, sort_order, is_active, is_suspended,
           outcomes(id, name, odds, previous_odds, is_active, is_suspended, manual_odds, manual_suspended))`
      : `id, external_id, source, sport_id, league_id, home_team, away_team, starts_at, status,
         score_home, score_away, minute, period, is_live, is_featured, source_markets_count, live_data,
         sport:sports(name, slug, icon),
         league:leagues(name, slug, country, logo_url)`;

    // v_events_unified: Kambi primary + 22bet fallback via flashscore_id dedup
    // (DB view, migration 105). No explicit source filter needed.
    let query = supabase
      .from("v_events_unified")
      .select(selectFields)
      .in("status", statusList);

    if (liveOnly) {
      query = query.eq("is_live", true);
    } else {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      query = query.or(`is_live.eq.true,starts_at.gte.${cutoff}`);
    }

    // Prematch-only requests: drop events whose start time has passed
    // (scraper may not yet have flipped status='live' — stale prices).
    // 30s grace so we don't hide events exactly at kickoff.
    const prematchOnly =
      !liveOnly &&
      statusList.length === 1 &&
      statusList[0] === "prematch";
    if (prematchOnly) {
      const prematchCutoff = new Date(Date.now() - 30 * 1000).toISOString();
      query = query.eq("is_live", false).gt("starts_at", prematchCutoff);
    }

    if (sportId) query = query.eq("sport_id", sportId);
    if (leagueId) query = query.eq("league_id", leagueId);

    // Paginate to avoid PostgREST 1000-row default cap
    const allEvents: any[] = [];
    const PAGE = 1000;
    let from = offsetParam;
    while (allEvents.length < limitParam) {
      const pageSize = Math.min(PAGE, limitParam - allEvents.length);
      const { data: page, error: pageErr } = await query
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (pageErr) {
        return NextResponse.json({ error: pageErr.message }, { status: 500 });
      }
      if (!page || page.length === 0) break;
      allEvents.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
    const events = allEvents;

    if (events.length === 0) {
      return NextResponse.json([]);
    }

    // For listing mode: batch-fetch main market odds for display columns
    if (!detail) {
      const eventIds = events.map((e: any) => e.id);

      // Fetch markets in chunks to avoid PostgREST URL length limits
      // Smaller chunks to stay under PostgREST 1000-row default limit
      const CHUNK_SIZE = 80;
      const marketsByEvent = new Map<string, any[]>();

      // Build OR filter: exact matches + ilike patterns
      const exactIn = `market_type.in.(${LISTING_MARKET_TYPES_EXACT.join(",")})`;
      const patternFilters = LISTING_MARKET_PATTERNS.map(p => `market_type.ilike.${p}`);
      const marketTypeFilter = [exactIn, ...patternFilters].join(",");

      for (let i = 0; i < eventIds.length; i += CHUNK_SIZE) {
        const chunk = eventIds.slice(i, i + CHUNK_SIZE);
        // Paginate market results to handle PostgREST 1000-row cap
        let marketOffset = 0;
        const MARKET_PAGE = 1000;
        while (true) {
          const { data: markets } = await supabase
            .from("markets")
            .select("id, event_id, market_type, name, line, is_active, is_suspended, outcomes(id, name, odds, previous_odds, is_active, is_suspended, manual_odds, manual_suspended)")
            .in("event_id", chunk)
            .or(marketTypeFilter)
            .eq("is_active", true)
            .eq("is_suspended", false)
            .range(marketOffset, marketOffset + MARKET_PAGE - 1);

          if (!markets || markets.length === 0) break;

          for (const m of markets) {
            const list = marketsByEvent.get(m.event_id) ?? [];
            list.push(m);
            marketsByEvent.set(m.event_id, list);
          }

          if (markets.length < MARKET_PAGE) break;
          marketOffset += MARKET_PAGE;
        }
      }

      // Separate fetches for markets with / in name (breaks PostgREST .or() URL)
      // and to ensure ALL lines are fetched (not truncated by 1000-row cap)
      // Patterns with / or special chars — fetched separately (/ breaks PostgREST .or() URL)
      const extraPatterns = [
        "T/T Handicap%", "T/T",                       // testa a testa
        "GG/NG%",                                      // goal/no goal + variants
        "U/O %", "U/O 1T%", "U/O Incl%",              // under/over all variants (Kambi)
        "U/O % - 1T", "U/O % - 2T",                    // 22bet half-specific U/O (e.g. "U/O 2.5 - 1T")
        "P/D",                                         // pari/dispari
        "Handicap (%", "Handicap (-%", "Handicap (+%", // baseball/aussie handicap
        "Handicap - Tempo regolamentare%",             // hockey handicap
        "1X2 H (%",                                    // 22bet handicap (e.g. "1X2 H (-1)", "1X2 H (0)", "1X2 H (-1.5)")
        "Round totali%",                               // mma/boxing rounds
        "Miglior punteggio%", "Miglior Punteggio%",   // golf h2h
        "2° tempo (1X2)",                              // rugby 2nd half
      ];
      for (const pattern of extraPatterns) {
        for (let i = 0; i < eventIds.length; i += CHUNK_SIZE) {
          const chunk = eventIds.slice(i, i + CHUNK_SIZE);
          const { data: extraMarkets } = await supabase
            .from("markets")
            .select("id, event_id, market_type, name, line, is_active, is_suspended, outcomes(id, name, odds, previous_odds, is_active, is_suspended, manual_odds, manual_suspended)")
            .in("event_id", chunk)
            .like("market_type", pattern)
            .eq("is_active", true)
            .eq("is_suspended", false);

          for (const m of extraMarkets ?? []) {
            // Dedup: skip if already fetched
            const list = marketsByEvent.get(m.event_id) ?? [];
            if (!list.some(existing => existing.id === m.id)) {
              list.push(m);
              marketsByEvent.set(m.event_id, list);
            }
          }
        }
      }

      // Canonical enrichment: attach canonical_key / canonical_line /
      // canonical_name_it from market_normalization (+ canonical_markets)
      // to each market. Enables frontend cross-source column dispatch
      // (Kambi "1X2 1° Tempo" and 22bet "1X2 - 1T" both become 1x2_1h).
      const eventSourceMap = new Map<string, string>();
      for (const e of events) eventSourceMap.set(e.id, (e as any).source || "kambi");

      const normKeys = new Set<string>();
      const marketTypesBySource = new Map<string, Set<string>>();
      for (const [eventId, list] of marketsByEvent) {
        const source = eventSourceMap.get(eventId) || "kambi";
        let setFor = marketTypesBySource.get(source);
        if (!setFor) { setFor = new Set(); marketTypesBySource.set(source, setFor); }
        for (const m of list) {
          setFor.add(m.market_type);
          normKeys.add(`${source}|${m.market_type}`);
        }
      }

      const canonicalMap = new Map<string, { canonical_key: string | null; canonical_line: number | null; canonical_name_it: string | null }>();
      for (const [source, mtSet] of marketTypesBySource) {
        const mts = Array.from(mtSet);
        if (mts.length === 0) continue;
        // Chunk in case the IN list is long (PostgREST URL limit ~8KB).
        const CHUNK = 200;
        for (let i = 0; i < mts.length; i += CHUNK) {
          const slice = mts.slice(i, i + CHUNK);
          const { data: mnRows } = await supabase
            .from("market_normalization")
            .select("source_market_type, canonical_key, canonical_line, canonical_name_it, verified, confidence")
            .eq("source", source)
            .in("source_market_type", slice)
            .not("canonical_key", "is", null);
          for (const row of mnRows ?? []) {
            const trusted = row.verified === true || (typeof row.confidence === "number" && row.confidence >= 90);
            if (!trusted) continue;
            canonicalMap.set(`${source}|${row.source_market_type}`, {
              canonical_key: row.canonical_key,
              canonical_line: row.canonical_line ?? null,
              canonical_name_it: row.canonical_name_it ?? null,
            });
          }
        }
      }

      for (const [eventId, list] of marketsByEvent) {
        const source = eventSourceMap.get(eventId) || "kambi";
        for (const m of list) {
          const lookup = canonicalMap.get(`${source}|${m.market_type}`);
          if (lookup) {
            m.canonical_key = lookup.canonical_key;
            m.canonical_line = lookup.canonical_line;
            m.canonical_name_it = lookup.canonical_name_it;
          } else {
            m.canonical_key = null;
            m.canonical_line = null;
            m.canonical_name_it = null;
          }
        }
      }

      // Shade-to-min overlay: replace raw odds with v_outcomes_displayed.displayed_odds
      // when shade_enabled=true (flag in system_config, 30s cache).
      // Always propagates manual_odds/manual_suspended regardless of flag.
      const shadeEnabled = await getShadeEnabled(supabase);
      const allOutcomeIds: string[] = [];
      for (const list of marketsByEvent.values()) {
        for (const m of list) {
          for (const o of m.outcomes ?? []) allOutcomeIds.push(o.id);
        }
      }
      const shadeMap = await resolveShadeOdds(supabase, allOutcomeIds, shadeEnabled);
      for (const list of marketsByEvent.values()) {
        for (const m of list) {
          for (const o of m.outcomes ?? []) applyShadeToOutcome(o, shadeMap);
        }
      }

      // Attach markets to events
      const enriched = events.map((e: any) => ({
        ...e,
        markets: marketsByEvent.get(e.id) ?? [],
      }));

      // If caller sent offset, return paginated response
      if (offsetParam > 0 || limitParam <= 200) {
        return NextResponse.json({ events: enriched, hasMore: events.length === limitParam });
      }
      return NextResponse.json(enriched);
    }

    // Detail path: canonical enrichment on nested markets.
    // Same logic as listing path — join (source, source_market_type)
    // against market_normalization and attach canonical_* fields.
    for (const e of events) {
      const source = (e as any).source || "kambi";
      const markets = ((e as any).markets ?? []) as Array<{ market_type: string } & Record<string, unknown>>;
      if (markets.length === 0) continue;
      const mts = Array.from(new Set(markets.map((m) => m.market_type)));
      const CHUNK = 200;
      const mnLookup = new Map<string, { canonical_key: string | null; canonical_line: number | null; canonical_name_it: string | null }>();
      for (let i = 0; i < mts.length; i += CHUNK) {
        const slice = mts.slice(i, i + CHUNK);
        const { data: mnRows } = await supabase
          .from("market_normalization")
          .select("source_market_type, canonical_key, canonical_line, canonical_name_it, verified, confidence")
          .eq("source", source)
          .in("source_market_type", slice)
          .not("canonical_key", "is", null);
        for (const row of mnRows ?? []) {
          const trusted = row.verified === true || (typeof row.confidence === "number" && row.confidence >= 90);
          if (!trusted) continue;
          mnLookup.set(row.source_market_type, {
            canonical_key: row.canonical_key,
            canonical_line: row.canonical_line ?? null,
            canonical_name_it: row.canonical_name_it ?? null,
          });
        }
      }
      for (const m of markets) {
        const lookup = mnLookup.get(m.market_type);
        m.canonical_key = lookup?.canonical_key ?? null;
        m.canonical_line = lookup?.canonical_line ?? null;
        m.canonical_name_it = lookup?.canonical_name_it ?? null;
      }
    }

    // Detail path: shade overlay on nested markets.outcomes
    const shadeEnabled = await getShadeEnabled(supabase);
    const allOutcomeIds: string[] = [];
    for (const e of events) {
      for (const m of (e as any).markets ?? []) {
        for (const o of m.outcomes ?? []) allOutcomeIds.push(o.id);
      }
    }
    const shadeMap = await resolveShadeOdds(supabase, allOutcomeIds, shadeEnabled);
    for (const e of events) {
      for (const m of (e as any).markets ?? []) {
        for (const o of m.outcomes ?? []) applyShadeToOutcome(o, shadeMap);
      }
    }

    if (offsetParam > 0 || limitParam <= 200) {
      return NextResponse.json({ events, hasMore: events.length === limitParam });
    }
    return NextResponse.json(events);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
