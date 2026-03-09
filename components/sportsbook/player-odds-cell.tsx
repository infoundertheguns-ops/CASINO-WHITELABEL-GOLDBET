"use client";

import { cn } from "@/lib/utils";
import type { Selection } from "@/lib/hooks/use-sportsbook";

interface PlayerOddsCellProps {
  label: string;        // compact label: "1°M", "MP", "Pts"
  sel: Selection;
  active: boolean;
  onClick: () => void;
}

function getOddsDirection(sel: Selection): "up" | "down" | null {
  if (!sel.changedAt || sel.previousOdds == null) return null;
  if (Date.now() - sel.changedAt > 3000) return null;
  if (sel.odds > sel.previousOdds) return "up";
  if (sel.odds < sel.previousOdds) return "down";
  return null;
}

export function PlayerOddsCell({ label, sel, active, onClick }: PlayerOddsCellProps) {
  const dir = getOddsDirection(sel);
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center px-2 py-1 rounded border text-center min-w-[56px] transition-all",
        active
          ? "border-brand bg-brand/10 text-brand ring-1 ring-brand"
          : "border-gray-200 bg-gray-50 text-gray-800 hover:border-brand/50 hover:bg-orange-50",
        dir === "up" && "odds-up",
        dir === "down" && "odds-down"
      )}
    >
      <span className="text-[8px] text-gray-400 font-semibold leading-none">{label}</span>
      <span className={cn("text-xs font-bold", active && "text-brand")}>{sel.odds.toFixed(2)}</span>
    </button>
  );
}
