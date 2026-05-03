// Plan D / Elimina-derive Fase 2 (S3d) — sportsbook listing path v2.
//
// Replaces the legacy listing logic that filters markets by 80+ ilike patterns
// (LISTING_MARKET_TYPES_EXACT + LISTING_MARKET_PATTERNS + extraPatterns).
// Mig 159 normalizes market_type vocabulary, so v2 fetches all listing-relevant
// markets directly without complex pattern matching.
//
// Listing-relevant = anything in v_player_markets (already Phase 1.5 filtered to score
// markets + stats/player on FS-tracked events). Frontend's categorizeMarketsToTabs
// handles the per-tab dispatch.
//
// Output: same shape as legacy listing path (events with attached markets[] each
// containing outcomes[]). Skips shade overlay + canonical enrichment (deferred S3e).

import type { SupabaseClient } from "@supabase/supabase-js";

interface Filter {
  sportSlug?: string;
  leagueSlug?: string;
  statusList: string[];
  liveOnly: boolean;
  prematchOnly: boolean;
  limit: number;
  offset: number;
}

interface ListingEventOut {
  id: string;
  external_id: string;
  source: "odds-api";
  sport_id: string;
  league_id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: string;
  score_home: number | null;
  score_away: number | null;
  is_live: boolean;
  is_featured: boolean;
  source_markets_count: number;
  live_data: Record<string, unknown>;
  flashscore_id: string | null;
  sport: { name: string; slug: string; icon?: string } | null;
  league: { name: string; slug: string; country?: string; logo_url?: string } | null;
  markets: Array<{
    id: string;
    event_id: string;
    name: string;
    slug: string;
    market_type: string;
    line: number | null;
    sort_order: number;
    is_active: boolean;
    is_suspended: boolean;
    canonical_key: null;
    canonical_line: null;
    canonical_name_it: null;
    outcomes: Array<{
      id: string;
      name: string;
      odds: number;
      previous_odds: null;
      is_active: boolean;
      is_suspended: boolean;
      manual_odds: number | null;
      manual_suspended: boolean;
    }>;
  }>;
}

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapStatus(s: string): string {
  return s === "ended" ? "finished" : s;
}

/**
 * Normalize DC outcome names from team-name format ("Home or Draw")
 * to canonical 1X/X2/12 tokens expected by frontend market column matching.
 *
 * Bet365 emits DC outcomes with team names; BetUK uses canonical codes.
 * Bookmaker priority picks Bet365 first, so we normalize here.
 *
 * DC outcomes always follow the pattern "<Half1> or <Half2>". We split on
 * " or " and classify each half as draw / home / away by token overlap.
 * Token overlap handles abbreviations: "NY Red Bulls" matches "New York
 * Red Bulls" via shared tokens {red, bulls}; "Cruzeiro" matches
 * "Cruzeiro EC MG" via shared token {cruzeiro}. We require >=1 shared
 * non-trivial token (length >= 3) to count as a match.
 *
 * Returns the original name if no DC match (other markets pass through).
 */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}
function shareTokens(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}
function isDrawHalf(s: string): boolean {
  const lower = s.toLowerCase().trim();
  return lower === "draw" || lower === "pareggio" || lower === "x";
}
/**
 * Normalize DC outcome names from team-name format ("Home or Draw")
 * to canonical 1X/X2/12 tokens expected by frontend market column matching.
 *
 * Uses token-diff: tokenize both team names, find tokens unique to each
 * side, then match outcome against unique tokens only. Handles ambiguous
 * cases like "Sydney United U20" vs "Sydney Olympic U20" (both contain
 * "Sydney" — strip it, then match "United" vs "Olympic").
 *
 * Falls back to original name if tokens overlap completely or pattern
 * doesn't match.
 */
