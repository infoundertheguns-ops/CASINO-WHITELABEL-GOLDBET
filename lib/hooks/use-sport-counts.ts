"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface SportCount {
  id: string;
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
  eventCount: number;
}

export interface LeagueCount {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  eventCount: number;
}

export type TimeFilter = "all" | "today" | "today_tomorrow" | "3h";

function getTimeFilterRange(filter: TimeFilter): { from: string; to: string } | null {
  if (filter === "all") return null;

  const now = new Date();

  if (filter === "3h") {
    const to = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return { from: now.toISOString(), to: to.toISOString() };
  }

  // Start of today
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (filter === "today") {
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    return { from: startOfToday.toISOString(), to: endOfToday.toISOString() };
  }

  if (filter === "today_tomorrow") {
    const endOfTomorrow = new Date(startOfToday);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);
    return { from: startOfToday.toISOString(), to: endOfTomorrow.toISOString() };
  }

  return null;
}

export function useSportCounts(timeFilter: TimeFilter = "all") {
  const supabase = createClient();
  const [sports, setSports] = useState<SportCount[]>([]);
  const [leagues, setLeagues] = useState<LeagueCount[]>([]);
  const [expandedSport, setExpandedSport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch sport counts
  useEffect(() => {
    let cancelled = false;

    async function fetchSports() {
      setLoading(true);

      // Build query for events — only Leon source
      let query = supabase
        .from("events")
        .select("sport_id, sports(id, name, slug, icon, sort_order)", { count: "exact" })
        .eq("source", "leon")
        .in("status", ["prematch", "live"]);

      const range = getTimeFilterRange(timeFilter);
      if (range) {
        // For live events, always include them; for prematch, filter by starts_at
        query = query.or(`is_live.eq.true,and(starts_at.gte.${range.from},starts_at.lt.${range.to})`);
      }

      const { data, error } = await query;

      if (cancelled || error || !data) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Aggregate counts by sport
      const sportMap = new Map<string, SportCount>();
      for (const row of data as any[]) {
        const sport = row.sports;
        if (!sport) continue;
        // Skip Giocatori sports — they have their own /marcatori page
        if ((sport.slug || "").startsWith("giocatori-")) continue;
        const existing = sportMap.get(sport.id);
        if (existing) {
          existing.eventCount++;
        } else {
          sportMap.set(sport.id, {
            id: sport.id,
            name: sport.name,
            slug: sport.slug,
            icon: sport.icon || "⚽",
            sortOrder: sport.sort_order ?? 99,
            eventCount: 1,
          });
        }
      }

      const sorted = Array.from(sportMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
      if (!cancelled) {
        setSports(sorted);
        setLoading(false);
      }
    }

    fetchSports();
    return () => { cancelled = true; };
  }, [timeFilter]);

  // Fetch leagues when a sport is expanded
  const fetchLeagues = useCallback(async (sportSlug: string) => {
    if (expandedSport === sportSlug) {
      setExpandedSport(null);
      setLeagues([]);
      return;
    }

    setExpandedSport(sportSlug);

    let query = supabase
      .from("events")
      .select("league_id, leagues(id, name, slug, country)")
      .in("status", ["prematch", "live"])
      .eq("sports.slug", sportSlug);

    // We need to filter by sport — use a different approach via sport join
    // Since events.sport_id links to sports, let's get sport ID first from our state
    const sport = sports.find((s) => s.slug === sportSlug);
    if (!sport) return;

    query = supabase
      .from("events")
      .select("league_id, leagues(id, name, slug, country)")
      .eq("source", "leon")
      .in("status", ["prematch", "live"])
      .eq("sport_id", sport.id);

    const range = getTimeFilterRange(timeFilter);
    if (range) {
      query = query.or(`is_live.eq.true,and(starts_at.gte.${range.from},starts_at.lt.${range.to})`);
    }

    const { data, error } = await query;

    if (error || !data) return;

    // Aggregate by league
    const leagueMap = new Map<string, LeagueCount>();
    for (const row of data as any[]) {
      const league = row.leagues;
      if (!league) continue;
      const existing = leagueMap.get(league.id);
      if (existing) {
        existing.eventCount++;
      } else {
        leagueMap.set(league.id, {
          id: league.id,
          name: league.name,
          slug: league.slug,
          country: league.country,
          eventCount: 1,
        });
      }
    }

    const sorted = Array.from(leagueMap.values()).sort((a, b) => b.eventCount - a.eventCount);
    setLeagues(sorted);
  }, [expandedSport, sports, timeFilter]);

  return {
    sports,
    leagues,
    expandedSport,
    loading,
    fetchLeagues,
  };
}
