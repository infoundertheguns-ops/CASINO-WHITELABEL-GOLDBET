// Plan D / Elimina-derive Fase 2 — read player event detail from v_player_* views (v2 path).
//
// Used when env NEXT_PUBLIC_READ_FROM_V2=true. Returns a DbEvent shape compatible with the
// existing mapDbToKioskEvent mapper, so consumer pages don't need to change downstream logic.
//
// Three queries (event + markets + outcomes) instead of one nested query because views don't
// support PostgREST FK navigation. Total cost on prod single-event ≈ 40-80ms (was 37ms in
// EXPLAIN ANALYZE; client RTTs add latency).
//
// Skips canonical enrichment (mig 159 oddsapi_translations already provides Italian market_type)
// and shade overlay (v2 outcome IDs differ from legacy outcomes; shade adaptation deferred to
// S3c+ during sportsbook listing refactor).

import { createClient } from "@/lib/supabase/client";
import type { DbEvent, DbMarket, DbOutcome } from "@/lib/types/db";

interface V2EventRow {
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
  home_id: number | null;
  away_id: number | null;
  starts_at: string;
  status: "prematch" | "live" | "ended" | "cancelled" | "postponed" | string;
  score_home: number | null;
  score_away: number | null;
  live_data: Record<string, unknown> | null;
  is_live: boolean;
  flashscore_id: string | null;
}

interface V2MarketRow {
  id: string;
  event_id: string;
  bookmaker: string;
  source_market_name: string;
  market_type: string;
  line: number | null;
  category: string;
  is_suspended: boolean;
  sport_slug: string;
  flashscore_id: string | null;
}

interface V2OutcomeRow {
  id: string;
  market_id: string;
  source_outcome_key: string;
  name: string;
  odds: number | string;
  raw_odds: number | string;
  line: number | null;
  is_active: boolean;
  is_suspended: boolean;
  manual_odds: number | string | null;
  manual_suspended: boolean;
}

