"use client";

import { useState } from "react";

interface PlayerQuickActionsProps {
  userId: string;
  isBlocked: boolean;
  kycStatus: string;
  onAction: () => void;
}

export function PlayerQuickActions({ userId, isBlocked, kycStatus, onAction }: PlayerQuickActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<any>(null);

  const handleBlock = async () => {
    if (!confirm(isBlocked ? "Sbloccare questo utente?" : "Bloccare questo utente?")) return;
    setLoading("block");
    try {
      await fetch("/api/admin/risk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bulk: true,
          ids: [],
          action: isBlocked ? "unblock_user" : "block_users",
          status: "resolved",
        }),
      });
      onAction();
    } finally { setLoading(null); }
  };

  const handleReduceLimits = async () => {
    const maxBet = prompt("Nuovo limite max bet ($):", "50");
    if (!maxBet) return;
    setLoading("limits");
    try {
      await fetch("/api/admin/risk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bulk: true, ids: [], action: "reduce_limits", status: "resolved",
          notes: `Limite manuale: $${maxBet}`,
        }),
      });
      onAction();
    } finally { setLoading(null); }
  };

  const handleAIAnalysis = async () => {
    setLoading("ai");
    try {
      // Get the user's most recent bet for analysis
      const res = await fetch(`/api/admin/risk?tab=player&player_id=${userId}`);
      const data = await res.json();
      const recentBet = data.bets?.[0];
      if (recentBet) {
        const aiRes = await fetch("/api/risk-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bet_id: recentBet.id, use_ai: true }),
        });
        const result = await aiRes.json();
        setAiResult(result);
      }
    } catch {} finally { setLoading(null); }
  };

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
      <h3 className="text-xs font-bold mb-3" style={{ color: "var(--admin-text)" }}>Azioni Rapide</h3>

      <div className="space-y-2">
        <button
          onClick={handleBlock}
          disabled={loading === "block"}
          className={`w-full px-3 py-2 rounded-lg text-[10px] font-bold ${
            isBlocked ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
          }`}
        >
          {loading === "block" ? "..." : isBlocked ? "Sblocca Account" : "Blocca Account"}
        </button>

        <button
          onClick={handleReduceLimits}
          disabled={loading === "limits"}
          className="w-full px-3 py-2 rounded-lg text-[10px] font-bold bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
        >
          {loading === "limits" ? "..." : "Riduci Limiti"}
        </button>

        <button
          onClick={handleAIAnalysis}
          disabled={loading === "ai"}
          className="w-full px-3 py-2 rounded-lg text-[10px] font-bold bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
        >
          {loading === "ai" ? "Analisi in corso..." : "Analisi AI Manuale"}
        </button>
      </div>

      {/* AI Result */}
      {aiResult && (
        <div className="mt-3 p-3 rounded-lg text-[10px]" style={{ background: "var(--admin-bg)", border: "1px solid var(--admin-border)" }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold" style={{ color: "var(--admin-text)" }}>AI Score: {aiResult.final_score}</span>
            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
              aiResult.final_level === "critical" ? "bg-red-500/20 text-red-400" :
              aiResult.final_level === "high" ? "bg-orange-500/20 text-orange-400" :
              "bg-yellow-500/20 text-yellow-400"
            }`}>{aiResult.final_level?.toUpperCase()}</span>
          </div>
          <p style={{ color: "var(--admin-text3)" }}>{aiResult.ai_analysis?.reasoning || aiResult.rule_analysis?.details}</p>
          {aiResult.ai_analysis?.recommended_actions && (
            <div className="mt-1 flex gap-1 flex-wrap">
              {aiResult.ai_analysis.recommended_actions.map((a: string, i: number) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[8px]">{a}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
