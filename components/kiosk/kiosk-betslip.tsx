"use client";

import { useState } from "react";
import type { BetslipItem } from "@/lib/hooks/use-sportsbook";

interface KioskBetslipProps {
  betslip: BetslipItem[];
  toggleBet: (event: any, marketName: string, selection: any) => void;
  clearBetslip: () => void;
  totalOdds: number;
  placeBet: (stake: number) => Promise<any>;
  placingBet: boolean;
}

export default function KioskBetslip({
  betslip,
  toggleBet,
  clearBetslip,
  totalOdds,
  placeBet,
  placingBet,
}: KioskBetslipProps) {
  const [stake, setStake] = useState("");
  const [showNumpad, setShowNumpad] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const stakeNum = parseFloat(stake) || 0;
  const potentialWin = stakeNum * totalOdds;

  const handlePlaceBet = async () => {
    if (stakeNum <= 0 || betslip.length === 0) return;
    setMessage(null);
    const result = await placeBet(stakeNum);
    if (result.success) {
      setStake("");
      setMessage({ text: "Scommessa piazzata!", error: false });
      setTimeout(() => setMessage(null), 3000);
    } else {
      setMessage({ text: result.error || "Errore", error: true });
    }
  };

  const removeItem = (item: BetslipItem) => {
    // We need to construct a minimal event + selection to toggle off
    toggleBet(
      { id: item.eventId, home: "", away: "", markets: [] } as any,
      item.marketName,
      { label: item.selection, odds: item.odds } as any
    );
  };

  const numpadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "C"];

  const handleNumpadKey = (key: string) => {
    if (key === "C") {
      setStake("");
    } else if (key === ".") {
      if (!stake.includes(".")) setStake(stake + ".");
    } else {
      setStake(stake + key);
    }
  };

  if (betslip.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2" style={{ background: "var(--midas-red)" }}>
          <span className="text-white font-bold text-[14px] uppercase" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
            Schedina
          </span>
          <span className="text-white/70 text-[12px]">0</span>
        </div>
        {/* Empty state */}
        <div className="flex-1 flex items-center justify-center" style={{ background: "var(--midas-bg)" }}>
          <div className="text-white/30 text-[12px] text-center" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
            Seleziona una quota<br />per aggiungere alla schedina
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--midas-bg)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0" style={{ background: "var(--midas-red)" }}>
        <span className="text-white font-bold text-[14px] uppercase" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
          Schedina
        </span>
        <div className="flex items-center gap-2">
          <span className="text-white/70 text-[12px]">{betslip.length}</span>
          <button
            onClick={clearBetslip}
            className="text-white/70 text-[10px] uppercase hover:text-white border-0 bg-transparent cursor-pointer"
          >
            Svuota
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {betslip.map((item, i) => (
          <div
            key={`${item.eventId}-${item.marketName}-${item.selection}`}
            className="mx-1 mt-1 rounded-[3px] p-2 relative"
            style={{ background: "var(--midas-slip-item)" }}
          >
            {/* Remove button */}
            <button
              onClick={() => removeItem(item)}
              className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] border-0 cursor-pointer"
              style={{ background: "var(--midas-slip-remove)" }}
            >
              ×
            </button>
            {/* Event name */}
            <div className="text-[10px] text-[#333] leading-tight pr-4" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
              {item.match}
            </div>
            {/* Selection */}
            <div className="flex items-center justify-between mt-1">
              <div>
                <span className="text-[11px] font-bold" style={{ color: "var(--midas-red)", fontFamily: "'Open Sans Condensed', sans-serif" }}>
                  {item.selection}
                </span>
                <span className="text-[9px] text-[#666] ml-1">{item.marketName}</span>
              </div>
              <span className="text-[13px] font-bold text-black" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
                {item.odds.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Message */}
      {message && (
        <div
          className="mx-1 px-2 py-1 rounded text-[11px] text-center font-bold"
          style={{
            background: message.error ? "var(--midas-slip-error)" : "var(--midas-placebet)",
            color: message.error ? "black" : "white",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-white/10 p-2">
        {/* Total odds */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-white/60 text-[10px] uppercase" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
            Quota totale
          </span>
          <span className="text-white font-bold text-[16px]" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
            {totalOdds.toFixed(2)}
          </span>
        </div>

        {/* Stake input */}
        <div className="flex gap-1 mb-1.5">
          <input
            type="text"
            value={stake}
            onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Importo"
            className="flex-1 px-2 py-1.5 text-[14px] rounded-[3px] border-0 text-black"
            style={{ fontFamily: "'Open Sans Condensed', sans-serif", background: "white" }}
            onFocus={() => setShowNumpad(true)}
          />
          <button
            onClick={() => setShowNumpad(!showNumpad)}
            className="px-2 py-1.5 rounded-[3px] text-white text-[12px] border-0 cursor-pointer"
            style={{ background: "var(--midas-enable)" }}
          >
            ⌨
          </button>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-1 mb-1.5">
          {[5, 10, 20, 50].map((amt) => (
            <button
              key={amt}
              className="flex-1 py-1 rounded-[3px] text-white text-[11px] font-bold border-0 cursor-pointer"
              style={{ background: "var(--midas-enable)", fontFamily: "'Open Sans Condensed', sans-serif" }}
              onClick={() => setStake(String(amt))}
            >
              {amt}€
            </button>
          ))}
        </div>

        {/* Numpad */}
        {showNumpad && (
          <div className="grid grid-cols-3 gap-1 mb-1.5">
            {numpadKeys.map((key) => (
              <button
                key={key}
                onClick={() => handleNumpadKey(key)}
                className="py-2 rounded-[3px] text-white text-[14px] font-bold border-0 cursor-pointer"
                style={{
                  background: key === "C" ? "var(--midas-slip-remove)" : "var(--midas-numkey)",
                  fontFamily: "'Open Sans Condensed', sans-serif",
                }}
              >
                {key}
              </button>
            ))}
            <button
              onClick={() => setShowNumpad(false)}
              className="col-span-3 py-1.5 rounded-[3px] text-white text-[12px] font-bold border-0 cursor-pointer"
              style={{ background: "var(--midas-placebet)", fontFamily: "'Open Sans Condensed', sans-serif" }}
            >
              FATTO
            </button>
          </div>
        )}

        {/* Potential win */}
        {stakeNum > 0 && (
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-white/60 text-[10px] uppercase" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
              Vincita potenziale
            </span>
            <span className="text-[var(--midas-placebet)] font-bold text-[14px]" style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}>
              {potentialWin.toFixed(2)} €
            </span>
          </div>
        )}

        {/* Place bet button */}
        <button
          onClick={handlePlaceBet}
          disabled={placingBet || stakeNum <= 0}
          className="w-full py-2.5 rounded-[3px] text-white font-bold text-[15px] uppercase border-0 cursor-pointer disabled:opacity-50"
          style={{ background: "var(--midas-placebet)", fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          {placingBet ? "Piazzamento..." : "Piazza Scommessa"}
        </button>

        {/* Book bet button */}
        <button
          className="w-full py-2 rounded-[3px] text-white font-bold text-[12px] uppercase border-0 cursor-pointer mt-1"
          style={{ background: "var(--midas-bookbet)", fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          Prenota Scommessa
        </button>
      </div>
    </div>
  );
}
