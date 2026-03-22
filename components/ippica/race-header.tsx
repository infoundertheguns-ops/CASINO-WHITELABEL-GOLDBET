"use client";

import { cn } from "@/lib/utils";
import type { IppicaRace } from "@/lib/types/ippica";

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-gray-100 text-gray-600",
  open: "bg-green-100 text-green-700",
  closed: "bg-yellow-100 text-yellow-700",
  running: "bg-red-100 text-red-700",
  finished: "bg-blue-100 text-blue-700",
  abandoned: "bg-gray-200 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Programmata",
  open: "Aperta",
  closed: "Chiusa",
  running: "In Corso",
  finished: "Conclusa",
  abandoned: "Annullata",
};

interface Props {
  race: IppicaRace;
  compact?: boolean;
}

export function RaceHeader({ race, compact = false }: Props) {
  const time = new Date(race.scheduled_at).toLocaleTimeString("it-IT", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome",
  });

  const distanceLabel = race.distance
    ? `${race.distance}${race.distance_units === "metres" ? "m" : race.distance_units || "m"}`
    : null;

  const prizeLabel = race.prize_amount
    ? `${race.prize_currency || "€"} ${(race.prize_amount / 100).toLocaleString("it-IT")}`
    : null;

  return (
    <div className={cn("flex items-center gap-3 flex-wrap", compact ? "py-2" : "py-3")}>
      {/* Race number badge */}
      <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand/10 text-brand font-bold text-sm">
        {race.race_number}
      </span>

      {/* Title + time */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("font-semibold text-gray-800 truncate", compact ? "text-sm" : "text-base")}>
            {race.title}
          </span>
          <span className={cn(
            "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
            STATUS_STYLES[race.status] || STATUS_STYLES.scheduled
          )}>
            {race.status === "running" ? "LIVE" : STATUS_LABELS[race.status] || race.status}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
          <span>{time}</span>
          {distanceLabel && <><span>·</span><span>{distanceLabel}</span></>}
          {race.going && <><span>·</span><span>{race.going}</span></>}
          {race.race_kind && <><span>·</span><span>{race.race_kind}</span></>}
          {race.handicap && <><span>·</span><span className="text-yellow-600 font-semibold">HCP</span></>}
        </div>
      </div>

      {/* Prize */}
      {prizeLabel && !compact && (
        <span className="text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded">
          {prizeLabel}
        </span>
      )}

      {/* Runners count */}
      <span className="text-xs text-gray-400">{race.runners_count} partenti</span>
    </div>
  );
}
