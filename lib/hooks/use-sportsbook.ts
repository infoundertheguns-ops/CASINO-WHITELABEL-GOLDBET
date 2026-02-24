"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";
import { useSportFilter } from "@/lib/contexts/sport-filter-context";

// ═══ API-FOOTBALL STATS TYPES ═══

export interface MatchStats {
  possession: [number, number];
  shots: [number, number];
  shotsOnTarget: [number, number];
  corners: [number, number];
  fouls: [number, number];
  yellowCards: [number, number];
  redCards: [number, number];
  offsides?: [number, number];
  saves?: [number, number];
}

export interface MatchEvent {
  minute: number;
  type: string;
  team: 'home' | 'away';
  player: string;
  assist?: string;
  detail?: string;
}

// ═══ INTERFACES (extended with optional DB fields) ═══

export interface SportEvent {
  id: string;
  league: string;
  leagueSlug?: string;
  leagueIcon: string;
  home: string;
  away: string;
  time: string;
  live: boolean;
  minute?: number;
  minuteReceivedAt?: number;
  scoreH?: number;
  scoreA?: number;
  markets: Market[];
  sportName?: string;
  sportSlug?: string;
  period?: string;
  periodCode?: number;
  halfScoreHome?: number[];
  halfScoreAway?: number[];
  stats?: MatchStats;
  matchEvents?: MatchEvent[];
}

export interface Market {
  name: string;
  selections: Selection[];
  id?: string;
  marketType?: string;
  line?: number;
}

export interface Selection {
  label: string;
  odds: number;
  id?: string;
  previousOdds?: number;
  changedAt?: number;
  suspended?: boolean;
}

export interface BetslipItem {
  eventId: string;
  marketName: string;
  selection: string;
  odds: number;
  match: string;
  marketId?: string;
  outcomeId?: string;
}

// ═══ HELPERS ═══

function formatKickoffTime(startsAt: string): string {
  const d = new Date(startsAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays <= 0) {
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return `Domani ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function mapDbToSportEvent(row: any, includeSuspended = false): SportEvent {
  const liveData = row.live_data || {};
  return {
    id: row.id,
    league: row.league?.name || "",
    leagueSlug: row.league?.slug || "",
    leagueIcon: row.sport?.icon || "⚽",
    sportName: row.sport?.name || "",
    sportSlug: row.sport?.slug || "",
    home: row.home_team,
    away: row.away_team,
    time: row.is_live
      ? `LIVE ${row.minute || 0}'`
      : formatKickoffTime(row.starts_at),
    live: row.is_live || false,
    minute: row.minute,
    minuteReceivedAt: row.is_live ? Date.now() : undefined,
    scoreH: row.score_home,
    scoreA: row.score_away,
    period: row.period || undefined,
    periodCode: liveData.periodCode ?? undefined,
    halfScoreHome: Array.isArray(liveData.halfScoreHome) ? liveData.halfScoreHome : undefined,
    halfScoreAway: Array.isArray(liveData.halfScoreAway) ? liveData.halfScoreAway : undefined,
    stats: liveData.stats || undefined,
    matchEvents: Array.isArray(liveData.matchEvents) ? liveData.matchEvents : undefined,
    markets: (row.markets || [])
      .filter((m: any) => m.is_active && !m.is_suspended)
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        marketType: m.market_type,
        line: m.line,
        selections: (m.outcomes || [])
          .filter((o: any) => o.is_active && (includeSuspended || !o.is_suspended))
          .map((o: any) => ({
            id: o.id,
            label: o.name,
            odds: parseFloat(o.odds),
            previousOdds: o.previous_odds ? parseFloat(o.previous_odds) : undefined,
            suspended: o.is_suspended ? true : undefined,
          })),
      })),
  };
}

// ═══ SEED DATA — fallback when DB has no events ═══

