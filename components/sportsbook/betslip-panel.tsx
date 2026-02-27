"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BetslipItem, SportEvent } from "@/lib/hooks/use-sportsbook";

// ═══ COMBINATIONS UTILITY ═══

function factorial(n: number): number {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function comboCount(n: number, k: number): number {
  if (k > n || k < 0) return 0;
  return factorial(n) / (factorial(k) * factorial(n - k));
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const combo of rest) result.push([arr[i], ...combo]);
  }
  return result;
}

// ═══ PROPS ═══

interface BetslipPanelProps {
  betslip: BetslipItem[];
  allEvents: SportEvent[];
  totalOdds: number;
  placingBet: boolean;
  stake: string;
  setStake: (v: string) => void;
  onPlaceBet: () => void;
  onRemoveItem: (item: BetslipItem) => void;
  onClear: () => void;
  betMode: "auto" | "sistema";
  setBetMode: (m: "auto" | "sistema") => void;
  systemComboSize: number;
  setSystemComboSize: (k: number) => void;
  user?: any;
  wallet?: { balance: number } | null;
  msg?: { type: "success" | "error" | "warn"; text: string } | null;
  compact?: boolean; // mobile bottom sheet mode
}

// ═══ COMPONENT ═══

export function BetslipPanel({
  betslip,
  allEvents,
  totalOdds,
  placingBet,
  stake,
  setStake,
  onPlaceBet,
  onRemoveItem,
  onClear,
  betMode,
  setBetMode,
  systemComboSize,
  setSystemComboSize,
  user,
  wallet,
  msg,
  compact,
}: BetslipPanelProps) {
  const n = betslip.length;
  const canSystem = n >= 3;
  const isSystem = betMode === "sistema" && canSystem;

  // Compute sistema details
  const sistemaInfo = useMemo(() => {
    if (!isSystem || !stake) return null;
    const k = Math.min(systemComboSize, n - 1);
    const numCombos = comboCount(n, k);
    const totalStake = parseFloat(stake) || 0;
    const stakePerCombo = Math.floor((totalStake * 100) / numCombos) / 100;

    // Calculate min/max potential win
    const allCombos = combinations(betslip.map((b) => b.odds), k);
    let minWin = Infinity;
    let maxWin = 0;
    for (const combo of allCombos) {
      const comboOdds = combo.reduce((acc, o) => acc * o, 1);
      const win = stakePerCombo * comboOdds;
      if (win < minWin) minWin = win;
      if (win > maxWin) maxWin = win;
    }

    return {
      k,
      numCombos,
      stakePerCombo,
      actualTotalStake: parseFloat((stakePerCombo * numCombos).toFixed(2)),
      minWin: parseFloat(minWin.toFixed(2)),
      maxWin: parseFloat(maxWin.toFixed(2)),
      totalMaxWin: parseFloat((allCombos.reduce((sum, combo) => {
        const comboOdds = combo.reduce((acc, o) => acc * o, 1);
        return sum + stakePerCombo * comboOdds;
      }, 0)).toFixed(2)),
    };
  }, [isSystem, stake, systemComboSize, n, betslip]);

  // Available combo sizes (2 to N-1)
  const comboSizeOptions = useMemo(() => {
    if (!canSystem) return [];
    const opts = [];
    for (let k = 2; k < n; k++) {
      opts.push({ k, label: `${k}/${n}`, combos: comboCount(n, k) });
    }
    return opts;
  }, [n, canSystem]);

  // Bet type label for "auto" mode
  const betTypeLabel = n === 1 ? "Singola" : n === 2 ? "Doppia" : n === 3 ? "Tripla" : `Multipla (${n})`;

  const potentialWin = stake ? parseFloat(stake) * totalOdds : 0;

  if (betslip.length === 0) {
    if (compact) return null;
    return (
      <div className="p-6 text-center">
        <p className="text-xs text-gray-400">Clicca sulle quote</p>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "p-3"}>
      {/* ── Selections list ── */}
      <div className={compact ? "" : "max-h-[240px] overflow-y-auto"}>
        {betslip.map((b, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
            <div className="min-w-0 flex-1 mr-2">
              <div className={cn("font-semibold text-gray-800 truncate", compact ? "text-xs" : "text-[11px]")}>{b.match}</div>
              <div className="text-[9px] text-gray-400">{b.marketName}: {b.selection}</div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={cn("font-bold text-brand font-mono", compact ? "text-sm" : "text-xs")}>{b.odds.toFixed(2)}</span>
              <button onClick={() => onRemoveItem(b)} className="text-gray-300 hover:text-red-400 text-[10px]">&times;</button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Bet type tabs (when 3+ selections) ── */}
      {canSystem && (
        <div className="flex gap-1 mt-2 pt-2 border-t border-gray-200">
          <button
            onClick={() => setBetMode("auto")}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all",
              betMode === "auto"
                ? "bg-brand text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            )}
          >
            Multipla
          </button>
          <button
            onClick={() => setBetMode("sistema")}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all",
              betMode === "sistema"
                ? "bg-brand text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            )}
          >
            Sistema
          </button>
        </div>
      )}

      {/* ── Multipla summary ── */}
      {!isSystem && n > 1 && (
        <div className="flex justify-between text-xs mt-2 pt-2 border-t border-gray-200">
          <span className="text-gray-500">{betTypeLabel}</span>
          <span className="font-bold font-mono">{totalOdds.toFixed(2)}</span>
        </div>
      )}

      {/* ── Sistema combo selector ── */}
      {isSystem && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="text-[9px] text-gray-400 font-semibold uppercase mb-1.5">Tipo Sistema</div>
          <div className="flex flex-wrap gap-1">
            {comboSizeOptions.map((opt) => (
              <button
                key={opt.k}
                onClick={() => setSystemComboSize(opt.k)}
                className={cn(
                  "px-2.5 py-1 rounded text-[10px] font-bold transition-all",
                  systemComboSize === opt.k
                    ? "bg-brand text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {opt.label}
                <span className="text-[8px] opacity-70 ml-0.5">({opt.combos})</span>
              </button>
            ))}
          </div>
          {sistemaInfo && parseFloat(stake) > 0 && (
            <div className="mt-2 space-y-1 bg-gray-50 rounded-lg px-2.5 py-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Combo</span>
                <span className="font-bold font-mono">{sistemaInfo.numCombos}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Puntata/combo</span>
                <span className="font-bold font-mono">${sistemaInfo.stakePerCombo.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-500">Stake effettivo</span>
                <span className="font-bold font-mono">${sistemaInfo.actualTotalStake.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Stake input ── */}
      <div className="mt-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
          <input
            type="number"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            placeholder="Importo"
            className={cn(
              "w-full pl-6 pr-3 rounded-lg border border-gray-200 font-mono focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand",
              compact ? "py-2.5 text-sm" : "py-2 text-xs"
            )}
          />
        </div>
        <div className="flex gap-1 mt-1.5">
          {[5, 10, 25, 50, 100].map((v) => (
            <button key={v} onClick={() => setStake(String(v))}
              className="flex-1 py-1 rounded bg-gray-100 text-[9px] font-bold text-gray-500 hover:bg-gray-200">${v}</button>
          ))}
        </div>
      </div>

      {/* ── Potential win ── */}
      {stake && parseFloat(stake) > 0 && (
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
          <span className="text-[10px] text-gray-500">
            {isSystem ? "Vincita max" : "Vincita"}
          </span>
          <span className="text-base font-black text-emerald-500 font-mono">
            ${isSystem && sistemaInfo ? sistemaInfo.totalMaxWin.toFixed(2) : potentialWin.toFixed(2)}
          </span>
        </div>
      )}
      {isSystem && sistemaInfo && stake && parseFloat(stake) > 0 && (
        <div className="flex justify-between items-center text-[10px]">
          <span className="text-gray-400">Vincita min (1 combo)</span>
          <span className="font-bold text-gray-500 font-mono">${sistemaInfo.minWin.toFixed(2)}</span>
        </div>
      )}

      {/* ── Message ── */}
      {msg && (
        <div className={cn("mt-2 px-2 py-1.5 rounded text-[10px] font-semibold text-center",
          msg.type === "success" ? "bg-emerald-50 text-emerald-600" : msg.type === "warn" ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-600"
        )}>{msg.text}</div>
      )}

      {/* ── Login link ── */}
      {!user && !compact && (
        <a href="/login" className="block text-[10px] text-red-500 text-center mt-2 underline hover:text-red-700">Accedi per scommettere</a>
      )}

      {/* ── Place bet button ── */}
      <button
        onClick={onPlaceBet}
        disabled={placingBet || !user || !stake || parseFloat(stake) <= 0}
        className={cn(
          "w-full mt-2 rounded-xl text-white font-bold transition-all",
          compact ? "py-3 text-sm" : "py-2.5 text-sm",
          placingBet ? "bg-gray-400" : "bg-brand hover:bg-brand-dark",
          (!stake || parseFloat(stake) <= 0) && "opacity-50"
        )}
      >
        {placingBet ? "Piazzando..." : isSystem ? `Piazza Sistema ${systemComboSize}/${n}` : "Piazza Scommessa"}
      </button>
    </div>
  );
}
