"use client";

import type { MatchEvent } from "@/lib/hooks/use-sportsbook";

interface MatchTimelineProps {
  matchEvents: MatchEvent[];
  minute: number;
  home: string;
  away: string;
  period?: string;
}

// Map events to timeline markers
function getMarkerIcon(type: string): string {
  switch (type) {
    case "goal": return "\u26BD";
    case "yellow_card": return "\uD83D\uDFE8";
    case "red_card": return "\uD83D\uDFE5";
    case "substitution": return "\uD83D\uDD04";
    default: return "";
  }
}

function clampMinute(min: number, total: number): number {
  return Math.min(Math.max(min, 0), total) / total * 100;
}

export function MatchTimeline({ matchEvents, minute, home, away, period }: MatchTimelineProps) {
  // Total match duration (90 or 120 with extra time)
  const hasExtraTime = period === "EXTRA_FIRST_HALF" || period === "EXTRA_SECOND_HALF" || period === "PENALTY";
  const totalMinutes = hasExtraTime ? 120 : 90;
  const halfMinute = hasExtraTime ? 45 : 45;

  const currentPct = clampMinute(minute, totalMinutes);

  const homeEvents = matchEvents.filter((e) => e.team === "home" && getMarkerIcon(e.type));
  const awayEvents = matchEvents.filter((e) => e.team === "away" && getMarkerIcon(e.type));

  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
      {/* Team labels */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold text-gray-700 uppercase truncate max-w-[40%]">{home}</span>
        <span className="text-[10px] font-bold text-gray-700 uppercase truncate max-w-[40%] text-right">{away}</span>
      </div>

      {/* Home timeline */}
      <div className="relative h-5 mb-0.5">
        {/* Track */}
        <div className="absolute top-1/2 left-0 right-0 h-[3px] -translate-y-1/2 bg-gray-200 rounded-full" />
        {/* Progress */}
        <div
          className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 bg-gray-400 rounded-full transition-all duration-1000"
          style={{ width: `${currentPct}%` }}
        />
        {/* Half-time divider */}
        <div
          className="absolute top-0 bottom-0 w-px bg-gray-300"
          style={{ left: `${(halfMinute / totalMinutes) * 100}%` }}
        />
        {/* Current position indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-brand shadow-sm transition-all duration-1000 z-10"
          style={{ left: `${currentPct}%`, marginLeft: "-4px" }}
        />
        {/* Home markers */}
        {homeEvents.map((evt, i) => (
          <div
            key={`h-${evt.minute}-${evt.type}-${i}`}
            className="absolute top-1/2 -translate-y-1/2 z-10"
            style={{ left: `${clampMinute(evt.minute, totalMinutes)}%`, marginLeft: "-6px" }}
            title={`${evt.minute}' ${evt.player || evt.type}`}
          >
            <span className="text-xs leading-none">{getMarkerIcon(evt.type)}</span>
          </div>
        ))}
      </div>

      {/* Away timeline */}
      <div className="relative h-5 mb-1">
        {/* Track */}
        <div className="absolute top-1/2 left-0 right-0 h-[3px] -translate-y-1/2 bg-gray-200 rounded-full" />
        {/* Progress */}
        <div
          className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 bg-gray-400 rounded-full transition-all duration-1000"
          style={{ width: `${currentPct}%` }}
        />
        {/* Half-time divider */}
        <div
          className="absolute top-0 bottom-0 w-px bg-gray-300"
          style={{ left: `${(halfMinute / totalMinutes) * 100}%` }}
        />
        {/* Away markers */}
        {awayEvents.map((evt, i) => (
          <div
            key={`a-${evt.minute}-${evt.type}-${i}`}
            className="absolute top-1/2 -translate-y-1/2 z-10"
            style={{ left: `${clampMinute(evt.minute, totalMinutes)}%`, marginLeft: "-6px" }}
            title={`${evt.minute}' ${evt.player || evt.type}`}
          >
            <span className="text-xs leading-none">{getMarkerIcon(evt.type)}</span>
          </div>
        ))}
      </div>

      {/* Minute labels */}
      <div className="flex justify-between text-[9px] text-gray-400 font-mono">
        <span>0</span>
        <span>15</span>
        <span>30</span>
        <span>45</span>
        {hasExtraTime ? (
          <>
            <span>60</span>
            <span>75</span>
            <span>90</span>
            <span>105</span>
            <span>120</span>
          </>
        ) : (
          <>
            <span>60</span>
            <span>75</span>
            <span>90</span>
          </>
        )}
      </div>
    </div>
  );
}
