# Ippica Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full horse racing frontend with racecard-style listing, race detail, betslip integration, and navigation.

**Architecture:** New `/ippica` route group with dedicated hooks fetching from `ippica_*` tables via Supabase browser client. Betslip extended to support ippica selections alongside sport bets. Place-bet API extended with `source: "ippica"` validation path. Polling every 30s for odds updates (no SSE).

**Tech Stack:** Next.js App Router, React, Tailwind CSS, Supabase JS client, existing betslip/layout components.

**Spec:** `docs/superpowers/specs/2026-03-22-ippica-frontend-design.md`

---

## File Structure

```
NEW FILES:
  lib/hooks/use-ippica.ts                    — Data hooks (meetings, races, runners, odds)
  lib/types/ippica.ts                        — TypeScript interfaces for ippica domain
  app/(player)/ippica/page.tsx               — Meeting listing + racecard page
  app/(player)/ippica/[id]/page.tsx          — Race detail page
  components/ippica/meeting-sidebar.tsx       — Country-grouped meeting list (sidebar/dropdown)
  components/ippica/race-card.tsx             — Single race racecard with runner grid
  components/ippica/runner-row.tsx            — Runner table row component
  components/ippica/race-header.tsx           — Race info header (distance, going, prize, status)
  components/ippica/next-races-strip.tsx      — Horizontal upcoming races strip
  components/ippica/ippica-betslip-adapter.tsx — Adapter to bridge ippica selections into existing betslip
  supabase/migrations/025_ippica_betting.sql  — DB migration for ippica bet_selections support

MODIFIED FILES:
  components/layout/player-nav.tsx:9-16       — Add "Ippica" to NAV_ITEMS
  lib/hooks/use-sportsbook.ts:76-84           — Extend BetslipItem with optional source/ippica fields
  app/api/player/place-bet/route.ts:69-75     — Add ippica validation path
```

---

### Task 1: Ippica TypeScript Types

**Files:**
- Create: `lib/types/ippica.ts`

- [ ] **Step 1: Create ippica types file**

```typescript
// lib/types/ippica.ts

export interface IppicaMeeting {
  id: string;
  external_id: string;
  name: string;
  country: string;
  country_id: string;
  race_type: string; // "GL" (galoppo) | "TR" (trotto)
  meeting_date: string;
  race_count: number;
  status: string; // scheduled | active | completed
}

export interface IppicaRace {
  id: string;
  external_id: string;
  meeting_id: string;
  title: string;
  race_number: number;
  scheduled_at: string;
  off_time?: string;
  status: string; // scheduled | open | closed | running | finished | abandoned
  race_class?: string;
  distance?: number;
  distance_units?: string;
  track?: string;
  race_kind?: string;
  going?: string;
  weather?: string;
  handicap: boolean;
  eligibility?: string;
  prize_amount?: number;
  prize_currency?: string;
  runners_count: number;
  // Joined from meeting
  meeting_name?: string;
  meeting_country?: string;
  meeting_race_type?: string;
}

export interface IppicaRunner {
  id: string;
  race_id: string;
  external_id: string;
  name: string;
  runner_number: number;
  drawn?: string;
  age?: number;
  sex?: string;
  weight_text?: string;
  weight_value?: number;
  jockey?: string;
  trainer?: string;
  trainer_location?: string;
  owner?: string;
  breeder?: string;
  bred?: string;
  color?: string;
  silk?: string;
  form?: string;
  rating?: number;
  comment_it?: string;
  breeding?: Record<string, unknown>;
  tackle?: Record<string, unknown>[];
  is_non_runner: boolean;
  finish_position?: number;
  disqualified?: boolean;
}

export interface IppicaMarket {
  id: string;
  race_id: string;
  market_type: string; // Winner, Place (2), Place (3), Place (4), Head to head, Even and odd
  market_label: string;
  is_active: boolean;
}

export interface IppicaOdds {
  id: string;
  market_id: string;
  runner_number?: number;
  selection_name: string;
  odds?: number;
  previous_odds?: number;
  trend: string; // down | stable | up
  status: string; // active | suspended | resulted
  result?: string; // won | lost | void
}

// Enriched odds with runner info for display
export interface IppicaOddsWithRunner extends IppicaOdds {
  runner?: IppicaRunner;
}

// Market with its odds
export interface IppicaMarketWithOdds extends IppicaMarket {
  odds: IppicaOdds[];
}

// For the "next races" strip
export interface NextRaceInfo {
  raceId: string;
  meetingId: string;
  meetingName: string;
  country: string;
  raceNumber: number;
  scheduledAt: string;
  status: string;
}

// Ippica betslip selection
export interface IppicaBetSelection {
  source: "ippica";
  raceId: string;
  raceName: string;
  meetingName: string;
  raceNumber: number;
  marketType: string;
  marketId: string;
  selectionName: string;
  odds: number;
  oddsId: string;
  runnerNumber?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types/ippica.ts
git commit -m "feat(ippica): add TypeScript types for ippica frontend"
```

---

### Task 2: Data Hooks — `use-ippica.ts`

**Files:**
- Create: `lib/hooks/use-ippica.ts`

- [ ] **Step 1: Create the hooks file**

