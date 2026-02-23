"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface AIAnalysisPanelProps {
  onAnalyze: (id: string, type: "bet" | "user") => Promise<any>;
}

const sevColor = (s: string) =>
  s === "critical" ? "bg-red-500/20 text-red-400" :
  s === "high" ? "bg-orange-500/20 text-orange-400" :
  s === "medium" ? "bg-yellow-500/20 text-yellow-400" :
  "bg-green-500/20 text-green-400";

export function AIAnalysisPanel({ onAnalyze }: AIAnalysisPanelProps) {
  const [inputId, setInputId] = useState("");
  const [inputType, setInputType] = useState<"bet" | "user">("bet");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!inputId.trim()) return;
    setAnalyzing(true);
    setResult(null);
    setError(null);
    try {
      const res = await onAnalyze(inputId.trim(), inputType);
      setResult(res);
    } catch (err: any) {
      setError(err.message || "Errore durante l'analisi");
    }
    setAnalyzing(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
        <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>Analisi AI Manuale</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-[10px] block mb-1" style={{ color: "var(--admin-text4)" }}>ID Scommessa</label>
            <input
              type="text"
              value={inputId}
              onChange={e => setInputId(e.target.value)}
              placeholder="Inserisci bet ID..."
              className="w-full border border-gray-700 rounded-lg px-3 py-2 text-sm placeholder-gray-600 focus:border-brand focus:outline-none"
              style={{ background: "var(--admin-input)", color: "var(--admin-text)" }}
            />
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--admin-text4)" }}>Tipo</label>
            <select
              value={inputType}
              onChange={e => setInputType(e.target.value as "bet" | "user")}
              className="border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-brand focus:outline-none"
              style={{ background: "var(--admin-input)", color: "var(--admin-text)" }}
            >
              <option value="bet">Scommessa</option>
              <option value="user">Utente</option>
            </select>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !inputId.trim()}
            className="px-4 py-2 rounded-lg bg-brand/20 text-brand text-sm font-bold hover:bg-brand/30 disabled:opacity-50"
          >
            {analyzing ? "Analisi..." : "Analizza con AI"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <span className="text-red-400 text-xs">{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold" style={{ color: "var(--admin-text)" }}>Risultato Analisi</span>
            <button onClick={() => setResult(null)} className="text-gray-500 hover:text-white text-sm">&#10005;</button>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <span className={cn("px-3 py-1.5 rounded-lg text-xs font-bold",
              sevColor(result.final_level || result.rule_analysis?.level || "low")
            )}>
              SCORE: {result.final_score ?? result.rule_analysis?.score} — {(result.final_level || result.rule_analysis?.level || "low").toUpperCase()}
            </span>
            <span className={cn("px-2 py-1 rounded text-[9px] font-bold",
              result.action_taken === "blocked" ? "bg-red-500/20 text-red-400" :
              result.action_taken === "flagged" ? "bg-orange-500/20 text-orange-400" :
              "bg-green-500/20 text-green-400"
            )}>
              {(result.action_taken || "").toUpperCase()}
            </span>
          </div>

          {/* Rule analysis */}
          <div className="mb-4">
            <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--admin-text4)" }}>REGOLE</div>
            <div className="text-xs" style={{ color: "var(--admin-text2)" }}>{result.rule_analysis?.recommendation}</div>
            <div className="text-[10px] mt-1" style={{ color: "var(--admin-text4)" }}>{result.rule_analysis?.details}</div>
            {result.rule_analysis?.flags?.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {result.rule_analysis.flags.map((f: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 bg-red-500/10 text-red-400 text-[9px] font-bold rounded">{f}</span>
                ))}
              </div>
            )}
          </div>

          {/* AI analysis */}
          {result.ai_analysis && (
            <div className="pt-4" style={{ borderTop: "1px solid var(--admin-border)" }}>
              <div className="text-[10px] font-semibold mb-2" style={{ color: "var(--admin-text4)" }}>ANALISI AI</div>
              <div className="text-xs mb-2" style={{ color: "var(--admin-text2)" }}>{result.ai_analysis.reasoning}</div>
              <div className="grid grid-cols-2 gap-3 text-[10px]">
                <div>
                  <span style={{ color: "var(--admin-text4)" }}>Player Classification</span>
                  <div className="font-bold" style={{ color: "var(--admin-text)" }}>{result.ai_analysis.player_classification}</div>
                </div>
                <div>
                  <span style={{ color: "var(--admin-text4)" }}>Confidence</span>
                  <div className="font-mono" style={{ color: "var(--admin-text)" }}>{((result.ai_analysis.confidence || 0) * 100).toFixed(0)}%</div>
                </div>
              </div>
              {result.ai_analysis.recommended_actions?.length > 0 && (
                <div className="mt-3">
                  <span className="text-[10px]" style={{ color: "var(--admin-text4)" }}>Azioni Raccomandate</span>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {result.ai_analysis.recommended_actions.map((a: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-brand/10 text-brand text-[9px] rounded">{a}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions executed */}
          {result.actions_executed?.length > 0 && (
            <div className="pt-3 mt-3" style={{ borderTop: "1px solid var(--admin-border)" }}>
              <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--admin-text4)" }}>AZIONI ESEGUITE</div>
              <div className="flex gap-1 flex-wrap">
                {result.actions_executed.map((a: string, i: number) => (
                  <span key={i} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[9px] font-bold rounded">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
