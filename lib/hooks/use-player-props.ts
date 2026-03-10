"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  parsePlayerPrefix,
  groupEventsByMatch,
  buildTeamNameMap,
  type PlayerEventRow,
  type MatchGroup,
  type TeamNameMap,
  type RegularEventRef,
} from "@/lib/utils/player-props";
import {
  sortSelections,
  type Market,
  type Selection,
} from "@/lib/hooks/use-sportsbook";

export type PlayerSportFilter = "tutti" | "calcio" | "basket";

export interface UsePlayerPropsReturn {
  groups: MatchGroup[];
  loading: boolean;
  error: string | null;
  activeSport: PlayerSportFilter;
  setActiveSport: (s: PlayerSportFilter) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  expandedMatch: string | null;
  setExpandedMatch: (key: string | null) => void;
  expandedPlayer: string | null;
  setExpandedPlayer: (id: string | null) => void;
  getPlayerMarkets: (eventId: string) => Market[] | null;
  loadPlayerMarkets: (eventId: string) => Promise<void>;
  loadingMarkets: Set<string>;
  counts: { calcio: number; basket: number; total: number };
}

export function usePlayerProps(): UsePlayerPropsReturn {
  const supabase = createClient();
  const [allEvents, setAllEvents] = useState<PlayerEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSport, setActiveSport] = useState<PlayerSportFilter>("tutti");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState<Set<string>>(new Set());
  const [teamNameMap, setTeamNameMap] = useState<TeamNameMap>(new Map());
  const marketCache = useRef<Map<string, Market[]>>(new Map());

  // Phase 1: fetch all Giocatori events (metadata only, no markets)
  useEffect(() => {
    let cancelled = false;

    async function fetchPlayerEvents() {
      setLoading(true);
      setError(null);

      try {
        const { data, error: err } = await supabase
          .from("events")
          .select(`
            id,
            home_team,
            away_team,
            starts_at,
            status,
            leagues!inner(name, slug),
            sports!inner(name, slug, icon)
          `)
          .like("sports.slug", "giocatori-%")
          .in("status", ["prematch", "live"])
          .order("starts_at", { ascending: true });

        if (cancelled) return;
        if (err) throw err;

        const rows: PlayerEventRow[] = [];
        for (const row of (data || []) as any[]) {
          const parsed = parsePlayerPrefix(row.home_team);
          if (!parsed) continue;

          rows.push({
            id: row.id,
            home_team: row.home_team,
            away_team: row.away_team,
            starts_at: row.starts_at,
            status: row.status,
            league_name: row.leagues?.name || "",
            league_slug: row.leagues?.slug || "",
            sport_name: row.sports?.name || "",
            sport_slug: row.sports?.slug || "",
            sport_icon: row.sports?.icon || "⚽",
            parsed,
          });
        }

        setAllEvents(rows);

        // Cross-reference: fetch regular events to resolve team abbreviations
        if (rows.length > 0) {
          const uniqueTimes = [...new Set(rows.map((r) => r.starts_at))];
          const { data: regData } = await supabase
            .from("events")
            .select("home_team, away_team, starts_at")
            .in("starts_at", uniqueTimes)
            .not("external_id", "like", "giocatori:%")
            .in("status", ["prematch", "live"]);

          if (!cancelled && regData) {
            const tnMap = buildTeamNameMap(rows, regData as RegularEventRef[]);
            setTeamNameMap(tnMap);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("[usePlayerProps] fetch error:", err.message);
          setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPlayerEvents();
    return () => { cancelled = true; };
  }, []);

  // Counts
  const counts = {
    calcio: allEvents.filter((e) => e.sport_slug === "giocatori-calcio").length,
    basket: allEvents.filter((e) => e.sport_slug === "giocatori-basket").length,
    total: allEvents.length,
  };

  // Phase 2: filter + group
  const filtered = allEvents.filter((e) => {
    if (activeSport === "calcio" && e.sport_slug !== "giocatori-calcio") return false;
    if (activeSport === "basket" && e.sport_slug !== "giocatori-basket") return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const homeAbbr = e.parsed.matchKey.split("-")[0];
      const awayAbbr = e.parsed.matchKey.split("-")[1];
      const homeFull = teamNameMap.get(homeAbbr)?.toLowerCase() || "";
      const awayFull = teamNameMap.get(awayAbbr)?.toLowerCase() || "";
      if (!e.parsed.playerName.toLowerCase().includes(q) &&
          !e.parsed.matchKey.toLowerCase().includes(q) &&
          !homeFull.includes(q) &&
          !awayFull.includes(q)) return false;
    }
    return true;
  });

  const groups = groupEventsByMatch(filtered, teamNameMap);

  // Phase 3: lazy load markets for a single player event
  const loadPlayerMarkets = useCallback(async (eventId: string) => {
    if (marketCache.current.has(eventId)) return;

    setLoadingMarkets((prev) => new Set(prev).add(eventId));

    try {
      const { data, error: err } = await supabase
        .from("markets")
        .select(`
          id,
          name,
          market_type,
          line,
          sort_order,
          is_active,
          is_suspended,
          outcomes(id, name, odds, previous_odds, is_active, is_suspended)
        `)
        .eq("event_id", eventId)
        .eq("is_active", true)
        .eq("is_suspended", false)
        .order("sort_order", { ascending: true });

      if (err) throw err;

      const markets: Market[] = ((data || []) as any[])
        .map((m: any) => ({
          id: m.id,
          name: m.name,
          marketType: m.market_type,
          line: m.line,
          selections: sortSelections(
            m.name,
            (m.outcomes || [])
              .filter((o: any) => o.is_active && !o.is_suspended)
              .map((o: any) => ({
                id: o.id,
                label: o.name,
                odds: parseFloat(o.odds),
                previousOdds: o.previous_odds ? parseFloat(o.previous_odds) : undefined,
              }))
          ),
        }))
        .filter((m: Market) => m.selections.length > 0);

      marketCache.current.set(eventId, markets);
    } catch (err: any) {
      console.error("[usePlayerProps] loadMarkets error:", err.message);
      marketCache.current.set(eventId, []);
    } finally {
      setLoadingMarkets((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    }
  }, []);

  const getPlayerMarkets = useCallback((eventId: string): Market[] | null => {
    return marketCache.current.get(eventId) || null;
  }, []);

  return {
    groups,
    loading,
    error,
    activeSport,
    setActiveSport,
    searchQuery,
    setSearchQuery,
    expandedMatch,
    setExpandedMatch,
    expandedPlayer,
    setExpandedPlayer,
    getPlayerMarkets,
    loadPlayerMarkets,
    loadingMarkets,
    counts,
  };
}
