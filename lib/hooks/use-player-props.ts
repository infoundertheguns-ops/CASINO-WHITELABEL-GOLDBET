"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  buildPlayerMatches,
  type PlayerMatch,
} from "@/lib/utils/player-props";
import {
  mapDbToSportEvent,
} from "@/lib/hooks/use-sportsbook";

export type PlayerSportFilter = "tutti" | "calcio" | "basket" | "tennis";

export interface UsePlayerPropsReturn {
  matches: PlayerMatch[];
  loading: boolean;
  error: string | null;
  activeSport: PlayerSportFilter;
  setActiveSport: (s: PlayerSportFilter) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  expandedMatch: string | null;
  setExpandedMatch: (key: string | null) => void;
  counts: { calcio: number; basket: number; total: number };
}

export function usePlayerProps(): UsePlayerPropsReturn {
  const supabase = createClient();
  const [allMatches, setAllMatches] = useState<PlayerMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSport, setActiveSport] = useState<PlayerSportFilter>("tutti");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  // Fetch Leon events with all markets, then filter player markets client-side
  useEffect(() => {
    let cancelled = false;

    async function fetchPlayerEvents() {
      setLoading(true);
      setError(null);

      try {
        // Fetch events from Leon with markets included
        const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data, error: err } = await supabase
          .from("events")
          .select(`
            *,
            sport:sports(name, slug, icon),
            league:leagues(name, slug, country, logo_url),
            markets(id, name, slug, market_type, line, sort_order, is_active, is_suspended,
              outcomes(id, name, odds, previous_odds, is_active, is_suspended))
          `)
          .eq("source", "leon")
          .in("status", ["prematch", "live"])
          .or(`is_live.eq.true,starts_at.gte.${cutoff}`)
          .order("starts_at", { ascending: true })
          .limit(500);

        if (cancelled) return;
        if (err) throw err;

        const rows = (data || []) as any[];

        // Map to SportEvent format, then build player matches
        const events = rows
          .map((row) => {
            const ev = mapDbToSportEvent(row, true);
            return {
              ...ev,
              startsAt: row.starts_at,
            };
          })
          .filter((e) => !(e.sportSlug || "").startsWith("giocatori-"));

        const matches = buildPlayerMatches(events);
        setAllMatches(matches);
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

  // Counts per sport
  const counts = {
    calcio: allMatches.filter((m) => m.sportSlug === "calcio").length,
    basket: allMatches.filter((m) => m.sportSlug === "basket").length,
    total: allMatches.length,
  };

  // Filter by sport and search
  const filtered = allMatches.filter((m) => {
    if (activeSport === "calcio" && m.sportSlug !== "calcio") return false;
    if (activeSport === "basket" && m.sportSlug !== "basket") return false;
    if (activeSport === "tennis" && m.sportSlug !== "tennis") return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !m.homeTeam.toLowerCase().includes(q) &&
        !m.awayTeam.toLowerCase().includes(q) &&
        !m.league.toLowerCase().includes(q) &&
        // Search in player names (runners in categories)
        !m.categories.some((c) =>
          c.markets.some((mk) =>
            mk.selections.some((s) => s.label.toLowerCase().includes(q))
          )
        )
      ) {
        return false;
      }
    }
    return true;
  });

  return {
    matches: filtered,
    loading,
    error,
    activeSport,
    setActiveSport,
    searchQuery,
    setSearchQuery,
    expandedMatch,
    setExpandedMatch,
    counts,
  };
}
