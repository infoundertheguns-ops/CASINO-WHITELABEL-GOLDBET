"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSportSlugIt } from "@/lib/sport-slug-en-to-it";

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

  // Fetch sport counts.
  //
  // events_v2 has no sport_id FK — only flat sport_slug (English, e.g.
  // "football") / sport_name (English) columns. The sports table is still
  // kept (mig 138 preserved it) and holds icon/sort_order/id, but it's keyed
  // by Italian slug (e.g. "calcio"). To bridge: fetch events_v2 grouped by
  // sport_slug (English), translate to Italian via getSportSlugIt, then join
  // to the sports table on the Italian slug to source icon + sort_order + id.
  useEffect(() => {
    let cancelled = false;

    async function fetchSports() {
      setLoading(true);

      // Build query for events_v2. Status enum v2: pending/live (was prematch/live).
      // is_live signal is status === 'live' (no is_live column). source filter
      // dropped — events_v2 is implicitly odds-api only.
      let query = supabase
        .from("events_v2")
        .select("sport_slug")
        .in("status", ["pending", "live"]);

      const range = getTimeFilterRange(timeFilter);
      if (range) {
        // For live events, always include them; for prematch, filter by starts_at
        query = query.or(`status.eq.live,and(starts_at.gte.${range.from},starts_at.lt.${range.to})`);
      }

      const { data, error } = await query;

      if (cancelled || error || !data) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Aggregate counts by Italian sport slug (events_v2 stores English).
      const countBySlugIt = new Map<string, number>();
      for (const row of data as any[]) {
        const slugIt = getSportSlugIt(row.sport_slug);
        if (!slugIt) continue;
        // Skip Giocatori sports — they have their own /marcatori page.
        // (v2 schema no longer emits "giocatori-*" sports — kept for safety.)
        if (slugIt.startsWith("giocatori-")) continue;
        countBySlugIt.set(slugIt, (countBySlugIt.get(slugIt) || 0) + 1);
      }

      if (countBySlugIt.size === 0) {
        if (!cancelled) {
          setSports([]);
          setLoading(false);
        }
        return;
      }

      // Fetch sports metadata (icon, sort_order, id, name) for slugs we counted.
      // The sports table is keyed by Italian slug.
      const { data: sportsRows } = await supabase
        .from("sports")
        .select("id, name, slug, icon, sort_order")
        .in("slug", Array.from(countBySlugIt.keys()));

      const sportMap = new Map<string, SportCount>();
      for (const sport of (sportsRows || []) as any[]) {
        const count = countBySlugIt.get(sport.slug);
        if (!count) continue;
        sportMap.set(sport.slug, {
          id: sport.id,
          name: sport.name,
          slug: sport.slug,
          icon: sport.icon || "⚽",
          sortOrder: sport.sort_order ?? 99,
          eventCount: count,
        });
      }

      // For sport slugs present in events_v2 but missing from `sports` table
      // (e.g. brand-new English slug not yet mapped), fall back to a synthetic
      // entry using the Italian slug as both id+name so the sport still shows
      // up in the sidebar rather than vanishing silently.
      for (const [slugIt, count] of countBySlugIt) {
        if (!sportMap.has(slugIt)) {
          sportMap.set(slugIt, {
            id: slugIt,
            name: slugIt,
            slug: slugIt,
            icon: "⚽",
            sortOrder: 99,
            eventCount: count,
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

  // Fetch leagues when a sport is expanded.
  //
  // events_v2 has flat league_slug/league_name and no league_id FK. We group
  // event counts by league_slug, then look up display data from the leagues
  // table (still kept). Filtering events by sport requires translating the
  // Italian UI slug back to English — but we don't keep that map here; we
  // already have the SportCount.slug (Italian) and the sport's English slug
  // is implicit via the events row. Approach: filter events_v2 rows by the
  // event's sport_slug matching the EN equivalent. Simpler path: query
  // events_v2 by leagues whose sport matches sportSlug via a JOIN through the
  // `leagues` table (still keyed by Italian sport_id). We instead derive the
  // English sport slug by reverse-translating: query the sports table for
  // id of the IT slug, then leagues for that sport, then events_v2 by those
  // league_slugs. Two extra round trips but keeps logic transparent.
  const fetchLeagues = useCallback(async (sportSlug: string) => {
    if (expandedSport === sportSlug) {
      setExpandedSport(null);
      setLeagues([]);
      return;
    }

    setExpandedSport(sportSlug);

    const sport = sports.find((s) => s.slug === sportSlug);
    if (!sport) return;

    // Step 1: find leagues belonging to this sport (sport_id-based, since the
    // `leagues` table still has sport_id FK to sports).
    const { data: leagueRows, error: leaguesErr } = await supabase
      .from("leagues")
      .select("id, name, slug, country")
      .eq("sport_id", sport.id);

    if (leaguesErr || !leagueRows || leagueRows.length === 0) return;

    const leagueBySlug = new Map<string, { id: string; name: string; slug: string; country: string | null }>();
    for (const l of leagueRows as any[]) {
      leagueBySlug.set(l.slug, l);
    }

    // Step 2: count events_v2 rows whose league_slug is in our set.
    let query = supabase
      .from("events_v2")
      .select("league_slug")
      .in("status", ["pending", "live"])
      .in("league_slug", Array.from(leagueBySlug.keys()));

    const range = getTimeFilterRange(timeFilter);
    if (range) {
      query = query.or(`status.eq.live,and(starts_at.gte.${range.from},starts_at.lt.${range.to})`);
    }

    const { data, error } = await query;

    if (error || !data) return;

    // Aggregate by league_slug
    const countBySlug = new Map<string, number>();
    for (const row of data as any[]) {
      countBySlug.set(row.league_slug, (countBySlug.get(row.league_slug) || 0) + 1);
    }

    const result: LeagueCount[] = [];
    for (const [slug, count] of countBySlug) {
      const meta = leagueBySlug.get(slug);
      if (!meta) continue;
      result.push({
        id: meta.id,
        name: meta.name,
        slug: meta.slug,
        country: meta.country,
        eventCount: count,
      });
    }

    const sorted = result.sort((a, b) => b.eventCount - a.eventCount);
    setLeagues(sorted);
  }, [expandedSport, sports, timeFilter, supabase]);

  return {
    sports,
    leagues,
    expandedSport,
    loading,
    fetchLeagues,
  };
}
