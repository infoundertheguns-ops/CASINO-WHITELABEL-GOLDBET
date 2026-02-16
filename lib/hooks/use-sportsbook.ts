"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";

export interface SportEvent {
  id: string;
  league: string;
  leagueIcon: string;
  home: string;
  away: string;
  time: string;
  live: boolean;
  minute?: number;
  scoreH?: number;
  scoreA?: number;
  markets: Market[];
}

export interface Market {
  name: string;
  selections: Selection[];
}

export interface Selection {
  label: string;
  odds: number;
}

export interface BetslipItem {
  eventId: string;
  marketName: string;
  selection: string;
  odds: number;
  match: string;
}

// Seed data — in production this comes from a feed API
const SEED_EVENTS: SportEvent[] = [
  {
    id: "e1", league: "Serie A", leagueIcon: "🇮🇹", home: "Inter", away: "Juventus",
    time: "LIVE 72'", live: true, minute: 72, scoreH: 2, scoreA: 1,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.45 }, { label: "X", odds: 4.50 }, { label: "2", odds: 6.00 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.30 }, { label: "Under", odds: 3.40 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.55 }, { label: "NG", odds: 2.30 }] },
    ],
  },
  {
    id: "e2", league: "Serie A", leagueIcon: "🇮🇹", home: "Milan", away: "Napoli",
    time: "20:45", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.10 }, { label: "X", odds: 3.40 }, { label: "2", odds: 3.20 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.85 }, { label: "Under", odds: 1.95 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.70 }, { label: "NG", odds: 2.10 }] },
    ],
  },
  {
    id: "e3", league: "Premier League", leagueIcon: "🏴", home: "Arsenal", away: "Liverpool",
    time: "21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.30 }, { label: "X", odds: 3.50 }, { label: "2", odds: 2.90 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.75 }, { label: "Under", odds: 2.05 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.60 }, { label: "NG", odds: 2.25 }] },
    ],
  },
  {
    id: "e4", league: "La Liga", leagueIcon: "🇪🇸", home: "Real Madrid", away: "Barcelona",
    time: "LIVE 34'", live: true, minute: 34, scoreH: 0, scoreA: 0,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.60 }, { label: "X", odds: 3.20 }, { label: "2", odds: 2.70 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 2.10 }, { label: "Under", odds: 1.72 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.80 }, { label: "NG", odds: 1.95 }] },
    ],
  },
  {
    id: "e5", league: "Bundesliga", leagueIcon: "🇩🇪", home: "Bayern", away: "Dortmund",
    time: "18:30", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.65 }, { label: "X", odds: 4.00 }, { label: "2", odds: 4.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.50 }, { label: "Under", odds: 2.50 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.65 }, { label: "NG", odds: 2.15 }] },
    ],
  },
  {
    id: "e6", league: "Ligue 1", leagueIcon: "🇫🇷", home: "PSG", away: "Marseille",
    time: "21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.35 }, { label: "X", odds: 5.50 }, { label: "2", odds: 7.50 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.55 }, { label: "Under", odds: 2.40 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.90 }, { label: "NG", odds: 1.85 }] },
    ],
  },
  {
    id: "e7", league: "Champions League", leagueIcon: "🏆", home: "Man City", away: "Inter",
    time: "Domani 21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.80 }, { label: "X", odds: 3.60 }, { label: "2", odds: 4.20 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.80 }, { label: "Under", odds: 2.00 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.75 }, { label: "NG", odds: 2.05 }] },
    ],
  },
  {
    id: "e8", league: "Champions League", leagueIcon: "🏆", home: "Real Madrid", away: "Bayern",
    time: "Domani 21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.20 }, { label: "X", odds: 3.40 }, { label: "2", odds: 3.10 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.70 }, { label: "Under", odds: 2.10 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.65 }, { label: "NG", odds: 2.20 }] },
    ],
  },
  {
    id: "e9", league: "Serie A", leagueIcon: "🇮🇹", home: "Roma", away: "Lazio",
    time: "LIVE 55'", live: true, minute: 55, scoreH: 1, scoreA: 1,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.80 }, { label: "X", odds: 2.90 }, { label: "2", odds: 2.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.90 }, { label: "Under", odds: 1.90 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.20 }, { label: "NG", odds: 4.50 }] },
    ],
  },
  {
    id: "e10", league: "Premier League", leagueIcon: "🏴", home: "Man United", away: "Chelsea",
    time: "15:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.50 }, { label: "X", odds: 3.30 }, { label: "2", odds: 2.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.85 }, { label: "Under", odds: 1.95 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.72 }, { label: "NG", odds: 2.08 }] },
    ],
  },
];