function normalizeOutcomeName(
  marketType: string,
  outcomeName: string,
  homeTeam: string,
  awayTeam: string
): string {
  if (!marketType.startsWith("DC")) return outcomeName;

  // Already canonical
  if (outcomeName === "1X" || outcomeName === "X2" || outcomeName === "12") {
    return outcomeName;
  }

  const lower = outcomeName.toLowerCase();
  const hasDraw = lower.includes("draw") || lower.includes("pareggio");

  // Tokenize teams (split on whitespace + punctuation, drop short tokens <2 chars)
  const tokenizeLocal = (s: string): Set<string> =>
    new Set(
      (s || "")
        .toLowerCase()
        .split(/[\s\-_/.,()]+/)
        .filter((t) => t.length >= 2)
    );

  const homeTokens = tokenizeLocal(homeTeam);
  const awayTokens = tokenizeLocal(awayTeam);

  // Tokens unique to each side (set difference)
  const homeUnique = new Set([...homeTokens].filter((t) => !awayTokens.has(t)));
  const awayUnique = new Set([...awayTokens].filter((t) => !homeTokens.has(t)));

  // If one side has no unique tokens, fall back to substring match (best-effort)
  const matchHome =
    homeUnique.size > 0
      ? [...homeUnique].some((t) => lower.includes(t))
      : (homeTeam || "").length > 0 && lower.includes(homeTeam.toLowerCase());
  const matchAway =
    awayUnique.size > 0
      ? [...awayUnique].some((t) => lower.includes(t))
      : (awayTeam || "").length > 0 && lower.includes(awayTeam.toLowerCase());

  if (matchHome && hasDraw && !matchAway) return "1X";
  if (hasDraw && matchAway && !matchHome) return "X2";
  if (matchHome && matchAway && !hasDraw) return "12";
  // Edge: matchHome && matchAway && hasDraw → ambiguous, fallback raw
  return outcomeName;
}

// Bug 4 perf fix (2026-05-02): whitelist to listing-essential markets only.
// Detail page (sportsbook-detail-v2.ts) fetches all markets — this whitelist
// is for tile rendering only (1X2, GG/NG, U/O, DC and their HT/2H variants).
// Other sports' main markets can be added in a follow-up.
// 2026-05-03 Sprint A.2: pushed into SQL .in() filter (was JS post-fetch).
const LISTING_MARKET_WHITELIST = [
  // Football core (existing)
  "ML", "ML HT", "ML 2H",
  "Double Chance",
  "Both Teams To Score", "Both Teams To Score HT", "Both Teams To Score 2H",
  "Goals Over/Under", "Goals Over/Under HT", "Goals Over/Under 2H",
  "Half Time / Full Time",
  "Draw No Bet",
  // Sport A.3 additions: non-football mains
  "Totals", "Totals HT", "Totals 1Q", "Totals 2H",
  "Spread", "Spread HT",
  "Spread (Games)", "Totals (Games)",
  "3-Way Result", "3-Way",
  "ML 1st Set",
  "Game Lines 3-Way",
];

