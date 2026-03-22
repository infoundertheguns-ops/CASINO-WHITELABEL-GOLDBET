"use client";

import type { NextRaceInfo } from "@/lib/types/ippica";

interface Props {
  races: NextRaceInfo[];
  onSelectMeeting: (meetingId: string) => void;
}

export function NextRacesStrip({ races, onSelectMeeting }: Props) {
  if (races.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
      <span className="text-xs font-semibold text-gray-400 uppercase whitespace-nowrap self-center px-1">
        Prossime
      </span>
      {races.map(r => {
        const time = new Date(r.scheduledAt).toLocaleTimeString("it-IT", {
          hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome",
        });
        const abbr = r.meetingName.slice(0, 3).toUpperCase();

        return (
          <button
            key={r.raceId}
            onClick={() => onSelectMeeting(r.meetingId)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-gray-200 hover:border-brand/30 hover:bg-brand/5 transition-colors whitespace-nowrap"
          >
            <span className="text-xs font-mono font-bold text-brand">{time}</span>
            <span className="text-[10px] text-gray-500">{abbr}</span>
            <span className="text-[10px] text-gray-400">R{r.raceNumber}</span>
          </button>
        );
      })}
    </div>
  );
}
