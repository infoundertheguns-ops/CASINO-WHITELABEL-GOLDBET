"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapDbToSportEvent, type SportEvent, type Selection } from "./use-sportsbook";

interface LeagueInfo {
  id: string;
  name: string;
  slug: string;
  country: string | null;
  logoUrl: string | null;
}

interface UseLeagueEventsReturn {
  league: LeagueInfo | null;
  sportName: string;
  sportIcon: string;
  events: SportEvent[];
  loading: boolean;
  error: string | null;
}

export function useLeagueEvents(slug: string): UseLeagueEventsReturn {
  const supabase = useMemo(() => createClient(), []);
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [sportName, setSportName] = useState("");
  const [sportIcon, setSportIcon] = useState("");
  const [events, setEvents] = useState<SportEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const marketIdsRef = useRef<Set<string>>(new Set());

  const fetchData = useCallback(async (isInitial = false) => {
    if (!slug) return;
    if (isInitial) { setLoading(true); setError(null); }

    try {
      // 1. Find the league by slug
      const { data: leagueRow, error: leagueErr } = await supabase
        .from("leagues")
        .select("id, name, slug, country, logo_url, sport:sports(name, icon)")
        .eq("slug", slug)
        .single();

      if (leagueErr || !leagueRow) {
        if (isInitial) setError("Lega non trovata");
        if (isInitial) setLoading(false);
        return;
      }

      const sportData = leagueRow.sport as any;
      if (isInitial) {
        setLeague({
          id: leagueRow.id,
          name: leagueRow.name,
          slug: leagueRow.slug,
          country: leagueRow.country,
          logoUrl: leagueRow.logo_url,
        });
        setSportName(sportData?.name || "");
        setSportIcon(sportData?.icon || "");
      }

      // 2. Fetch ALL events for this league with ALL markets
      const { data: eventRows, error: eventsErr } = await supabase
        .from("events")
        .select(`
          *,
          sport:sports(name, slug, icon),
          league:leagues(name, slug, country, logo_url),
          markets(
            id, name, slug, market_type, line, sort_order, is_active, is_suspended,
            outcomes(id, name, odds, previous_odds, is_active, is_suspended)
          )
        `)
        .eq("league_id", leagueRow.id)
        .in("status", ["prematch", "live"])
        .order("starts_at", { ascending: true });

      if (eventsErr) throw eventsErr;

      if (!eventRows || eventRows.length === 0) {
        if (isInitial) setEvents([]);
        if (isInitial) setLoading(false);
        return;
      }

      const mapped = eventRows.map((row) => mapDbToSportEvent(row, true));

      if (isInitial) {
        setEvents(mapped);
        // Track all market IDs for realtime filtering
        const ids = new Set<string>();
        for (const ev of mapped) {
          for (const m of ev.markets) {
            if (m.id) ids.add(m.id);
          }
        }
        marketIdsRef.current = ids;
      } else {
        // Merge with flash animations
        setEvents((prev) => {
          const prevSelMap = new Map<string, Selection>();
          for (const ev of prev) {
            for (const m of ev.markets) {
              for (const s of m.selections) {
                if (s.id) prevSelMap.set(s.id, s);
              }
            }
          }

          return mapped.map((ev) => ({
            ...ev,
            markets: ev.markets.map((m) => ({
              ...m,
              selections: m.selections.map((s) => {
                if (!s.id) return s;
                const old = prevSelMap.get(s.id);
                if (!old) return s;
                if (old.odds !== s.odds) {
                  return { ...s, previousOdds: old.odds, changedAt: Date.now() };
                }
                if (old.changedAt && Date.now() - old.changedAt < 5000) {
                  return { ...s, changedAt: old.changedAt, previousOdds: old.previousOdds };
                }
                return s;
              }),
            })),
          }));
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Errore nel caricamento";
      if (isInitial) setError(message);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [slug, supabase]);

  // Initial fetch
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Realtime subscription for outcome changes
  useEffect(() => {
    if (!slug) return;

    const channel = supabase
      .channel(`league-${slug}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "outcomes" },
        (payload) => {
          const updated = payload.new as Record<string, any>;
          if (!marketIdsRef.current.has(updated.market_id)) return;

          const newOdds = parseFloat(updated.odds);
          setEvents((prev) =>
            prev.map((ev) => ({
              ...ev,
              markets: ev.markets.map((m) =>
                m.id === updated.market_id
                  ? {
                      ...m,
                      selections: m.selections.map((sel) => {
                        if (sel.id !== updated.id) return sel;
                        const oddsChanged = sel.odds !== newOdds;
                        return {
                          ...sel,
                          previousOdds: oddsChanged ? sel.odds : sel.previousOdds,
                          odds: newOdds,
                          changedAt: oddsChanged ? Date.now() : sel.changedAt,
                          suspended: updated.is_suspended || undefined,
                        };
                      }),
                    }
                  : m
              ),
            }))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events" },
        (payload) => {
          const updated = payload.new as Record<string, any>;
          const liveData = updated.live_data || {};

          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === updated.id
                ? {
                    ...ev,
                    live: updated.is_live || false,
                    minute: updated.minute,
                    minuteReceivedAt: updated.is_live ? Date.now() : undefined,
                    scoreH: updated.score_home,
                    scoreA: updated.score_away,
                    period: updated.period || undefined,
                    periodCode: liveData.periodCode ?? undefined,
                    halfScoreHome: Array.isArray(liveData.halfScoreHome) ? liveData.halfScoreHome : undefined,
                    halfScoreAway: Array.isArray(liveData.halfScoreAway) ? liveData.halfScoreAway : undefined,
                    stats: liveData.stats || undefined,
                    matchEvents: Array.isArray(liveData.matchEvents) ? liveData.matchEvents : undefined,
                    time: updated.is_live
                      ? `LIVE ${updated.minute || 0}'`
                      : ev.time,
                  }
                : ev
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slug, supabase]);

  return { league, sportName, sportIcon, events, loading, error };
}