export async function loadSportsbookListingV2(
  supabase: SupabaseClient,
  f: Filter
): Promise<ListingEventOut[]> {
  // 1. Fetch events with filters (paginated)
  const allEvents: Array<{
    id: string;
    odds_api_id: number | string;
    sport_id: string | null;
    sport_slug: string | null;
    sport_name: string | null;
    sport_icon: string | null;
    league_id: string | null;
    league_slug: string | null;
    league_name: string | null;
    league_country: string | null;
    league_logo_url: string | null;
    home_team: string;
    away_team: string;
    starts_at: string;
    status: string;
    score_home: number | null;
    score_away: number | null;
    live_data: Record<string, unknown> | null;
    is_live: boolean;
    flashscore_id: string | null;
  }> = [];

  const PAGE = 1000;
  let from = f.offset;
  while (allEvents.length < f.limit) {
    const pageSize = Math.min(PAGE, f.limit - allEvents.length);

    let query = supabase
      .from("v_player_events")
      .select(
        "id, odds_api_id, sport_id, sport_slug, sport_name, sport_icon, league_id, league_slug, league_name, league_country, league_logo_url, home_team, away_team, starts_at, status, score_home, score_away, live_data, is_live, flashscore_id"
      )
      .in("status", f.statusList);

    if (f.sportSlug) query = query.eq("sport_slug", f.sportSlug);
    if (f.leagueSlug) query = query.eq("league_slug", f.leagueSlug);

    if (f.liveOnly) {
      query = query.eq("is_live", true);
    } else {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      query = query.or(`is_live.eq.true,starts_at.gte.${cutoff}`);
    }
    if (f.prematchOnly) {
      const prematchCutoff = new Date(Date.now() - 30 * 1000).toISOString();
      query = query.eq("is_live", false).gt("starts_at", prematchCutoff);
    }

    const { data: page, error: pageErr } = await query
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (pageErr) throw new Error(`v_player_events: ${pageErr.message}`);
    if (!page || page.length === 0) break;
    allEvents.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  if (allEvents.length === 0) return [];

  const eventIds = allEvents.map((e) => e.id);

  // 2. Fetch markets for these events (chunked).
  // Mig 159 vocabulary is canonical; whitelist pushed into SQL .in() filter
  // (Sprint A.2 perf fix — was JS-side post-fetch, scanning ~290 markets/event).
  type MRow = {
    id: string; event_id: string; bookmaker: string; source_market_name: string;
    market_type: string; line: number | null; category: string; is_suspended: boolean;
  };
  const allMarkets: MRow[] = [];
  const CHUNK = 80;
  for (let i = 0; i < eventIds.length; i += CHUNK) {
    const slice = eventIds.slice(i, i + CHUNK);
    // Paginate market results to handle PostgREST 1000-row cap
    let mOff = 0;
    const M_PAGE = 1000;
    while (true) {
      const { data } = await supabase
        .from("v_player_markets")
        .select("id, event_id, bookmaker, source_market_name, market_type, line, category, is_suspended")
        .in("event_id", slice)
        .in("source_market_name", LISTING_MARKET_WHITELIST)  // pushdown — Plan D 2026-05-03 perf fix
        .range(mOff, mOff + M_PAGE - 1);
      if (!data || data.length === 0) break;
      allMarkets.push(...(data as MRow[]));
      if (data.length < M_PAGE) break;
      mOff += M_PAGE;
    }
  }

  const marketIds = allMarkets.map((m) => m.id);

  // 3. Fetch outcomes (chunked)
  type ORow = {
    id: string; market_id: string; line: number | null; name: string; odds: number | string;
    is_active: boolean; is_suspended: boolean;
    manual_odds: number | string | null; manual_suspended: boolean;
  };
  const allOutcomes: ORow[] = [];
  for (let i = 0; i < marketIds.length; i += 200) {
    const slice = marketIds.slice(i, i + 200);
    const { data } = await supabase
      .from("v_player_outcomes")
      .select("id, market_id, line, name, odds, is_active, is_suspended, manual_odds, manual_suspended")
      .in("market_id", slice);
    if (data) allOutcomes.push(...(data as ORow[]));
  }
  const outcomesByMarketLine = new Map<string, ORow[]>();
  for (const o of allOutcomes) {
    // Plan D / 2026-05-02 fix: group by (market_id, line) to prevent
    // cross-contamination across line variants of same markets_v2 row
    // (e.g. Goals Over/Under 1.5 vs 2.5 vs 3.5 share market_id).
    const key = `${o.market_id}@${o.line ?? ''}`;
    const list = outcomesByMarketLine.get(key) ?? [];
    list.push(o);
    outcomesByMarketLine.set(key, list);
  }

  const marketsByEvent = new Map<string, MRow[]>();
  for (const m of allMarkets) {
    const list = marketsByEvent.get(m.event_id) ?? [];
    list.push(m);
    marketsByEvent.set(m.event_id, list);
  }

  // 4. Stitch
  return allEvents.map((ev) => {
    const evMarkets = marketsByEvent.get(ev.id) ?? [];
    return {
      id: ev.id,
      external_id: `odds-api:${ev.odds_api_id}`,
      source: "odds-api" as const,
      sport_id: ev.sport_id ?? "",
      league_id: ev.league_id ?? "",
      home_team: ev.home_team,
      away_team: ev.away_team,
      starts_at: ev.starts_at,
      status: mapStatus(ev.status),
      score_home: ev.score_home,
      score_away: ev.score_away,
      is_live: ev.is_live,
      is_featured: false,
      source_markets_count: evMarkets.length,
      live_data: (ev.live_data ?? {}) as Record<string, unknown>,
      flashscore_id: ev.flashscore_id,
      sport: ev.sport_slug
        ? { name: ev.sport_name ?? "", slug: ev.sport_slug, icon: ev.sport_icon ?? undefined }
        : null,
      league: ev.league_slug
        ? {
            name: ev.league_name ?? "",
            slug: ev.league_slug,
            country: ev.league_country ?? undefined,
            logo_url: ev.league_logo_url ?? undefined,
          }
        : null,
      markets: evMarkets.map((m, idx) => ({
        id: m.id,
        event_id: m.event_id,
        name: m.line != null ? `${m.market_type} ${m.line}` : m.market_type,
        slug: m.market_type.toLowerCase().replace(/[^\w]+/g, "-"),
        market_type: m.market_type,
        line: m.line,
        sort_order: idx,
        is_active: true,
        is_suspended: m.is_suspended,
        canonical_key: null,
        canonical_line: null,
        canonical_name_it: null,
        outcomes: (outcomesByMarketLine.get(`${m.id}@${m.line ?? ''}`) ?? []).map((o) => ({
          id: o.id,
          name: normalizeOutcomeName(m.market_type, o.name, ev.home_team, ev.away_team),
          odds: toNum(o.odds),
          previous_odds: null,
          is_active: o.is_active,
          is_suspended: o.is_suspended,
          manual_odds: o.manual_odds == null ? null : toNum(o.manual_odds),
          manual_suspended: o.manual_suspended,
        })),
      })),
    };
  });
}