```typescript
// lib/hooks/use-ippica.ts
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  IppicaMeeting, IppicaRace, IppicaRunner,
  IppicaMarket, IppicaOdds, IppicaMarketWithOdds, NextRaceInfo,
} from "@/lib/types/ippica";

// ═══ MEETINGS + RACES HOOK ═══

export function useIppica() {
  const [meetings, setMeetings] = useState<IppicaMeeting[]>([]);
  const [races, setRaces] = useState<IppicaRace[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      // Fetch today + tomorrow meetings
      const { data: meetingsData, error: mErr } = await supabase
        .from("ippica_meetings")
        .select("*")
        .gte("meeting_date", today)
        .lte("meeting_date", tomorrow)
        .order("country")
        .order("name");

      if (mErr) throw mErr;
      setMeetings(meetingsData || []);

      // Auto-select first meeting if none selected
      if (!selectedMeetingId && meetingsData && meetingsData.length > 0) {
        // Prefer Italian meetings first
        const italian = meetingsData.find(m => m.country === "Italy");
        setSelectedMeetingId(italian?.id || meetingsData[0].id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedMeetingId]);

  // Fetch races for selected meeting
  const fetchRaces = useCallback(async () => {
    if (!selectedMeetingId) { setRaces([]); return; }
    try {
      const supabase = createClient();
      const { data, error: rErr } = await supabase
        .from("ippica_races")
        .select("*, ippica_meetings!inner(name, country, race_type)")
        .eq("meeting_id", selectedMeetingId)
        .order("race_number");

      if (rErr) throw rErr;
      setRaces((data || []).map((r: any) => ({
        ...r,
        meeting_name: r.ippica_meetings?.name,
        meeting_country: r.ippica_meetings?.country,
        meeting_race_type: r.ippica_meetings?.race_type,
      })));
    } catch (e: any) {
      setError(e.message);
    }
  }, [selectedMeetingId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchRaces(); }, [fetchRaces]);

  // Refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => { fetchData(); fetchRaces(); }, 60000);
    return () => clearInterval(interval);
  }, [fetchData, fetchRaces]);

  // Group meetings by country, Italy first
  const meetingsByCountry = useMemo(() => {
    const map = new Map<string, IppicaMeeting[]>();
    for (const m of meetings) {
      const list = map.get(m.country) || [];
      list.push(m);
      map.set(m.country, list);
    }
    // Sort: Italy first, then alphabetical
    const entries = Array.from(map.entries());
    entries.sort(([a], [b]) => {
      if (a === "Italy") return -1;
      if (b === "Italy") return 1;
      return a.localeCompare(b);
    });
    return entries;
  }, [meetings]);

  const selectedMeeting = meetings.find(m => m.id === selectedMeetingId) || null;

  return {
    meetings, meetingsByCountry, races, selectedMeeting,
    selectedMeetingId, setSelectedMeetingId,
    loading, error, refresh: fetchData,
  };
}

// ═══ RACE DETAIL HOOK (with polling) ═══

export function useIppicaRace(raceId: string | null) {
  const [race, setRace] = useState<IppicaRace | null>(null);
  const [runners, setRunners] = useState<IppicaRunner[]>([]);
  const [markets, setMarkets] = useState<IppicaMarketWithOdds[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevOddsRef = useRef<Map<string, number>>(new Map());

  const fetchRace = useCallback(async () => {
    if (!raceId) { setLoading(false); return; }
    try {
      const supabase = createClient();

      // Fetch race + meeting info
      const { data: raceData } = await supabase
        .from("ippica_races")
        .select("*, ippica_meetings!inner(name, country, race_type)")
        .eq("id", raceId)
        .single();

      if (raceData) {
        setRace({
          ...raceData,
          meeting_name: raceData.ippica_meetings?.name,
          meeting_country: raceData.ippica_meetings?.country,
          meeting_race_type: raceData.ippica_meetings?.race_type,
        });
      }

      // Fetch runners
      const { data: runnersData } = await supabase
        .from("ippica_runners")
        .select("*")
        .eq("race_id", raceId)
        .order("runner_number");

      setRunners(runnersData || []);

      // Fetch markets + odds
      const { data: marketsData } = await supabase
        .from("ippica_markets")
        .select("*, ippica_odds(*)")
        .eq("race_id", raceId)
        .eq("is_active", true);

      if (marketsData) {
        // Track previous odds for trend detection on client
        const newPrevMap = new Map<string, number>();
        const enriched = marketsData.map((m: any) => ({
          ...m,
          odds: (m.ippica_odds || []).map((o: any) => {
            const prevClient = prevOddsRef.current.get(o.id);
            newPrevMap.set(o.id, o.odds);
            return {
              ...o,
              // Use DB trend (from scraper) as primary
              _clientPrevOdds: prevClient,
            };
          }),
        }));
        prevOddsRef.current = newPrevMap;
        setMarkets(enriched);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [raceId]);

  useEffect(() => { fetchRace(); }, [fetchRace]);

  // Poll every 30s for odds updates
  useEffect(() => {
    if (!raceId) return;
    const interval = setInterval(fetchRace, 30000);
    return () => clearInterval(interval);
  }, [raceId, fetchRace]);

  return { race, runners, markets, loading, error, refresh: fetchRace };
}

// ═══ NEXT RACES HOOK ═══

export function useNextRaces(limit = 8) {
  const [races, setRaces] = useState<NextRaceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const supabase = createClient();
        const now = new Date().toISOString();
        const { data } = await supabase
          .from("ippica_races")
          .select("id, meeting_id, race_number, scheduled_at, status, ippica_meetings!inner(name, country)")
          .in("status", ["scheduled", "open"])
          .gte("scheduled_at", now)
          .order("scheduled_at")
          .limit(limit);

        setRaces((data || []).map((r: any) => ({
          raceId: r.id,
          meetingId: r.meeting_id,
          meetingName: r.ippica_meetings?.name || "",
          country: r.ippica_meetings?.country || "",
          raceNumber: r.race_number,
          scheduledAt: r.scheduled_at,
          status: r.status,
        })));
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetch();
    const interval = setInterval(fetch, 60000);
    return () => clearInterval(interval);
  }, [limit]);

  return { races, loading };
}

// ═══ RACE QUICK ODDS HOOK (for listing page racecard) ═══
// Fetches Winner + Place odds for multiple races at once

export function useRaceOdds(raceIds: string[]) {
  const [oddsMap, setOddsMap] = useState<Map<string, IppicaMarketWithOdds[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const idsKey = raceIds.join(",");

  useEffect(() => {
    if (raceIds.length === 0) { setLoading(false); return; }

    async function fetch() {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("ippica_markets")
          .select("*, ippica_odds(*)")
          .in("race_id", raceIds)
          .eq("is_active", true)
          .in("market_type", ["Winner", "Place (2)", "Place (3)"]);

        const map = new Map<string, IppicaMarketWithOdds[]>();
        for (const m of (data || []) as any[]) {
          const list = map.get(m.race_id) || [];
          list.push({ ...m, odds: m.ippica_odds || [] });
          map.set(m.race_id, list);
        }
        setOddsMap(map);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [idsKey]);

  return { oddsMap, loading };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/hooks/use-ippica.ts
git commit -m "feat(ippica): add data hooks for meetings, races, odds"
```

