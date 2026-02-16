"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminRiskAgent() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [flaggedBets, setFlaggedBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: flags } = await supabase.from("risk_flags").select("*, users(username)").order("created_at", { ascending: false }).limit(20);
    setAlerts(flags || []);
    const { data: bets } = await supabase.from("bets").select("*, users(username)").not("risk_score", "is", null).order("risk_score", { ascending: false }).limit(20);
    setFlaggedBets(bets || []);
    setLoading(false);
  };

  const runAnalysis = async (betId: string) => {
    setAnalyzing(betId);
    setAnalysisResult(null);
    try {
      const res = await fetch("/api/risk-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bet_id: betId, use_ai: false }) });
      const data = await res.json();
      setAnalysisResult(data);
      await loadData();
    } catch { setAnalysisResult({ error: "Errore analisi" }); }
    setAnalyzing(null);
  };

  const resolveAlert = async (id: string, status: string) => {
    await supabase.from("risk_flags").update({ status, resolved_at: new Date().toISOString() }).eq("id", id);
    setAlerts(alerts.map(a => a.id === id ? { ...a, status } : a));
  };

  const sevColor = (s: string) => s === "critical" ? "bg-red-500/20 text-red-400" : s === "high" ? "bg-orange-500/20 text-orange-400" : s === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400";

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">AI Risk Agent</h1>
      <p className="text-sm text-gray-500 mb-6">Analisi rischio automatizzata con regole + Claude AI</p>

      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "ALERT APERTI", value: alerts.filter(a => a.status === "open").length, color: "text-red-400" },
          { label: "CRITICAL", value: alerts.filter(a => a.severity === "critical").length, color: "text-red-500" },
          { label: "BETS FLAGGED", value: flaggedBets.length, color: "text-orange-400" },
          { label: "AVG RISK", value: flaggedBets.length > 0 ? (flaggedBets.reduce((s, b) => s + (b.risk_score || 0), 0) / flaggedBets.length).toFixed(0) : "—", color: "text-yellow-400" },
        ].map((k, i) => (
          <div key={i} className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
            <div className="text-[10px] text-gray-500">{k.label}</div>
            <div className={cn("text-lg font-black font-mono", k.color)}>{k.value}</div>
          </div>
        ))}
      </div>

      {analysisResult && (
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4 mb-4">
          <div className="flex justify-between items-start mb-2">
            <span className="text-sm font-bold text-white">Risultato Analisi</span>
            <button onClick={() => setAnalysisResult(null)} className="text-gray-500 hover:text-white">✕</button>
          </div>
          {analysisResult.error ? (
            <div className="text-red-400 text-xs">{analysisResult.error}</div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className={cn("px-2 py-1 rounded text-xs font-bold", sevColor(analysisResult.rule_analysis?.level || "low"))}>
                  SCORE: {analysisResult.rule_analysis?.score} — {analysisResult.rule_analysis?.level?.toUpperCase()}
                </span>
                <span className="text-xs text-gray-400">{analysisResult.action_taken?.toUpperCase()}</span>
              </div>
              <div className="text-xs text-gray-300 mb-1">{analysisResult.rule_analysis?.recommendation}</div>
              <div className="text-[10px] text-gray-500">{analysisResult.rule_analysis?.details}</div>
              {analysisResult.rule_analysis?.flags?.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {analysisResult.rule_analysis.flags.map((f: string, i: number) => (
                    <span key={i} className="px-2 py-0.5 bg-red-500/10 text-red-400 text-[9px] font-bold rounded">{f}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800"><span className="text-sm font-bold text-white">Risk Alerts</span></div>
          {alerts.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">Nessun alert</div> : (
            <div className="max-h-[500px] overflow-y-auto">
              {alerts.map(a => (
                <div key={a.id} className="px-4 py-3 border-b border-gray-800/50 hover:bg-white/5">
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold", sevColor(a.severity))}>{a.severity?.toUpperCase()}</span>
                      <span className="text-xs text-white">{a.users?.username || "—"}</span>
                    </div>
                    <span className={cn("text-[8px] font-bold", a.status === "open" ? "text-yellow-400" : "text-gray-500")}>{a.status?.toUpperCase()}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mb-2">{a.description}</p>
                  {a.status === "open" && (
                    <div className="flex gap-1">
                      <button onClick={() => resolveAlert(a.id, "resolved")} className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-bold">✓ Risolvi</button>
                      <button onClick={() => resolveAlert(a.id, "dismissed")} className="px-2 py-0.5 rounded bg-gray-500/20 text-gray-400 text-[8px] font-bold">Ignora</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800"><span className="text-sm font-bold text-white">Scommesse Flaggate</span></div>
          {flaggedBets.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">Nessuna scommessa con risk score</div> : (
            <div className="max-h-[500px] overflow-y-auto">
              {flaggedBets.map(b => (
                <div key={b.id} className="px-4 py-3 border-b border-gray-800/50 hover:bg-white/5">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs text-white">{b.users?.username || "—"}</span>
                      <span className="text-[10px] text-gray-500 ml-2">${b.stake?.toFixed(2)} @ {b.total_odds?.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold",
                        (b.risk_score || 0) > 75 ? "bg-red-500/20 text-red-400" :
                        (b.risk_score || 0) > 50 ? "bg-orange-500/20 text-orange-400" :
                        "bg-yellow-500/20 text-yellow-400"
                      )}>RISK: {b.risk_score}</span>
                      <button onClick={() => runAnalysis(b.id)} disabled={analyzing === b.id}
                        className="px-2 py-0.5 rounded bg-brand/20 text-brand text-[8px] font-bold">{analyzing === b.id ? "..." : "Analizza"}</button>
                    </div>
                  </div>
                  {b.risk_flags?.length > 0 && (
                    <div className="flex gap-1 mt-1">{b.risk_flags.map((f: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[8px] rounded">{f}</span>
                    ))}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
