"use client";

import { cn } from "@/lib/utils";
import type { IppicaRunner, IppicaOdds } from "@/lib/types/ippica";

interface Props {
  runner: IppicaRunner;
  winnerOdds?: IppicaOdds;
  placeOdds?: IppicaOdds;
  onClickWinner?: () => void;
  onClickPlace?: () => void;
  isWinnerSelected?: boolean;
  isPlaceSelected?: boolean;
  showDetail?: boolean;
  isFinished?: boolean;
}

function OddsButton({
  odds, trend, onClick, isSelected, disabled,
}: {
  odds?: number; trend?: string; onClick?: () => void; isSelected?: boolean; disabled?: boolean;
}) {
  if (!odds || odds <= 0) return <td className="px-2 py-1.5 text-center text-xs text-gray-300">—</td>;

  return (
    <td className="px-1 py-1">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "w-full px-2 py-1.5 rounded text-sm font-mono font-semibold transition-all text-center",
          isSelected
            ? "bg-brand text-white ring-2 ring-brand/30"
            : "bg-gray-50 text-gray-800 hover:bg-brand/10 hover:text-brand",
          trend === "up" && !isSelected && "ring-1 ring-green-300",
          trend === "down" && !isSelected && "ring-1 ring-red-300",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {odds.toFixed(2)}
      </button>
    </td>
  );
}

export function RunnerRow({
  runner, winnerOdds, placeOdds,
  onClickWinner, onClickPlace,
  isWinnerSelected, isPlaceSelected,
  showDetail, isFinished,
}: Props) {
  if (runner.is_non_runner) {
    return (
      <tr className="text-gray-300 line-through">
        <td className="px-2 py-1.5 text-xs font-mono">{runner.runner_number}</td>
        <td className="px-2 py-1.5 text-sm" colSpan={showDetail ? 5 : 3}>
          {runner.name} <span className="text-[10px] font-bold text-red-400 no-underline">NP</span>
        </td>
        <td className="px-2 py-1.5 text-center text-xs">—</td>
        <td className="px-2 py-1.5 text-center text-xs">—</td>
      </tr>
    );
  }

  return (
    <tr className={cn(
      "border-b border-gray-50 hover:bg-gray-50/50 transition-colors",
      isFinished && runner.finish_position === 1 && "bg-green-50/50",
      isFinished && runner.finish_position && runner.finish_position <= 3 && "bg-blue-50/30",
    )}>
      {/* Number */}
      <td className="px-2 py-1.5 text-xs font-mono font-bold text-gray-500 w-8 text-center">
        {isFinished && runner.finish_position ? (
          <span className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold",
            runner.finish_position === 1 && "bg-yellow-400 text-yellow-900",
            runner.finish_position === 2 && "bg-gray-300 text-gray-700",
            runner.finish_position === 3 && "bg-orange-300 text-orange-800",
            runner.finish_position > 3 && "bg-gray-100 text-gray-500",
          )}>
            {runner.finish_position}
          </span>
        ) : runner.runner_number}
      </td>

      {/* Name */}
      <td className="px-2 py-1.5">
        <div className="text-sm font-semibold text-gray-800">{runner.name}</div>
        <div className="text-[10px] text-gray-400">
          {runner.jockey && <span>{runner.jockey}</span>}
          {runner.trainer && <span> · {runner.trainer}</span>}
        </div>
      </td>

      {/* Form */}
      <td className="px-2 py-1.5 text-xs font-mono text-gray-500 hidden sm:table-cell">
        {runner.form || "—"}
      </td>

      {/* Weight (only in detail view) */}
      {showDetail && (
        <td className="px-2 py-1.5 text-xs text-gray-500 hidden md:table-cell">
          {runner.weight_text || "—"}
        </td>
      )}

      {/* Rating (only in detail view) */}
      {showDetail && (
        <td className="px-2 py-1.5 text-xs font-mono text-gray-500 hidden md:table-cell text-center">
          {runner.rating || "—"}
        </td>
      )}

      {/* Winner odds */}
      <OddsButton
        odds={winnerOdds?.odds}
        trend={winnerOdds?.trend}
        onClick={onClickWinner}
        isSelected={isWinnerSelected}
        disabled={isFinished || winnerOdds?.status === "suspended"}
      />

      {/* Place odds */}
      <OddsButton
        odds={placeOdds?.odds}
        trend={placeOdds?.trend}
        onClick={onClickPlace}
        isSelected={isPlaceSelected}
        disabled={isFinished || placeOdds?.status === "suspended"}
      />
    </tr>
  );
}