---

### Task 3: Navigation — Add Ippica Tab

**Files:**
- Modify: `components/layout/player-nav.tsx:9-16`

- [ ] **Step 1: Add Ippica to NAV_ITEMS**

In `components/layout/player-nav.tsx`, update the `NAV_ITEMS` array. Insert after "Marcatori" (index 3), before "Le Mie Bet":

```typescript
const NAV_ITEMS = [
  { href: "/home", icon: "🏠", label: "Home" },
  { href: "/live", icon: "🔴", label: "Live" },
  { href: "/sport", icon: "⚽", label: "Sport" },
  { href: "/marcatori", icon: "🎯", label: "Marcatori" },
  { href: "/ippica", icon: "🏇", label: "Ippica" },
  { href: "/bets", icon: "🎫", label: "Le Mie Bet" },
  { href: "/wallet", icon: "💰", label: "Wallet" },
];
```

- [ ] **Step 2: Update desktop sidebar to show meeting list on ippica routes**

In `PlayerDesktopSidebar`, add ippica route detection alongside sport routes:

```typescript
const isIppicaPage = pathname === "/ippica" || pathname.startsWith("/ippica/");
```

And below the sport sidebar section, add:

```tsx
{isIppicaPage && (
  <div className="border-t border-gray-100 px-3 py-2">
    <p className="text-xs font-semibold text-gray-400 uppercase px-3 mb-2">Ippodromi</p>
    {/* Meeting sidebar content rendered by ippica page via context/portal */}
  </div>
)}
```

(The actual meeting list will be rendered inside the ippica page, using the sidebar slot pattern.)

- [ ] **Step 3: Commit**

```bash
git add components/layout/player-nav.tsx
git commit -m "feat(ippica): add Ippica tab to player navigation"
```

---

### Task 4: Ippica Components — Meeting Sidebar

**Files:**
- Create: `components/ippica/meeting-sidebar.tsx`

- [ ] **Step 1: Create meeting sidebar component**

```typescript
// components/ippica/meeting-sidebar.tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add components/ippica/meeting-sidebar.tsx
git commit -m "feat(ippica): add meeting sidebar component"
```

---

### Task 5: Ippica Components — Race Header + Runner Row

**Files:**
- Create: `components/ippica/race-header.tsx`
- Create: `components/ippica/runner-row.tsx`

- [ ] **Step 1: Create race header component**

```typescript
// components/ippica/race-header.tsx
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
```

- [ ] **Step 2: Create runner row component**

```typescript
// components/ippica/runner-row.tsx
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
```

- [ ] **Step 3: Commit**

```bash
git add components/ippica/race-header.tsx components/ippica/runner-row.tsx
git commit -m "feat(ippica): add race header and runner row components"
```

---

### Task 6: Ippica Components — Race Card + Next Races Strip

**Files:**
- Create: `components/ippica/race-card.tsx`
- Create: `components/ippica/next-races-strip.tsx`

- [ ] **Step 1: Create race card component**

The race card wraps `RaceHeader` + a table of `RunnerRow`s for a single race on the listing page.

```typescript
// components/ippica/race-card.tsx
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { RaceHeader } from "./race-header";
import { RunnerRow } from "./runner-row";
import type { IppicaRace, IppicaRunner, IppicaMarketWithOdds, IppicaBetSelection } from "@/lib/types/ippica";

interface Props {
  race: IppicaRace;
  runners: IppicaRunner[];
  markets: IppicaMarketWithOdds[];
  onToggleBet: (sel: IppicaBetSelection) => void;
  isSelected: (oddsId: string) => boolean;
}

export function RaceCard({ race, runners, markets, onToggleBet, isSelected }: Props) {
  const winnerMarket = markets.find(m => m.market_type === "Winner");
  const placeMarket = markets.find(m => m.market_type.startsWith("Place"));

  const isFinished = race.status === "finished" || race.status === "abandoned";

  // Build odds lookup: runner_number → odds
  const winnerOddsMap = new Map<number, typeof winnerMarket extends undefined ? never : NonNullable<typeof winnerMarket>["odds"][0]>();
  const placeOddsMap = new Map<number, any>();

  if (winnerMarket) {
    for (const o of winnerMarket.odds) {
      if (o.runner_number != null) winnerOddsMap.set(o.runner_number, o);
    }
  }
  if (placeMarket) {
    for (const o of placeMarket.odds) {
      if (o.runner_number != null) placeOddsMap.set(o.runner_number, o);
    }
  }

  const activeRunners = runners.filter(r => !r.is_non_runner);
  const nonRunners = runners.filter(r => r.is_non_runner);

  function makeBetSelection(runner: IppicaRunner, market: IppicaMarketWithOdds | undefined, oddsEntry: any): IppicaBetSelection | null {
    if (!market || !oddsEntry || !oddsEntry.odds) return null;
    return {
      source: "ippica",
      raceId: race.id,
      raceName: race.title,
      meetingName: race.meeting_name || "",
      raceNumber: race.race_number,
      marketType: market.market_type,
      marketId: market.id,
      selectionName: runner.name,
      odds: oddsEntry.odds,
      oddsId: oddsEntry.id,
      runnerNumber: runner.runner_number,
    };
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 border-b border-gray-100">
        <RaceHeader race={race} compact />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] font-semibold uppercase text-gray-400 border-b border-gray-100">
              <th className="px-2 py-2 w-8">#</th>
              <th className="px-2 py-2">Cavallo</th>
              <th className="px-2 py-2 hidden sm:table-cell">Form</th>
              <th className="px-2 py-2 text-center w-20">Vinc.</th>
              <th className="px-2 py-2 text-center w-20">Piaz.</th>
            </tr>
          </thead>
          <tbody>
            {activeRunners.map(runner => {
              const wOdds = winnerOddsMap.get(runner.runner_number);
              const pOdds = placeOddsMap.get(runner.runner_number);
              const wSel = makeBetSelection(runner, winnerMarket, wOdds);
              const pSel = makeBetSelection(runner, placeMarket, pOdds);

              return (
                <RunnerRow
                  key={runner.id}
                  runner={runner}
                  winnerOdds={wOdds}
                  placeOdds={pOdds}
                  onClickWinner={wSel ? () => onToggleBet(wSel) : undefined}
                  onClickPlace={pSel ? () => onToggleBet(pSel) : undefined}
                  isWinnerSelected={wOdds ? isSelected(wOdds.id) : false}
                  isPlaceSelected={pOdds ? isSelected(pOdds.id) : false}
                  isFinished={isFinished}
                />
              );
            })}
            {nonRunners.map(runner => (
              <RunnerRow key={runner.id} runner={runner} isFinished={isFinished} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-gray-100 flex justify-end">
        <Link
          href={`/ippica/${race.id}`}
          className="text-xs font-semibold text-brand hover:underline"
        >
          Tutti i mercati →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create next races strip component**

```typescript
// components/ippica/next-races-strip.tsx
"use client";