function toNum(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Status from view: "prematch"|"live"|"ended"|"cancelled"|"postponed"
// Legacy DbEvent.status: "prematch"|"live"|"finished"|"cancelled"|"postponed"
function mapStatusV2ToLegacy(s: string): DbEvent["status"] {
  if (s === "ended") return "finished";
  if (s === "prematch" || s === "live" || s === "cancelled" || s === "postponed") return s;
  return "prematch";
}

export async function loadPlayerEventV2(eventId: string): Promise<DbEvent | null> {
  const supabase = createClient();

  // 1. Event (single row)
  const { data: evRaw, error: evErr } = await supabase
    .from("v_player_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle<V2EventRow>();

  if (evErr || !evRaw) return null;

  // 2. Markets for this event
  const { data: marketsRaw } = await supabase
    .from("v_player_markets")
    .select("id, event_id, bookmaker, source_market_name, market_type, line, category, is_suspended, sport_slug, flashscore_id")
    .eq("event_id", eventId)
    .returns<V2MarketRow[]>();

  const marketIds = (marketsRaw ?? []).map((m) => m.id);

  // 3. Outcomes for those markets
  let outcomesRaw: V2OutcomeRow[] = [];
  if (marketIds.length > 0) {
    // Chunk by market_id (PostgREST URL limit ~8KB, UUIDs 36 chars → ~200 fit) AND
    // paginate within each chunk to bypass Supabase's 1000-row default response cap.
    // For events with many U/O variants (30+ outcomes × multiple bookmakers), a single
    // chunk can easily exceed 1000 outcomes, leaving later markets empty.
    const CHUNK = 200;
    const PAGE = 1000;
    for (let i = 0; i < marketIds.length; i += CHUNK) {
      const slice = marketIds.slice(i, i + CHUNK);
      let from = 0;
      // safety: cap at 50 pages per chunk = 50k outcomes, well above realistic ceilings
      for (let p = 0; p < 50; p++) {
        const { data } = await supabase
          .from("v_player_outcomes")
          .select("id, market_id, source_outcome_key, name, odds, raw_odds, line, is_active, is_suspended, manual_odds, manual_suspended")
          .in("market_id", slice)
          .range(from, from + PAGE - 1)
          .returns<V2OutcomeRow[]>();
        if (!data || data.length === 0) break;
        outcomesRaw.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }
  }

  // 4. Group outcomes by market_id
  const outcomesByMarket = new Map<string, V2OutcomeRow[]>();
  for (const o of outcomesRaw) {
    const list = outcomesByMarket.get(o.market_id) ?? [];
    list.push(o);
    outcomesByMarket.set(o.market_id, list);
  }

  // 5. Stitch markets → DbMarket[]
  // v_player_markets exposes one row per (market_id, line). For LINE-KEYED markets (U/O,
  // Handicap, etc.) we must filter outcomes by m.line so each row only carries its own
  // outcomes. For NON-LINE markets (1X2, DC, GG/NG, BTTS, etc.) the o.line column is junk
  // (sometimes set to 1/2/null arbitrarily); we must NOT filter, otherwise valid outcomes
  // disappear. We also dedupe by outcome.id (view can emit duplicates from multi-source).
  const NON_LINE_MARKET_TYPES = new Set<string>([
    "1X2", "1X2 - 1T", "1X2 - 2T",
    "DNB", "DNB - 1T", "DNB - 2T",
    "DC", "DC - 1T", "DC - 2T", "Double Chance",
    "GG/NG", "GG/NG - 1T", "GG/NG - 2T",
    "Both Teams To Score", "Both Teams To Score HT",
    "HT/FT", "1T/Finale",
    "Risultato Esatto", "Correct Score",
    "First Team To Score",
    "P/D", "Pari/Dispari", "Odd/Even",
    "Number of Goals In Match", "Exact Total Goals",
    "To Score 2+ Goals", "To Score 3+ Goals",
    "Vincente", "Vincente Incontro", "Tempo regolamentare",
  ]);
  const dbMarkets: DbMarket[] = (marketsRaw ?? []).map((m, idx) => {
    const allOutcomes = outcomesByMarket.get(m.id) ?? [];
    const isNonLine = NON_LINE_MARKET_TYPES.has(m.market_type);
    const lineFiltered = isNonLine
      ? allOutcomes
      : allOutcomes.filter(o => (o.line ?? null) === (m.line ?? null));
    // Dedupe by outcome.id (keep first occurrence — view ordering is stable per query).
    const seen = new Set<string>();
    const deduped: V2OutcomeRow[] = [];
    for (const o of lineFiltered) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      deduped.push(o);
    }
    const outs: DbOutcome[] = deduped.map((o) => ({
      id: o.id,
      market_id: o.market_id,
      name: o.name,
      odds: toNum(o.odds) ?? 0,
      previous_odds: undefined, // not tracked in v2 (Realtime push handles)
      is_active: o.is_active,
      is_suspended: o.is_suspended,
      manual_odds: toNum(o.manual_odds) ?? null,
      manual_suspended: o.manual_suspended ?? null,
      line: o.line,
    }));

    return {
      id: m.id,
      event_id: m.event_id,
      // Legacy 'name' column was a display name. Use translated market_type + line for parity.
      name: m.line != null ? `${m.market_type} ${m.line}` : m.market_type,
      slug: m.market_type.toLowerCase().replace(/[^\w]+/g, "-"),
      market_type: m.market_type,
      line: m.line ?? undefined,
      sort_order: idx, // preserve view order; v_player_markets has no explicit sort_order
      is_active: true, // view filters out inactive markets implicitly
      is_suspended: m.is_suspended,
      outcomes: outs,
      // mig 159 supersedes canonical layer; set null so mapMarket falls back to market_type
      canonical_key: null,
      canonical_line: null,
      canonical_name_it: null,
    };
  });

  const dbEvent: DbEvent = {
    id: evRaw.id,
    external_id: `odds-api:${evRaw.odds_api_id}`,
    sport_id: evRaw.sport_id ?? "",
    league_id: evRaw.league_id ?? "",
    home_team: evRaw.home_team,
    away_team: evRaw.away_team,
    starts_at: evRaw.starts_at,
    status: mapStatusV2ToLegacy(evRaw.status),
    score_home: evRaw.score_home ?? undefined,
    score_away: evRaw.score_away ?? undefined,
    minute: undefined, // events_v2 doesn't track live minute
    period: undefined,
    is_live: evRaw.is_live,
    is_featured: false,
    live_data: evRaw.live_data ?? {},
    source: "odds-api",
    source_markets_count: dbMarkets.length,
    sport: evRaw.sport_slug
      ? {
          name: evRaw.sport_name ?? "",
          slug: evRaw.sport_slug,
          icon: evRaw.sport_icon ?? undefined,
        }
      : undefined,
    league: evRaw.league_slug
      ? {
          name: evRaw.league_name ?? "",
          slug: evRaw.league_slug,
          country: evRaw.league_country ?? undefined,
          logo_url: evRaw.league_logo_url ?? undefined,
        }
      : undefined,
    markets: dedupeNonLineMarkets(dbMarkets, NON_LINE_MARKET_TYPES),
  };

  return dbEvent;
}

// For non-line market types, collapse multiple DbMarket rows with the same market_id
// into one (v_player_markets exposes per-line rows even for line-less markets, producing
// logical duplicates). For line-keyed types, leave entries alone.
function dedupeNonLineMarkets(markets: DbMarket[], nonLineSet: Set<string>): DbMarket[] {
  const seenIds = new Map<string, DbMarket>();
  const out: DbMarket[] = [];
  for (const m of markets) {
    if (!nonLineSet.has(m.market_type)) {
      out.push(m);
      continue;
    }
    const existing = seenIds.get(m.id);
    if (!existing) {
      seenIds.set(m.id, m);
      out.push(m);
    } else if ((m.outcomes?.length ?? 0) > (existing.outcomes?.length ?? 0)) {
      // Replace existing with richer variant (in-place to preserve order)
      const idx = out.indexOf(existing);
      if (idx >= 0) out[idx] = m;
      seenIds.set(m.id, m);
    }
  }
  return out;
}

// Convenience: read flag value (works in client components — must be NEXT_PUBLIC_*)
export function isReadFromV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_READ_FROM_V2 === "true";
}