const SEED_EVENTS: SportEvent[] = [
  {
    id: "e1", league: "Serie A", leagueIcon: "🇮🇹", sportName: "Calcio", sportSlug: "calcio",
    home: "Inter", away: "Juventus", time: "LIVE 72'", live: true, minute: 72, scoreH: 2, scoreA: 1,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.45 }, { label: "X", odds: 4.50 }, { label: "2", odds: 6.00 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.30 }, { label: "Under", odds: 3.40 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.55 }, { label: "NG", odds: 2.30 }] },
    ],
  },
  {
    id: "e2", league: "Serie A", leagueIcon: "🇮🇹", sportName: "Calcio", sportSlug: "calcio",
    home: "Milan", away: "Napoli", time: "20:45", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.10 }, { label: "X", odds: 3.40 }, { label: "2", odds: 3.20 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.85 }, { label: "Under", odds: 1.95 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.70 }, { label: "NG", odds: 2.10 }] },
    ],
  },
  {
    id: "e3", league: "Premier League", leagueIcon: "🏴", sportName: "Calcio", sportSlug: "calcio",
    home: "Arsenal", away: "Liverpool", time: "21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.30 }, { label: "X", odds: 3.50 }, { label: "2", odds: 2.90 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.75 }, { label: "Under", odds: 2.05 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.60 }, { label: "NG", odds: 2.25 }] },
    ],
  },
  {
    id: "e4", league: "La Liga", leagueIcon: "🇪🇸", sportName: "Calcio", sportSlug: "calcio",
    home: "Real Madrid", away: "Barcelona", time: "LIVE 34'", live: true, minute: 34, scoreH: 0, scoreA: 0,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.60 }, { label: "X", odds: 3.20 }, { label: "2", odds: 2.70 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 2.10 }, { label: "Under", odds: 1.72 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.80 }, { label: "NG", odds: 1.95 }] },
    ],
  },
  {
    id: "e5", league: "Bundesliga", leagueIcon: "🇩🇪", sportName: "Calcio", sportSlug: "calcio",
    home: "Bayern", away: "Dortmund", time: "18:30", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.65 }, { label: "X", odds: 4.00 }, { label: "2", odds: 4.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.50 }, { label: "Under", odds: 2.50 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.65 }, { label: "NG", odds: 2.15 }] },
    ],
  },
  {
    id: "e6", league: "Ligue 1", leagueIcon: "🇫🇷", sportName: "Calcio", sportSlug: "calcio",
    home: "PSG", away: "Marseille", time: "21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.35 }, { label: "X", odds: 5.50 }, { label: "2", odds: 7.50 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.55 }, { label: "Under", odds: 2.40 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.90 }, { label: "NG", odds: 1.85 }] },
    ],
  },
  {
    id: "e7", league: "Champions League", leagueIcon: "🏆", sportName: "Calcio", sportSlug: "calcio",
    home: "Man City", away: "Inter", time: "Domani 21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.80 }, { label: "X", odds: 3.60 }, { label: "2", odds: 4.20 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.80 }, { label: "Under", odds: 2.00 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.75 }, { label: "NG", odds: 2.05 }] },
    ],
  },
  {
    id: "e8", league: "Champions League", leagueIcon: "🏆", sportName: "Calcio", sportSlug: "calcio",
    home: "Real Madrid", away: "Bayern", time: "Domani 21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.20 }, { label: "X", odds: 3.40 }, { label: "2", odds: 3.10 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.70 }, { label: "Under", odds: 2.10 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.65 }, { label: "NG", odds: 2.20 }] },
    ],
  },
  {
    id: "e9", league: "Serie A", leagueIcon: "🇮🇹", sportName: "Calcio", sportSlug: "calcio",
    home: "Roma", away: "Lazio", time: "LIVE 55'", live: true, minute: 55, scoreH: 1, scoreA: 1,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.80 }, { label: "X", odds: 2.90 }, { label: "2", odds: 2.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.90 }, { label: "Under", odds: 1.90 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.20 }, { label: "NG", odds: 4.50 }] },
    ],
  },
  {
    id: "e10", league: "Premier League", leagueIcon: "🏴", sportName: "Calcio", sportSlug: "calcio",
    home: "Man United", away: "Chelsea", time: "15:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.50 }, { label: "X", odds: 3.30 }, { label: "2", odds: 2.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.85 }, { label: "Under", odds: 1.95 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.72 }, { label: "NG", odds: 2.08 }] },
    ],
  },
];

// ═══ HOOK ═══