import { cn } from "@/lib/utils";
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
        // Abbreviate meeting name to 3 chars
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
```

- [ ] **Step 3: Commit**

```bash
git add components/ippica/race-card.tsx components/ippica/next-races-strip.tsx
git commit -m "feat(ippica): add race card and next races strip components"
```

---

### Task 7: Ippica Listing Page — `/ippica`

**Files:**
- Create: `app/(player)/ippica/page.tsx`

- [ ] **Step 1: Create the ippica listing page**

This is the main page combining: next races strip, meeting sidebar (mobile: dropdown, desktop: inline left), and race cards with odds.

```typescript
// app/(player)/ippica/page.tsx
"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useIppica, useNextRaces, useRaceOdds } from "@/lib/hooks/use-ippica";
import { useAuth } from "@/lib/hooks/use-auth";
import { MeetingSidebar } from "@/components/ippica/meeting-sidebar";
import { NextRacesStrip } from "@/components/ippica/next-races-strip";
import { RaceCard } from "@/components/ippica/race-card";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";
import type { IppicaBetSelection } from "@/lib/types/ippica";
import type { BetslipItem } from "@/lib/hooks/use-sportsbook";

export default function IppicaPage() {
  const {
    meetingsByCountry, races, selectedMeeting,
    selectedMeetingId, setSelectedMeetingId, loading, error,
  } = useIppica();
  const { races: nextRaces } = useNextRaces(8);
  const { user, wallet, refreshWallet } = useAuth();

  // Betslip state for ippica
  const [ippicaBetslip, setIppicaBetslip] = useState<IppicaBetSelection[]>([]);
  const [stake, setStake] = useState("");
  const [placingBet, setPlacingBet] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  // Fetch odds for all races in current meeting
  const raceIds = useMemo(() => races.map(r => r.id), [races]);
  const { oddsMap } = useRaceOdds(raceIds);

  // Fetch runners for display
  // We'll reuse the races data — runners are fetched per race in the detail page
  // For listing, we need a lightweight runner fetch
  const [runnersMap, setRunnersMap] = useState<Map<string, any[]>>(new Map());

  // Fetch runners for selected meeting's races
  useMemo(() => {
    if (raceIds.length === 0) return;
    const supabase = (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      const { data } = await sb
        .from("ippica_runners")
        .select("*")
        .in("race_id", raceIds)
        .order("runner_number");

      const map = new Map<string, any[]>();
      for (const r of (data || [])) {
        const list = map.get(r.race_id) || [];
        list.push(r);
        map.set(r.race_id, list);
      }
      setRunnersMap(map);
    })();
  }, [raceIds.join(",")]);

  const selectedOddsIds = new Set(ippicaBetslip.map(s => s.oddsId));

  function toggleBet(sel: IppicaBetSelection) {
    setIppicaBetslip(prev => {
      const exists = prev.find(s => s.oddsId === sel.oddsId);
      if (exists) return prev.filter(s => s.oddsId !== sel.oddsId);
      return [...prev, sel];
    });
  }

  // Convert ippica selections to BetslipItem format for display
  const betslipItems: BetslipItem[] = ippicaBetslip.map(s => ({
    eventId: s.raceId,
    marketName: s.marketType === "Winner" ? "Vincente" : s.marketType.replace("Place", "Piazzato"),
    selection: s.selectionName,
    odds: s.odds,
    match: `${s.meetingName} - R${s.raceNumber}`,
    marketId: s.marketId,
    outcomeId: s.oddsId,
  }));

  const totalOdds = ippicaBetslip.reduce((acc, s) => acc * s.odds, 1);

  async function placeBet() {
    if (ippicaBetslip.length === 0 || !stake) return;
    setPlacingBet(true);
    setBetResult(null);
    try {
      const res = await fetch("/api/player/place-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake: parseFloat(stake),
          source: "ippica",
          selections: ippicaBetslip.map(s => ({
            source: "ippica",
            raceId: s.raceId,
            marketId: s.marketId,
            oddsId: s.oddsId,
            odds: s.odds,
            selectionName: s.selectionName,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBetResult({ type: "success", text: "Scommessa piazzata!" });
        setIppicaBetslip([]);
        setStake("");
        refreshWallet?.();
      } else {
        setBetResult({ type: "error", text: data.error || "Errore" });
      }
    } catch (e: any) {
      setBetResult({ type: "error", text: e.message });
    } finally {
      setPlacingBet(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Next races strip */}
      <NextRacesStrip races={nextRaces} onSelectMeeting={setSelectedMeetingId} />

      {/* Mobile: meeting selector button */}
      <div className="lg:hidden">
        <button
          onClick={() => setShowMobileSidebar(!showMobileSidebar)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-gray-200 text-sm font-semibold text-gray-800"
        >
          <span>🏇 {selectedMeeting?.name || "Seleziona ippodromo"}</span>
          <span className="text-gray-400">{showMobileSidebar ? "▲" : "▼"}</span>
        </button>
        {showMobileSidebar && (
          <div className="mt-2 bg-white rounded-xl border border-gray-200 p-2 max-h-[60vh] overflow-y-auto">
            <MeetingSidebar
              meetingsByCountry={meetingsByCountry}
              selectedMeetingId={selectedMeetingId}
              onSelect={(id) => { setSelectedMeetingId(id); setShowMobileSidebar(false); }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <div className="hidden lg:block w-56 flex-shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 p-3 sticky top-[76px] max-h-[calc(100vh-100px)] overflow-y-auto">
            <p className="text-xs font-semibold text-gray-400 uppercase px-3 mb-2">Ippodromi</p>
            <MeetingSidebar
              meetingsByCountry={meetingsByCountry}
              selectedMeetingId={selectedMeetingId}
              onSelect={setSelectedMeetingId}
            />
          </div>
        </div>

        {/* Main content: race cards */}
        <div className="flex-1 min-w-0 space-y-4">
          {selectedMeeting && (
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-800">{selectedMeeting.name}</h1>
              <span className="text-xs text-gray-400">
                {selectedMeeting.race_type === "TR" ? "Trotto" : "Galoppo"} · {selectedMeeting.country}
              </span>
            </div>
          )}

          {races.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Nessuna corsa disponibile
            </div>
          ) : (
            races.map(race => (
              <RaceCard
                key={race.id}
                race={race}
                runners={runnersMap.get(race.id) || []}
                markets={oddsMap.get(race.id) || []}
                onToggleBet={toggleBet}
                isSelected={(oddsId) => selectedOddsIds.has(oddsId)}
              />
            ))
          )}
        </div>

        {/* Desktop betslip */}
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-[76px]">
            <BetslipPanel
              betslip={betslipItems}
              allEvents={[]}
              totalOdds={totalOdds}
              placingBet={placingBet}
              stake={stake}
              setStake={setStake}
              onPlaceBet={placeBet}
              onRemoveItem={(item) => {
                setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
              }}
              onClear={() => setIppicaBetslip([])}
              betMode="auto"
              setBetMode={() => {}}
              systemComboSize={2}
              setSystemComboSize={() => {}}
              user={user}
              wallet={wallet}
              msg={betResult}
            />
          </div>
        </div>
      </div>

      {/* Mobile betslip floating button */}
      {ippicaBetslip.length > 0 && (
        <div className="lg:hidden fixed bottom-[70px] left-1/2 -translate-x-1/2 z-40 max-w-[430px] w-full px-4">
          <button
            onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full bg-brand text-white rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-between shadow-lg"
          >
            <span>Biglietto ({ippicaBetslip.length})</span>
            <span className="font-mono">{totalOdds.toFixed(2)}</span>
          </button>
          {showMobileBetslip && (
            <div className="mt-2 bg-white rounded-xl border border-gray-200 shadow-xl p-4 max-h-[50vh] overflow-y-auto">
              <BetslipPanel
                betslip={betslipItems}
                allEvents={[]}
                totalOdds={totalOdds}
                placingBet={placingBet}
                stake={stake}
                setStake={setStake}
                onPlaceBet={placeBet}
                onRemoveItem={(item) => {
                  setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
                }}
                onClear={() => setIppicaBetslip([])}
                betMode="auto"
                setBetMode={() => {}}
                systemComboSize={2}
                setSystemComboSize={() => {}}
                user={user}
                wallet={wallet}
                msg={betResult}
                compact
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(player\)/ippica/page.tsx
git commit -m "feat(ippica): add ippica listing page with racecards"
```

---

### Task 8: Race Detail Page — `/ippica/[id]`

**Files:**
- Create: `app/(player)/ippica/[id]/page.tsx`

- [ ] **Step 1: Create race detail page**

Full race detail with market tabs (Vincente, Piazzato, Testa a Testa, Pari/Dispari), full runner table, betslip.

```typescript
// app/(player)/ippica/[id]/page.tsx
"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useIppicaRace } from "@/lib/hooks/use-ippica";
import { useAuth } from "@/lib/hooks/use-auth";
import { RaceHeader } from "@/components/ippica/race-header";
import { RunnerRow } from "@/components/ippica/runner-row";
import { BetslipPanel } from "@/components/sportsbook/betslip-panel";
import type { IppicaBetSelection, IppicaMarketWithOdds } from "@/lib/types/ippica";
import type { BetslipItem } from "@/lib/hooks/use-sportsbook";

const MARKET_TABS = [
  { key: "Winner", label: "VINCENTE" },
  { key: "Place", label: "PIAZZATO" },
  { key: "Head to head", label: "TESTA A TESTA" },
  { key: "Even and odd", label: "PARI/DISPARI" },
];

export default function IppicaRaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { race, runners, markets, loading, error } = useIppicaRace(id);
  const { user, wallet, refreshWallet } = useAuth();

  const [activeTab, setActiveTab] = useState("Winner");
  const [ippicaBetslip, setIppicaBetslip] = useState<IppicaBetSelection[]>([]);
  const [stake, setStake] = useState("");
  const [placingBet, setPlacingBet] = useState(false);
  const [betResult, setBetResult] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [showMobileBetslip, setShowMobileBetslip] = useState(false);
  const [sortBy, setSortBy] = useState<"number" | "odds" | "rating">("number");

  const selectedOddsIds = new Set(ippicaBetslip.map(s => s.oddsId));
  const isFinished = race?.status === "finished" || race?.status === "abandoned";

  // Filter markets by active tab
  const tabMarkets = useMemo(() => {
    if (activeTab === "Place") {
      return markets.filter(m => m.market_type.startsWith("Place"));
    }
    return markets.filter(m => m.market_type === activeTab);
  }, [markets, activeTab]);

  // Market counts per tab
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of MARKET_TABS) {
      if (tab.key === "Place") {
        counts[tab.key] = markets.filter(m => m.market_type.startsWith("Place")).length;
      } else {
        counts[tab.key] = markets.filter(m => m.market_type === tab.key).length;
      }
    }
    return counts;
  }, [markets]);

  // Active + non-runner split
  const activeRunners = runners.filter(r => !r.is_non_runner);
  const nonRunners = runners.filter(r => r.is_non_runner);

  // Sort runners
  const sortedRunners = useMemo(() => {
    const winnerMarket = markets.find(m => m.market_type === "Winner");
    const copy = [...activeRunners];
    if (sortBy === "odds" && winnerMarket) {
      const oddsMap = new Map(winnerMarket.odds.map(o => [o.runner_number, o.odds || 999]));
      copy.sort((a, b) => (oddsMap.get(a.runner_number) || 999) - (oddsMap.get(b.runner_number) || 999));
    } else if (sortBy === "rating") {
      copy.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else {
      copy.sort((a, b) => a.runner_number - b.runner_number);
    }
    return copy;
  }, [activeRunners, sortBy, markets]);

  function toggleBet(sel: IppicaBetSelection) {
    setIppicaBetslip(prev => {
      const exists = prev.find(s => s.oddsId === sel.oddsId);
      if (exists) return prev.filter(s => s.oddsId !== sel.oddsId);
      return [...prev, sel];
    });
  }

  function makeBetSelection(market: IppicaMarketWithOdds, oddsEntry: any): IppicaBetSelection | null {
    if (!oddsEntry?.odds || !race) return null;
    return {
      source: "ippica",
      raceId: race.id,
      raceName: race.title,
      meetingName: race.meeting_name || "",
      raceNumber: race.race_number,
      marketType: market.market_type,
      marketId: market.id,
      selectionName: oddsEntry.selection_name,
      odds: oddsEntry.odds,
      oddsId: oddsEntry.id,
      runnerNumber: oddsEntry.runner_number,
    };
  }

  const betslipItems: BetslipItem[] = ippicaBetslip.map(s => ({
    eventId: s.raceId,
    marketName: s.marketType === "Winner" ? "Vincente" : s.marketType.replace("Place", "Piazzato"),
    selection: s.selectionName,
    odds: s.odds,
    match: `${s.meetingName} - R${s.raceNumber}`,
    marketId: s.marketId,
    outcomeId: s.oddsId,
  }));

  const totalOdds = ippicaBetslip.reduce((acc, s) => acc * s.odds, 1);

  async function placeBet() {
    if (ippicaBetslip.length === 0 || !stake) return;
    setPlacingBet(true);
    setBetResult(null);
    try {
      const res = await fetch("/api/player/place-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stake: parseFloat(stake),
          source: "ippica",
          selections: ippicaBetslip.map(s => ({
            source: "ippica",
            raceId: s.raceId,
            marketId: s.marketId,
            oddsId: s.oddsId,
            odds: s.odds,
            selectionName: s.selectionName,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBetResult({ type: "success", text: "Scommessa piazzata!" });
        setIppicaBetslip([]);
        setStake("");
        refreshWallet?.();
      } else {
        setBetResult({ type: "error", text: data.error || "Errore" });
      }
    } catch (e: any) {
      setBetResult({ type: "error", text: e.message });
    } finally {
      setPlacingBet(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!race) {
    return <div className="text-center py-12 text-gray-400">Corsa non trovata</div>;
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/ippica" className="hover:text-brand">Ippica</Link>
        <span>›</span>
        <span>{race.meeting_name}</span>
        <span>›</span>
        <span className="text-gray-600">Corsa {race.race_number}</span>
      </div>

      {/* Race header */}
      <div className="bg-white rounded-xl border border-gray-200 px-4">
        <RaceHeader race={race} />
      </div>

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Market tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {MARKET_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold uppercase whitespace-nowrap transition-colors",
                  activeTab === tab.key
                    ? "bg-brand text-white"
                    : "bg-white text-gray-500 border border-gray-200 hover:border-brand/30",
                  tabCounts[tab.key] === 0 && "opacity-40 pointer-events-none",
                )}
              >
                {tab.label}
                {tabCounts[tab.key] > 0 && (
                  <span className="ml-1 text-[10px] opacity-70">({tabCounts[tab.key]})</span>
                )}
              </button>
            ))}
          </div>

          {/* Content per tab */}
          {activeTab === "Winner" || activeTab === "Place" ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Sort controls */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                <span className="text-[10px] text-gray-400 uppercase">Ordina:</span>
                {(["number", "odds", "rating"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded",
                      sortBy === s ? "bg-brand/10 text-brand" : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    {s === "number" ? "#" : s === "odds" ? "Quota" : "Rating"}
                  </button>
                ))}
              </div>

              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase text-gray-400 border-b border-gray-100">
                    <th className="px-2 py-2 w-8">#</th>
                    <th className="px-2 py-2">Cavallo</th>
                    <th className="px-2 py-2 hidden sm:table-cell">Form</th>
                    <th className="px-2 py-2 hidden md:table-cell">Peso</th>
                    <th className="px-2 py-2 hidden md:table-cell text-center">Rating</th>
                    {activeTab === "Winner" ? (
                      <>
                        <th className="px-2 py-2 text-center w-20">Vinc.</th>
                        <th className="px-2 py-2 text-center w-20">Piaz.</th>
                      </>
                    ) : (
                      // Place tab: show all place columns
                      tabMarkets.map(m => (
                        <th key={m.id} className="px-2 py-2 text-center w-20">
                          {m.market_type.replace("Place ", "P")}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedRunners.map(runner => {
                    if (activeTab === "Winner") {
                      const wMarket = markets.find(m => m.market_type === "Winner");
                      const pMarket = markets.find(m => m.market_type.startsWith("Place"));
                      const wOdds = wMarket?.odds.find(o => o.runner_number === runner.runner_number);
                      const pOdds = pMarket?.odds.find(o => o.runner_number === runner.runner_number);
                      const wSel = wMarket && wOdds ? makeBetSelection(wMarket, wOdds) : null;
                      const pSel = pMarket && pOdds ? makeBetSelection(pMarket, pOdds) : null;

                      return (
                        <RunnerRow
                          key={runner.id}
                          runner={runner}
                          winnerOdds={wOdds}
                          placeOdds={pOdds}
                          onClickWinner={wSel ? () => toggleBet(wSel) : undefined}
                          onClickPlace={pSel ? () => toggleBet(pSel) : undefined}
                          isWinnerSelected={wOdds ? selectedOddsIds.has(wOdds.id) : false}
                          isPlaceSelected={pOdds ? selectedOddsIds.has(pOdds.id) : false}
                          showDetail
                          isFinished={isFinished}
                        />
                      );
                    }

                    // Place tab: multiple place columns
                    return (
                      <tr key={runner.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-2 py-1.5 text-xs font-mono font-bold text-gray-500 w-8 text-center">
                          {runner.runner_number}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="text-sm font-semibold text-gray-800">{runner.name}</div>
                          <div className="text-[10px] text-gray-400">{runner.jockey}</div>
                        </td>
                        <td className="px-2 py-1.5 text-xs font-mono text-gray-500 hidden sm:table-cell">
                          {runner.form || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-gray-500 hidden md:table-cell">
                          {runner.weight_text || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-xs font-mono text-gray-500 hidden md:table-cell text-center">
                          {runner.rating || "—"}
                        </td>
                        {tabMarkets.map(m => {
                          const o = m.odds.find(o => o.runner_number === runner.runner_number);
                          const sel = o ? makeBetSelection(m, o) : null;
                          return (
                            <td key={m.id} className="px-1 py-1">
                              {o?.odds ? (
                                <button
                                  onClick={sel ? () => toggleBet(sel) : undefined}
                                  disabled={isFinished || o.status === "suspended"}
                                  className={cn(
                                    "w-full px-2 py-1.5 rounded text-sm font-mono font-semibold transition-all text-center",
                                    selectedOddsIds.has(o.id)
                                      ? "bg-brand text-white ring-2 ring-brand/30"
                                      : "bg-gray-50 text-gray-800 hover:bg-brand/10",
                                  )}
                                >
                                  {o.odds.toFixed(2)}
                                </button>
                              ) : (
                                <span className="text-xs text-gray-300 text-center block">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {nonRunners.map(runner => (
                    <RunnerRow key={runner.id} runner={runner} showDetail isFinished={isFinished} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : activeTab === "Head to head" ? (
            <div className="space-y-3">
              {tabMarkets.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">Nessun Testa a Testa disponibile</div>
              ) : tabMarkets.map(m => (
                <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-3 uppercase font-semibold">{m.market_label}</p>
                  <div className="flex gap-3">
                    {m.odds.map(o => {
                      const sel = makeBetSelection(m, o);
                      return (
                        <button
                          key={o.id}
                          onClick={sel ? () => toggleBet(sel) : undefined}
                          disabled={isFinished || o.status === "suspended"}
                          className={cn(
                            "flex-1 py-3 rounded-lg text-center transition-all border",
                            selectedOddsIds.has(o.id)
                              ? "bg-brand text-white border-brand"
                              : "bg-gray-50 border-gray-200 hover:border-brand/30",
                          )}
                        >
                          <div className="text-sm font-semibold">{o.selection_name}</div>
                          <div className="text-lg font-mono font-bold mt-1">
                            {o.odds?.toFixed(2) || "—"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : activeTab === "Even and odd" ? (
            <div className="space-y-3">
              {tabMarkets.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">Nessun Pari/Dispari disponibile</div>
              ) : tabMarkets.map(m => (
                <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex gap-3">
                    {m.odds.map(o => {
                      const sel = makeBetSelection(m, o);
                      return (
                        <button
                          key={o.id}
                          onClick={sel ? () => toggleBet(sel) : undefined}
                          disabled={isFinished || o.status === "suspended"}
                          className={cn(
                            "flex-1 py-4 rounded-lg text-center transition-all border",
                            selectedOddsIds.has(o.id)
                              ? "bg-brand text-white border-brand"
                              : "bg-gray-50 border-gray-200 hover:border-brand/30",
                          )}
                        >
                          <div className="text-lg font-semibold">{o.selection_name}</div>
                          <div className="text-2xl font-mono font-bold mt-1">
                            {o.odds?.toFixed(2) || "—"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Desktop betslip */}
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-[76px]">
            <BetslipPanel
              betslip={betslipItems}
              allEvents={[]}
              totalOdds={totalOdds}
              placingBet={placingBet}
              stake={stake}
              setStake={setStake}
              onPlaceBet={placeBet}
              onRemoveItem={(item) => {
                setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
              }}
              onClear={() => setIppicaBetslip([])}
              betMode="auto"
              setBetMode={() => {}}
              systemComboSize={2}
              setSystemComboSize={() => {}}
              user={user}
              wallet={wallet}
              msg={betResult}
            />
          </div>
        </div>
      </div>

      {/* Mobile betslip */}
      {ippicaBetslip.length > 0 && (
        <div className="lg:hidden fixed bottom-[70px] left-1/2 -translate-x-1/2 z-40 max-w-[430px] w-full px-4">
          <button
            onClick={() => setShowMobileBetslip(!showMobileBetslip)}
            className="w-full bg-brand text-white rounded-xl py-3 px-4 font-semibold text-sm flex items-center justify-between shadow-lg"
          >
            <span>Biglietto ({ippicaBetslip.length})</span>
            <span className="font-mono">{totalOdds.toFixed(2)}</span>
          </button>
          {showMobileBetslip && (
            <div className="mt-2 bg-white rounded-xl border border-gray-200 shadow-xl p-4 max-h-[50vh] overflow-y-auto">
              <BetslipPanel
                betslip={betslipItems}
                allEvents={[]}
                totalOdds={totalOdds}
                placingBet={placingBet}
                stake={stake}
                setStake={setStake}
                onPlaceBet={placeBet}
                onRemoveItem={(item) => {
                  setIppicaBetslip(prev => prev.filter(s => s.oddsId !== item.outcomeId));
                }}
                onClear={() => setIppicaBetslip([])}
                betMode="auto"
                setBetMode={() => {}}
                systemComboSize={2}
                setSystemComboSize={() => {}}
                user={user}
                wallet={wallet}
                msg={betResult}
                compact
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(player\)/ippica/\[id\]/page.tsx
git commit -m "feat(ippica): add race detail page with market tabs"
```

---

### Task 9: DB Migration + Place-Bet API Extension

**Files:**
- Create: `supabase/migrations/025_ippica_betting.sql`
- Modify: `app/api/player/place-bet/route.ts:69-75`

- [ ] **Step 1: Create migration for ippica bet support**

```sql
-- 025_ippica_betting.sql
-- Add ippica support to bet_selections

ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sport';
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS ippica_race_id UUID REFERENCES ippica_races(id);
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS ippica_market_id UUID REFERENCES ippica_markets(id);
ALTER TABLE bet_selections ADD COLUMN IF NOT EXISTS ippica_odds_id UUID REFERENCES ippica_odds(id);

-- Index for ippica settlement queries
CREATE INDEX IF NOT EXISTS idx_bet_selections_ippica_race ON bet_selections(ippica_race_id) WHERE source = 'ippica';
CREATE INDEX IF NOT EXISTS idx_bet_selections_ippica_odds ON bet_selections(ippica_odds_id) WHERE source = 'ippica';
```

- [ ] **Step 2: Add ippica validation path to place-bet API**

In `app/api/player/place-bet/route.ts`, after parsing the request body (line ~69-75), add an ippica branch:

```typescript
// After: const { stake, selections, fingerprint, systemType } = body;
const isIppica = body.source === "ippica";
```

Then before the sport validation loop (line ~119), add the ippica path:

```typescript
if (isIppica) {
  // ── IPPICA PATH — validate against ippica tables ──
  for (const sel of selections) {
    const { data: odds } = await supabase
      .from("ippica_odds")
      .select("id, odds, status, market_id, selection_name, ippica_markets!inner(race_id, market_type, is_active, ippica_races!inner(status, scheduled_at, title))")
      .eq("id", sel.oddsId)
      .single();

    if (!odds) {
      return NextResponse.json({ error: `Quota ippica non trovata: ${sel.oddsId}`, code: "OUTCOME_NOT_FOUND" }, { status: 400 });
    }

    const market = (odds as any).ippica_markets;
    const race = market?.ippica_races;

    if (odds.status !== "active") {
      return NextResponse.json({ error: `Quota sospesa: ${odds.selection_name}`, code: "OUTCOME_SUSPENDED" }, { status: 400 });
    }
    if (!market?.is_active) {
      return NextResponse.json({ error: `Mercato chiuso`, code: "MARKET_SUSPENDED" }, { status: 400 });
    }
    if (race?.status === "finished" || race?.status === "abandoned" || race?.status === "running") {
      return NextResponse.json({ error: `Corsa non accetta scommesse (${race.status})`, code: "EVENT_ENDED" }, { status: 400 });
    }

    const currentOdds = parseFloat(odds.odds);
    const clientOdds = parseFloat(sel.odds);
    if (Math.abs(currentOdds - clientOdds) > tolerance) {
      return NextResponse.json({ error: "Le quote sono cambiate", code: "ODDS_CHANGED" }, { status: 409 });
    }

    let timeToKickoff: number | null = null;
    if (race?.scheduled_at) {
      timeToKickoff = Math.round((new Date(race.scheduled_at).getTime() - Date.now()) / 60000);
    }

    totalOdds *= currentOdds;
    validatedSelections.push({
      outcome_id: odds.id,
      market_id: odds.market_id,
      event_id: market.race_id, // use race_id as event_id for ippica
      odds: currentOdds,
      outcome_name: odds.selection_name,
      time_to_kickoff: timeToKickoff,
    });
  }
} else {
  // existing sport validation loop...
}
```

And in the bet_selections insert (line ~522-528), add ippica columns:

```typescript
const legs = validatedSelections.map((s, i) => ({
  bet_id: bet.id,
  event_id: isIppica ? null : s.event_id,
  market_id: isIppica ? null : s.market_id,
  outcome_id: isIppica ? null : s.outcome_id,
  odds_at_placement: s.odds,
  source: isIppica ? "ippica" : "sport",
  ippica_race_id: isIppica ? s.event_id : null,
  ippica_market_id: isIppica ? s.market_id : null,
  ippica_odds_id: isIppica ? s.outcome_id : null,
}));
```

- [ ] **Step 3: Run the migration on Supabase**

```bash
ssh scraper-vps "PGPASSWORD=2MQhskawT3I6XVKW psql -h db.xgnyqkmugnfzhdveeqom.supabase.co -U postgres -d postgres -f /dev/stdin" < supabase/migrations/025_ippica_betting.sql
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/025_ippica_betting.sql app/api/player/place-bet/route.ts
git commit -m "feat(ippica): extend place-bet API and DB for ippica betting"
```

---

### Task 10: Build + Deploy + Verify

**Files:** None (deployment task)

- [ ] **Step 1: Run local build to check for TypeScript errors**

```bash
cd C:\Users\philp\Downloads\vincitu-project\vincitu && npx next build
```

Fix any TypeScript/import errors that come up.

- [ ] **Step 2: Test locally**

```bash
cd C:\Users\philp\Downloads\vincitu-project\vincitu && npm run dev
```

Open http://localhost:3000/ippica — verify:
- Meeting sidebar loads with country groups
- Selecting a meeting shows race cards
- Runner grid shows with Winner/Place odds
- Clicking odds adds to betslip
- Navigate to race detail via "Tutti i mercati"
- Market tabs work (Winner, Piazzato, H2H, P/D)
- Ippica tab visible in nav

- [ ] **Step 3: Deploy to VPS**

Use the standard deploy command from memory:
```bash
cd C:\Users\philp\Downloads\vincitu-project\vincitu
npx next build
tar czf /tmp/next-build.tar.gz .next
tar czf /tmp/x.tar.gz --exclude=node_modules --exclude=.next --exclude=.git .
scp /tmp/next-build.tar.gz /tmp/x.tar.gz scraper-vps:/tmp/
ssh scraper-vps "systemctl stop vincitu && cd /root/vincitu && cp .env.local /tmp/vincitu-env-backup && rm -rf .next && tar xzf /tmp/x.tar.gz && cp /tmp/vincitu-env-backup .env.local && tar xzf /tmp/next-build.tar.gz && systemctl start vincitu"
```

- [ ] **Step 4: Verify on production**

Open https://betssolution.com/ippica and verify everything works.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(ippica): post-deploy fixes"
```
