"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { IppicaMeeting } from "@/lib/types/ippica";

const COUNTRY_FLAGS: Record<string, string> = {
  "Italy": "🇮🇹", "United Kingdom": "🇬🇧", "France": "🇫🇷",
  "Ireland": "🇮🇪", "USA": "🇺🇸", "Sweden": "🇸🇪",
  "Germany": "🇩🇪", "Australia": "🇦🇺", "South Africa": "🇿🇦",
  "Japan": "🇯🇵", "Argentina": "🇦🇷", "Brazil": "🇧🇷",
  "Chile": "🇨🇱", "UAE": "🇦🇪", "Hong Kong": "🇭🇰",
};

interface Props {
  meetingsByCountry: [string, IppicaMeeting[]][];
  selectedMeetingId: string | null;
  onSelect: (id: string) => void;
}

export function MeetingSidebar({ meetingsByCountry, selectedMeetingId, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (country: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(country) ? next.delete(country) : next.add(country);
      return next;
    });
  };

  return (
    <div className="space-y-1">
      {meetingsByCountry.map(([country, meetings]) => (
        <div key={country}>
          <button
            onClick={() => toggle(country)}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-gray-500 uppercase hover:bg-gray-50 rounded-lg"
          >
            <span>{COUNTRY_FLAGS[country] || "🏳️"}</span>
            <span className="flex-1 text-left">{country}</span>
            <span className="text-[10px] text-gray-400">
              {collapsed.has(country) ? "▶" : "▼"}
            </span>
          </button>
          {!collapsed.has(country) && meetings.map(m => (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={cn(
                "flex items-center gap-2 w-full px-4 py-2 text-sm rounded-lg transition-colors",
                m.id === selectedMeetingId
                  ? "bg-brand/10 text-brand font-semibold"
                  : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <span className="text-[10px] font-bold text-gray-400 w-5">
                {m.race_type === "TR" ? "T" : "G"}
              </span>
              <span className="flex-1 text-left truncate">{m.name}</span>
              <span className="text-[10px] text-gray-400">{m.race_count}c</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
