"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";

export interface CasinoGame {
  id: string;
  name: string;
  provider: string;
  category: "slot" | "live" | "table" | "crash";
  color: string;
  icon: string;
  hot: boolean;
  new: boolean;
  rtp?: number;
  minBet?: number;
  maxBet?: number;
}

export interface GameSession {
  id: string;
  game_name: string;
  provider: string;
  status: "active" | "closed";
  total_bet: number;
  total_win: number;
  rounds: number;
  started_at: string;
  ended_at?: string;
}

const GAMES: CasinoGame[] = [
  { id: "g1", name: "Sweet Bonanza", provider: "Pragmatic Play", category: "slot", color: "from-pink-500 to-orange-400", icon: "🍬", hot: true, new: false, rtp: 96.48, minBet: 0.20, maxBet: 125 },
  { id: "g2", name: "Gates of Olympus", provider: "Pragmatic Play", category: "slot", color: "from-yellow-500 to-blue-500", icon: "⚡", hot: true, new: false, rtp: 96.50, minBet: 0.20, maxBet: 125 },
  { id: "g3", name: "Crazy Time", provider: "Evolution", category: "live", color: "from-yellow-400 to-red-500", icon: "🎡", hot: true, new: false, rtp: 95.50 },
  { id: "g4", name: "Aviator", provider: "Spribe", category: "crash", color: "from-red-600 to-red-400", icon: "✈️", hot: true, new: false, rtp: 97.00, minBet: 0.10, maxBet: 100 },
  { id: "g5", name: "Lightning Roulette", provider: "Evolution", category: "live", color: "from-yellow-500 to-amber-600", icon: "⚡", hot: false, new: false, rtp: 97.30 },
  { id: "g6", name: "Sugar Rush", provider: "Pragmatic Play", category: "slot", color: "from-pink-400 to-purple-500", icon: "🧁", hot: false, new: true, rtp: 96.50, minBet: 0.20, maxBet: 125 },
  { id: "g7", name: "Big Bass Splash", provider: "Pragmatic Play", category: "slot", color: "from-blue-500 to-teal-400", icon: "🐟", hot: false, new: false, rtp: 96.71, minBet: 0.10, maxBet: 250 },
  { id: "g8", name: "Starlight Princess", provider: "Pragmatic Play", category: "slot", color: "from-purple-500 to-pink-400", icon: "👸", hot: false, new: false, rtp: 96.50 },
  { id: "g9", name: "Book of Dead", provider: "Play'n GO", category: "slot", color: "from-yellow-700 to-amber-500", icon: "📖", hot: false, new: false, rtp: 96.21 },
  { id: "g10", name: "Wanted Dead or Wild", provider: "Hacksaw Gaming", category: "slot", color: "from-amber-700 to-orange-500", icon: "🤠", hot: false, new: true, rtp: 96.38 },
  { id: "g11", name: "Mental", provider: "NoLimit City", category: "slot", color: "from-gray-800 to-purple-900", icon: "🧠", hot: false, new: true, rtp: 96.08 },
  { id: "g12", name: "Monopoly Live", provider: "Evolution", category: "live", color: "from-green-600 to-emerald-400", icon: "🎩", hot: false, new: false, rtp: 96.23 },
  { id: "g13", name: "Mines", provider: "Spribe", category: "crash", color: "from-gray-700 to-gray-500", icon: "💣", hot: false, new: false, rtp: 97.00, minBet: 0.10, maxBet: 100 },
  { id: "g14", name: "Plinko", provider: "Spribe", category: "crash", color: "from-blue-600 to-cyan-400", icon: "⚪", hot: false, new: false, rtp: 97.00 },
  { id: "g15", name: "Dice", provider: "Spribe", category: "crash", color: "from-green-500 to-emerald-400", icon: "🎲", hot: false, new: false, rtp: 97.00 },
  { id: "g16", name: "Blackjack VIP", provider: "Evolution", category: "table", color: "from-green-800 to-green-600", icon: "🃏", hot: false, new: false, rtp: 99.50 },
  { id: "g17", name: "Baccarat", provider: "Evolution", category: "table", color: "from-red-800 to-red-600", icon: "🎴", hot: false, new: false, rtp: 98.94 },
  { id: "g18", name: "European Roulette", provider: "Play'n GO", category: "table", color: "from-green-700 to-emerald-500", icon: "🎰", hot: false, new: false, rtp: 97.30 },
];

export function useCasino() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const supabase = createClient();

  const games = GAMES;

  const fetchSessions = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setSessions(data);
  }, [user]);

  const launchGame = async (game: CasinoGame, mode: "real" | "demo"): Promise<{ success: boolean; sessionId?: string }> => {
    if (mode === "demo") {
      return { success: true, sessionId: "demo-" + game.id };
    }

    if (!user) return { success: false };

    // Find or create provider
    const { data: provider } = await supabase
      .from("casino_providers")
      .select("id")
      .eq("name", game.provider)
      .single();

    let providerId = provider?.id;
    if (!providerId) {
      const { data: newP } = await supabase
        .from("casino_providers")
        .insert({ name: game.provider, is_active: true })
        .select("id")
        .single();
      providerId = newP?.id;
    }

    // Find or create game record
    const { data: dbGame } = await supabase
      .from("casino_games")
      .select("id")
      .eq("name", game.name)
      .single();

    let gameId = dbGame?.id;
    if (!gameId) {
      const { data: newG } = await supabase
        .from("casino_games")
        .insert({
          provider_id: providerId,
          name: game.name,
          slug: game.id,
          category: game.category,
          rtp: game.rtp || 96,
          is_active: true,
        })
        .select("id")
        .single();
      gameId = newG?.id;
    }

    // Create session
    const { data: session, error } = await supabase
      .from("game_sessions")
      .insert({
        user_id: user.id,
        game_id: gameId,
        game_name: game.name,
        provider: game.provider,
        status: "active",
        total_bet: 0,
        total_win: 0,
        rounds: 0,
      })
      .select("id")
      .single();

    if (error || !session) return { success: false };

    await fetchSessions();
    return { success: true, sessionId: session.id };
  };

  const closeSession = async (sessionId: string) => {
    await supabase
      .from("game_sessions")
      .update({ status: "closed", ended_at: new Date().toISOString() })
      .eq("id", sessionId);
    setActiveSession(null);
    await fetchSessions();
  };

  useEffect(() => {
    if (user) fetchSessions();
  }, [user, fetchSessions]);

  return { games, sessions, activeSession, launchGame, closeSession, fetchSessions };
}
