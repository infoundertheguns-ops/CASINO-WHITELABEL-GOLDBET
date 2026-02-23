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
      <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
        <h3 className="text-sm font-bold text-white mb-4">Analisi AI Manuale</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-[10px] text-gray-500 block mb-1">ID Scommessa</label>
            <input
              type="text"
              value={inputId}
              onChange={e => setInputId(e.target.value)}
              placeholder="Inserisci bet ID..."
              className="w-full bg-[#0a0914] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Tipo</label>
            <select
              value={inputType}
              onChange={e => setInputType(e.target.value as "bet" | "user")}
              className="bg-[#0a0914] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
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
        <div className="bg-[#12111a] rounded-xl border border-gray-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold text-white">Risultato Analisi</span>
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
            <div className="text-[10px] text-gray-500 font-semibold mb-1">REGOLE</div>
            <div className="text-xs text-gray-300">{result.rule_analysis?.recommendation}</div>
            <div className="text-[10px] text-gray-500 mt-1">{result.rule_analysis?.details}</div>
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
            <div className="border-t border-gray-800 pt-4">
              <div className="text-[10px] text-gray-500 font-semibold mb-2">ANALISI AI</div>
              <div className="text-xs text-gray-300 mb-2">{result.ai_analysis.reasoning}</div>
              <div className="grid grid-cols-2 gap-3 text-[10px]">
                <div>
                  <span className="text-gray-500">Player Classification</span>
                  <div className="text-white font-bold">{result.ai_analysis.player_classification}</div>
                </div>
                <div>
                  <span className="text-gray-500">Confidence</span>
                  <div className="text-white font-mono">{((result.ai_analysis.confidence || 0) * 100).toFixed(0)}%</div>
                </div>
              </div>
              {result.ai_analysis.recommended_actions?.length > 0 && (
                <div className="mt-3">
                  <span className="text-[10px] text-gray-500">Azioni Raccomandate</span>
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
            <div className="border-t border-gray-800 pt-3 mt-3">
              <div className="text-[10px] text-gray-500 font-semibold mb-1">AZIONI ESEGUITE</div>
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
