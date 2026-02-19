"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";

// ═══ INTERFACES (extended with optional DB fields) ═══

export interface SportEvent {
  id: string;
  league: string;
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

export function mapDbToSportEvent(row: any): SportEvent {
  return {
    id: row.id,
    league: row.league?.name || "",
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
    markets: (row.markets || [])
      .filter((m: any) => m.is_active && !m.is_suspended)
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        marketType: m.market_type,
        line: m.line,
        selections: (m.outcomes || [])
          .filter((o: any) => o.is_active && !o.is_suspended)
          .map((o: any) => ({
            id: o.id,
            label: o.name,
            odds: parseFloat(o.odds),
            previousOdds: o.previous_odds ? parseFloat(o.previous_odds) : undefined,
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

  const [events, setEvents] = useState<SportEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMockData, setIsMockData] = useState(false);
  const [activeSport, setActiveSport] = useState<string | null>(null);
  const [betslip, setBetslip] = useState<BetslipItem[]>([]);
  const [placingBet, setPlacingBet] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Fetch events from Supabase ──
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
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
        .order("is_live", { ascending: false })
        .order("starts_at", { ascending: true });

      if (fetchErr) throw fetchErr;

      if (!data || data.length === 0) {
        setEvents(SEED_EVENTS);
        setIsMockData(true);
      } else {
        setEvents(data.map(mapDbToSportEvent));
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

  // ── Filtered events by sport ──
  const filteredEvents = activeSport
    ? events.filter((e) => e.sportSlug === activeSport)
    : events;

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

  // ── Place bet with risk check ──
  const placeBet = async (stake: number): Promise<{ success: boolean; error?: string; flagged?: boolean }> => {
    if (!user) return { success: false, error: "Devi accedere per scommettere" };
    if (!wallet || wallet.balance < stake) return { success: false, error: "Saldo insufficiente" };
    if (betslip.length === 0) return { success: false, error: "Schedina vuota" };
    if (stake < 1) return { success: false, error: "Puntata minima: $1" };
    if (stake > 10000) return { success: false, error: "Puntata massima: $10,000" };

    if (isMockData) {
      return { success: false, error: "Modalità demo — connetti il database per piazzare scommesse" };
    }

    setPlacingBet(true);

    try {
      const betType = betslip.length === 1 ? "singola" : betslip.length <= 3 ? "multi" : "sistema";
      const potentialWin = parseFloat((stake * totalOdds).toFixed(2));
      const hasLive = betslip.some((b) => events.find((e) => e.id === b.eventId)?.live);

      // 1. Insert bet
      const { data: bet, error: betError } = await supabase
        .from("bets")
        .insert({
          user_id: user.id,
          bet_type: betType,
          total_odds: parseFloat(totalOdds.toFixed(4)),
          stake,
          potential_win: potentialWin,
          status: "open",
          is_live: hasLive,
          selections_count: betslip.length,
        })
        .select("id")
        .single();

      if (betError || !bet) {
        setPlacingBet(false);
        return { success: false, error: "Errore nel piazzamento: " + (betError?.message || "sconosciuto") };
      }

      // 2. Insert bet selections
      const legs = betslip.map((b) => ({
        bet_id: bet.id,
        event_id: b.eventId,
        market_id: b.marketId,
        outcome_id: b.outcomeId,
        odds_at_placement: b.odds,
      }));

      const { error: legsError } = await supabase.from("bet_selections").insert(legs);
      if (legsError) {
        await supabase.from("bets").delete().eq("id", bet.id);
        setPlacingBet(false);
        return { success: false, error: "Errore inserimento selezioni: " + legsError.message };
      }

      // 3. Risk check via /api/risk-agent
      let flagged = false;
      try {
        const riskRes = await fetch("/api/risk-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bet_id: bet.id }),
        });

        if (riskRes.ok) {
          const riskData = await riskRes.json();

          if (riskData.action_taken === "blocked") {
            // Void bet and cleanup
            await supabase.from("bet_selections").delete().eq("bet_id", bet.id);
            await supabase.from("bets").delete().eq("id", bet.id);
            setPlacingBet(false);
            return {
              success: false,
              error: `Scommessa bloccata dal sistema di sicurezza: ${riskData.rule_analysis?.recommendation || "Contatta il supporto"}`,
            };
          }

          if (riskData.action_taken === "flagged") {
            flagged = true;
          }
        }
      } catch {
        // Risk agent unavailable — continue without blocking
      }

      // 4. Deduct from wallet
      await supabase
        .from("wallets")
        .update({ balance: wallet.balance - stake })
        .eq("user_id", user.id);

      // 5. Create transaction record
      await supabase.from("transactions").insert({
        user_id: user.id,
        wallet_id: wallet.id,
        type: "bet",
        amount: -stake,
        balance_before: wallet.balance,
        balance_after: wallet.balance - stake,
        reference_type: "bet",
        reference_id: bet.id,
        description: `Scommessa ${betType}: ${betslip.map((b) => b.match).join(", ")}`,
        status: "completed",
      });

      setBetslip([]);
      setPlacingBet(false);
      return { success: true, flagged };
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
