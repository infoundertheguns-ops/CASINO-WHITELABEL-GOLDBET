"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface LiveBet {
  id: string;
  username: string;
  stake: number;
  total_odds: number;
  risk_score: number | null;
  bet_type: string;
  is_live: boolean;
  selections: string;
  created_at: string;
}

export function LiveBetTicker() {
  const [bets, setBets] = useState<LiveBet[]>([]);
  const supabase = createClient();

  useEffect(() => {
    // Initial load — last 10 bets
    const load = async () => {
      try {
        const res = await fetch("/api/admin/risk?tab=overview");
        const data = await res.json();
        // We'll get latest bets from a dedicated lightweight fetch
        const betsRes = await fetch("/api/admin/stats?recent_bets=10");
        if (betsRes.ok) {
          const betsData = await betsRes.json();
          setBets(betsData.recent_bets || []);
        }
      } catch {}
    };
    load();

    // Realtime subscription for new bets
    const channel = supabase
      .channel("live-bet-ticker")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bets" }, (payload) => {
        const bet = payload.new as any;
        const entry: LiveBet = {
          id: bet.id,
          username: "—",
          stake: bet.stake || 0,
          total_odds: bet.total_odds || 1,
          risk_score: bet.risk_score,
          bet_type: bet.bet_type || "singola",
          is_live: bet.is_live || false,
          selections: "",
          created_at: bet.created_at,
        };
        setBets(prev => [entry, ...prev].slice(0, 15));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  if (bets.length === 0) {
    return (
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
        <h3 className="text-xs font-bold mb-2" style={{ color: "var(--admin-text)" }}>Live Bet Ticker</h3>
        <p className="text-[10px]" style={{ color: "var(--admin-text4)" }}>In attesa di nuove scommesse...</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
      <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid var(--admin-border)" }}>
        <h3 className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1.5" />
          Live Bet Ticker
        </h3>
        <span className="text-[9px]" style={{ color: "var(--admin-text4)" }}>{bets.length} recenti</span>
      </div>

      <div className="max-h-[260px] overflow-y-auto">
        {bets.map((b, i) => (
          <div
            key={b.id || i}
            className={cn("px-4 py-2 flex items-center gap-3 text-[10px] border-b", i === 0 && "bg-brand/5")}
            style={{ borderColor: "var(--admin-border)" }}
          >
            {/* Live badge */}
            {b.is_live && (
              <span className="px-1 py-0.5 rounded text-[7px] font-bold bg-red-500/20 text-red-400">LIVE</span>
            )}

            {/* Username */}
            <span className="font-bold truncate max-w-[70px]" style={{ color: "var(--admin-text)" }}>
              {b.username}
            </span>

            {/* Stake + odds */}
            <span className="font-mono" style={{ color: "var(--admin-text3)" }}>
              €{b.stake.toFixed(0)} @{b.total_odds.toFixed(2)}
            </span>

            {/* Risk indicator */}
            {b.risk_score != null && b.risk_score > 0 && (
              <span className={cn("px-1 py-0.5 rounded text-[7px] font-bold",
                b.risk_score > 75 ? "bg-red-500/20 text-red-400" :
                b.risk_score > 50 ? "bg-orange-500/20 text-orange-400" :
                b.risk_score > 25 ? "bg-yellow-500/20 text-yellow-400" :
                "bg-green-500/20 text-green-400"
              )}>R:{b.risk_score}</span>
            )}

            {/* Time */}
            <span className="ml-auto whitespace-nowrap" style={{ color: "var(--admin-text4)" }}>
              {new Date(b.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