export function useSportsbook() {
  const { user, wallet } = useAuth();
  const supabase = createClient();

  const { activeSport, setActiveSport, activeLeague, setActiveLeague } = useSportFilter();

  const [events, setEvents] = useState<SportEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMockData, setIsMockData] = useState(false);
  const [betslip, setBetslip] = useState<BetslipItem[]>([]);
  const [placingBet, setPlacingBet] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Fetch events from Supabase ──
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Exclude prematch events that already started (with 30min buffer)
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data, error: fetchErr } = await supabase
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
        .in("status", ["prematch", "live"])
        .or(`is_live.eq.true,starts_at.gte.${cutoff}`)
        .in("markets.market_type", [
          "1X2", "U/O 2.5", "GG/NG",                                          // Calcio
          "T/T Risultato", "Testa A Testa", "1X2 Tempi Reg.",                  // Basket
          "Vincente Incontro (escl. ritiro)", "Vincente Incontro",             // Tennis/Volley/TT/Snooker
          "Esito Finale 1X2", "Gol/No Gol",                                   // Hockey
          "T/T Match",                                                          // Cricket
        ])
        .order("is_live", { ascending: false })
        .order("starts_at", { ascending: true });

      if (fetchErr) throw fetchErr;

      if (!data || data.length === 0) {
        setEvents(SEED_EVENTS);
        setIsMockData(true);
      } else {
        // Deduplicate events by home+away+league (API can create dupes with different external_ids)
        const mapped = data.map((row) => mapDbToSportEvent(row));
        const seen = new Set<string>();
        const deduped = mapped.filter((e) => {
          const key = `${e.home}|${e.away}|${e.league}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setEvents(deduped);
        setIsMockData(false);
      }
    } catch (err: any) {
      console.error("[useSportsbook] fetchEvents error:", err.message);
      setError(err.message);
      setEvents(SEED_EVENTS);
      setIsMockData(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Realtime: subscribe to odds + event updates ──
  useEffect(() => {
    fetchEvents();

    const channel = supabase
      .channel("sportsbook-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "outcomes" },
        (payload) => {
          const updated = payload.new as Record<string, any>;
          const newOdds = parseFloat(updated.odds);

          // Update odds inside events
          setEvents((prev) =>
            prev.map((event) => ({
              ...event,
              markets: event.markets.map((market) => ({
                ...market,
                selections: market.selections.map((sel) =>
                  sel.id === updated.id
                    ? { ...sel, previousOdds: sel.odds, odds: newOdds, changedAt: Date.now() }
                    : sel
                ),
              })),
            }))
          );

          // Keep betslip odds in sync
          setBetslip((prev) =>
            prev.map((item) =>
              item.outcomeId === updated.id
                ? { ...item, odds: newOdds }
                : item
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events" },
        (payload) => {
          const updated = payload.new as Record<string, any>;

          const updatedLiveData = updated.live_data || {};
          setEvents((prev) =>
            prev.map((event) =>
              event.id === updated.id
                ? {
                    ...event,
                    live: updated.is_live || false,
                    minute: updated.minute,
                    minuteReceivedAt: updated.is_live ? Date.now() : undefined,
                    scoreH: updated.score_home,
                    scoreA: updated.score_away,
                    period: updated.period || undefined,
                    periodCode: updatedLiveData.periodCode ?? undefined,
                    halfScoreHome: Array.isArray(updatedLiveData.halfScoreHome) ? updatedLiveData.halfScoreHome : undefined,
                    halfScoreAway: Array.isArray(updatedLiveData.halfScoreAway) ? updatedLiveData.halfScoreAway : undefined,
                    stats: updatedLiveData.stats || undefined,
                    matchEvents: Array.isArray(updatedLiveData.matchEvents) ? updatedLiveData.matchEvents : undefined,
                    time: updated.is_live
                      ? `LIVE ${updated.minute || 0}'`
                      : formatKickoffTime(updated.starts_at),
                  }
                : event
            )
          );
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  // ── Filtered events by sport + league ──
  const filteredEvents = events.filter((e) => {
    if (activeSport && e.sportSlug !== activeSport) return false;
    if (activeLeague && e.leagueSlug !== activeLeague) return false;
    return true;
  });

  // ── Betslip: toggle selection ──
  const toggleBet = (event: SportEvent, marketName: string, selection: Selection) => {
    const exists = betslip.find(
      (b) => b.eventId === event.id && b.marketName === marketName && b.selection === selection.label
    );

    if (exists) {
      setBetslip(betslip.filter(
        (b) => !(b.eventId === event.id && b.marketName === marketName && b.selection === selection.label)
      ));
    } else {
      // Remove other selections for same event+market
      const filtered = betslip.filter(
        (b) => !(b.eventId === event.id && b.marketName === marketName)
      );
      filtered.push({
        eventId: event.id,
        marketName,
        selection: selection.label,
        odds: selection.odds,
        match: `${event.home} vs ${event.away}`,
        marketId: event.markets.find((m) => m.name === marketName)?.id,
        outcomeId: selection.id,
      });
      setBetslip(filtered);
    }
  };

  // ── Betslip: check if selected ──
  const isSelected = (eventId: string, marketName: string, selectionLabel: string) => {
    return betslip.some(
      (b) => b.eventId === eventId && b.marketName === marketName && b.selection === selectionLabel
    );
  };

  // ── Betslip: clear ──
  const clearBetslip = () => setBetslip([]);

  // ── Betslip: total odds ──
  const totalOdds = betslip.reduce((acc, b) => acc * b.odds, 1);

  // ── Place bet via server-side API ──
  const placeBet = async (stake: number): Promise<{
    success: boolean;
    error?: string;
    flagged?: boolean;
    partial?: boolean;
    accepted_stake?: number;
    pending_acceptance?: boolean;
    updated_selections?: any[];
  }> => {
    if (!user) return { success: false, error: "Devi accedere per scommettere" };
    if (!wallet || wallet.balance < stake) return { success: false, error: "Saldo insufficiente" };
    if (betslip.length === 0) return { success: false, error: "Schedina vuota" };
    if (stake < 1) return { success: false, error: "Puntata minima: $1" };
    if (stake > 10000) return { success: false, error: "Puntata massima: $10,000" };

    if (isMockData) {
      return { success: false, error: "Modalita' demo — connetti il database per piazzare scommesse" };
    }

    setPlacingBet(true);

    try {
      const res = await fetch("/api/player/place-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake,
          selections: betslip.map((b) => ({
            eventId: b.eventId,
            marketId: b.marketId,
            outcomeId: b.outcomeId,
            odds: b.odds,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPlacingBet(false);

        // Handle odds changed — update betslip with new odds
        if (data.code === "ODDS_CHANGED" && data.updated_selections) {
          setBetslip((prev) =>
            prev.map((item) => {
              const updated = data.updated_selections.find(
                (s: any) => s.outcomeId === item.outcomeId
              );
              return updated ? { ...item, odds: updated.current_odds } : item;
            })
          );
          return {
            success: false,
            error: "Le quote sono cambiate. La schedina e' stata aggiornata.",
            updated_selections: data.updated_selections,
          };
        }

        // Handle limit exceeded — return max_stake for UI
        if (data.code === "LIMIT_EXCEEDED" || data.code === "DAILY_LIMIT_EXCEEDED") {
          return { success: false, error: data.error, accepted_stake: data.max_stake || data.remaining };
        }

        return { success: false, error: data.error || "Errore nel piazzamento" };
      }

      setBetslip([]);
      setPlacingBet(false);

      return {
        success: true,
        flagged: data.flagged,
        partial: data.partial,
        accepted_stake: data.stake,
        pending_acceptance: data.status === "pending_acceptance",
      };
    } catch (err: any) {
      setPlacingBet(false);
      return { success: false, error: err.message || "Errore imprevisto" };
    }
  };

  return {
    // Events
    events,
    filteredEvents,
    allEvents: events,
    loading,
    error,
    isMockData,
    fetchEvents,

    // Sport filter
    activeSport,
    setActiveSport,

    // Betslip
    betslip,
    placingBet,
    toggleBet,
    isSelected,
    clearBetslip,
    totalOdds,
    placeBet,
  };
}