export function useSportsbook() {
  const { user, wallet } = useAuth();
  const [events, setEvents] = useState<SportEvent[]>(SEED_EVENTS);
  const [betslip, setBetslip] = useState<BetslipItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [placingBet, setPlacingBet] = useState(false);
  const supabase = createClient();

  const toggleBet = (event: SportEvent, marketName: string, selection: Selection) => {
    const key = `${event.id}-${marketName}-${selection.label}`;
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
      });
      setBetslip(filtered);
    }
  };

  const isSelected = (eventId: string, marketName: string, selectionLabel: string) => {
    return betslip.some(
      (b) => b.eventId === eventId && b.marketName === marketName && b.selection === selectionLabel
    );
  };

  const clearBetslip = () => setBetslip([]);

  const totalOdds = betslip.reduce((acc, b) => acc * b.odds, 1);

  const placeBet = async (stake: number): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: "Devi accedere per scommettere" };
    if (!wallet || wallet.balance < stake) return { success: false, error: "Saldo insufficiente" };
    if (betslip.length === 0) return { success: false, error: "Schedina vuota" };
    if (stake < 1) return { success: false, error: "Puntata minima: $1" };
    if (stake > 10000) return { success: false, error: "Puntata massima: $10,000" };

    setPlacingBet(true);

    try {
      // 1. Create bet record
      const betType = betslip.length === 1 ? "single" : betslip.length <= 3 ? "multi" : "system";
      const { data: bet, error: betError } = await supabase
        .from("bets")
        .insert({
          user_id: user.id,
          bet_type: betType,
          total_odds: parseFloat(totalOdds.toFixed(4)),
          stake,
          potential_win: parseFloat((stake * totalOdds).toFixed(2)),
          status: "open"
        })
        .select("id")
        .single();

      if (betError || !bet) {
        setPlacingBet(false);
        return { success: false, error: "Errore nel piazzamento: " + (betError?.message || "sconosciuto") };
      }

      // 2. Create bet legs (selections)
      const legs = betslip.map((b) => ({
        bet_id: bet.id,
        event_id: b.eventId,
        market_type: b.marketName,
        selection: b.selection,
        odds: b.odds,
        status: "open",
      }));

      const { error: legsError } = await supabase.from("bet_selections").insert(legs);

      

      // 3. Deduct from wallet
      const { error: walletError } = await supabase
        .from("wallets")
        .update({ balance: wallet.balance - stake })
        .eq("user_id", user.id);

      // 4. Create transaction record
      await supabase.from("transactions").insert({
        user_id: user.id,
        type: "bet",
        amount: -stake,
        currency: "USD",
        status: "completed",
        description: `Scommessa ${betType}: ${betslip.map(b => b.match).join(", ")}`,
        reference_id: bet.id,
        reference_type: "bet",
      });

      setBetslip([]);
      setPlacingBet(false);
      return { success: true };
    } catch (err: any) {
      setPlacingBet(false);
      return { success: false, error: err.message || "Errore imprevisto" };
    }
  };

  return {
    events,
    betslip,
    loading,
    placingBet,
    toggleBet,
    isSelected,
    clearBetslip,
    totalOdds,
    placeBet,
  };
}
