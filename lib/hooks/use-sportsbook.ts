"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "./use-auth";
import { useSportFilter } from "@/lib/contexts/sport-filter-context";
import { useLiveOdds, type LiveOddsMessage } from "./use-live-odds";

// ═══ API-FOOTBALL STATS TYPES ═══

export interface MatchStats {
  possession: [number, number];
  shots: [number, number];
  shotsOnTarget: [number, number];
  corners: [number, number];
  fouls: [number, number];
  yellowCards: [number, number];
  redCards: [number, number];
  offsides?: [number, number];
  saves?: [number, number];
}

export interface MatchEvent {
  minute: number;
  type: string;
  team: 'home' | 'away';
  player: string;
  assist?: string;
  detail?: string;
}

// ═══ INTERFACES (extended with optional DB fields) ═══

export interface SportEvent {
  id: string;
  externalId?: string;
  league: string;
  leagueSlug?: string;
  leagueIcon: string;
  home: string;
  away: string;
  time: string;
  live: boolean;
  minute?: number;
  minuteReceivedAt?: number;
  scoreH?: number;
  scoreA?: number;
  markets: Market[];
  sportName?: string;
  sportSlug?: string;
  period?: string;
  periodCode?: number;
  halfScoreHome?: number[];
  halfScoreAway?: number[];
  stats?: MatchStats;
  matchEvents?: MatchEvent[];
}

export interface Market {
  name: string;
  selections: Selection[];
  id?: string;
  marketType?: string;
  line?: number;
}

export interface Selection {
  label: string;
  odds: number;
  id?: string;
  previousOdds?: number;
  changedAt?: number;
  suspended?: boolean;
}

export interface BetslipItem {
  eventId: string;
  marketName: string;
  selection: string;
  odds: number;
  match: string;
  marketId?: string;
  outcomeId?: string;
}

// ═══ CANONICAL OUTCOME ORDERING ═══
// Ensures outcomes display in correct order regardless of DB insertion order.
// Covers all Goldbet market types: 1X2, DC, U/O, GG/NG, combos, handicap,
// risultato esatto, prossimo gol, pari/dispari, somma gol, si/no, etc.

export function sortSelections(marketName: string, selections: Selection[]): Selection[] {
  if (selections.length <= 1) return selections;

  const name = (marketName || "").toLowerCase();

  // ── Combo markets FIRST (before simple patterns): "1X2 + GG/NG", "DC + U/O", etc. ──
  // Must check before 1X2/DC patterns because "1x2 + gg/ng".startsWith("1x2 ") is true
  if (name.includes(" + ")) {
    return sortComboSelections(name, selections);
  }

  // ── Risultato Esatto: sort by score numerically (0:0, 0:1, ... Altro last) ──
  if (name.includes("risultato esatto")) {
    return sortScoreSelections(selections);
  }

  // ── Somma Gol: sort numerically (0, 1, 2, 3, 4, 5+) ──
  if (name.includes("somma gol")) {
    return sortNumericSelections(selections);
  }

  // ── Priority map approach: explicit ordering for known patterns ──
  let priorityMap: Record<string, number> | null = null;

  // 1X2 family: 1, X, 2
  if (name === "1x2" || name === "1x" || name === "esito finale 1x2"
      || name.startsWith("1x2 ")) {
    priorityMap = { "1": 0, "x": 1, "2": 2 };
  }
  // DC (Doppia Chance) — short name "DC" or full "Doppia Chance": 1X, 12, X2
  else if (name === "dc" || name.startsWith("dc ") || name.includes("doppia chance")) {
    priorityMap = { "1x": 0, "12": 1, "x2": 2 };
  }
  // Under/Over: Over/O first, Under/U second
  else if (name.includes("under/over") || name.startsWith("u/o") || name.startsWith("o/u")) {
    priorityMap = { "over": 0, "under": 1, "o": 0, "u": 1 };
  }
  // GG/NG / Gol/NoGol: GG, NG
  else if (name.includes("gol/nogol") || name.includes("gg/ng")) {
    priorityMap = { "gg": 0, "ng": 1, "gol": 0, "nogol": 1 };
  }
  // Head-to-head / Draw No Bet / Vincente: 1, 2
  else if (name.includes("t/t risultato") || name.includes("testa a testa")
      || name.includes("vincente incontro") || name.includes("vincente (escl")
      || name.includes("draw no bet") || name.includes("t/t match")) {
    priorityMap = { "1": 0, "2": 1 };
  }
  // T/T Handicap: 1, 2
  else if (name.includes("t/t handicap")) {
    priorityMap = { "1": 0, "2": 1 };
  }
  // Prossimo Gol: Casa, Nessun Gol, Ospite
  else if (name.includes("prossimo gol")) {
    priorityMap = { "casa": 0, "nessun gol": 1, "ospite": 2 };
  }
  // Pari/Dispari: Dispari, Pari
  else if (name.includes("pari/dispari") || name.includes("odd/even")) {
    priorityMap = { "dispari": 0, "pari": 1, "odd": 0, "even": 1 };
  }
  // Si/No markets (e.g. "Giocatore 1 Vince Almeno Un Set", "GG o Over 2.5")
  else if (selections.length === 2) {
    const labels = selections.map(s => (s.label || "").toLowerCase().trim());
    if (labels.includes("si") && labels.includes("no")) {
      priorityMap = { "si": 0, "no": 1 };
    }
  }

  if (!priorityMap) return selections;

  return [...selections].sort((a, b) => {
    const aKey = (a.label || "").toLowerCase().trim();
    const bKey = (b.label || "").toLowerCase().trim();
    const aPri = priorityMap![aKey] ?? 999;
    const bPri = priorityMap![bKey] ?? 999;
    return aPri - bPri;
  });
}

// Sort combo outcomes: "1 - GG", "X - Over", "1X - Under", etc.
// Groups by first component in canonical order, then second component
function sortComboSelections(marketName: string, selections: Selection[]): Selection[] {
  const name = marketName.toLowerCase();

  // Determine ordering for first part (before separator)
  let firstOrder: Record<string, number>;
  if (name.startsWith("dc") || name.includes("doppia chance")) {
    firstOrder = { "1x": 0, "12": 1, "x2": 2 };
  } else {
    firstOrder = { "1": 0, "x": 1, "2": 2 };
  }

  // Determine ordering for second part (after separator)
  // Include abbreviations: "Ov"/"Un" (prematch), "O"/"U", "Over"/"Under" (live)
  let secondOrder: Record<string, number>;
  if (name.includes("gg") || name.includes("gol")) {
    secondOrder = { "gg": 0, "ng": 1 };
  } else {
    secondOrder = { "over": 0, "under": 1, "ov": 0, "un": 1, "o": 0, "u": 1 };
  }

  return [...selections].sort((a, b) => {
    const aParts = parseComboLabel(a.label);
    const bParts = parseComboLabel(b.label);
    const aFirst = firstOrder[aParts[0]] ?? 999;
    const bFirst = firstOrder[bParts[0]] ?? 999;
    if (aFirst !== bFirst) return aFirst - bFirst;
    const aSecond = secondOrder[aParts[1]] ?? 999;
    const bSecond = secondOrder[bParts[1]] ?? 999;
    return aSecond - bSecond;
  });
}

function parseComboLabel(label: string): [string, string] {
  const l = (label || "").toLowerCase().trim();
  // Try separators: " - ", " + ", "-"
  for (const sep of [" - ", " + ", "-"]) {
    const idx = l.indexOf(sep);
    if (idx > 0) return [l.slice(0, idx).trim(), l.slice(idx + sep.length).trim()];
  }
  return [l, ""];
}

// Sort score outcomes: "0:0", "0:1", ..., "4:4", "Altro" last
function sortScoreSelections(selections: Selection[]): Selection[] {
  return [...selections].sort((a, b) => {
    const aL = (a.label || "").trim();
    const bL = (b.label || "").trim();
    const aScore = parseScore(aL);
    const bScore = parseScore(bL);
    // "Altro" goes last
    if (!aScore && !bScore) return 0;
    if (!aScore) return 1;
    if (!bScore) return -1;
    // Sort by home goals first, then away goals
    if (aScore[0] !== bScore[0]) return aScore[0] - bScore[0];
    return aScore[1] - bScore[1];
  });
}

function parseScore(label: string): [number, number] | null {
  const m = label.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2])];
}

// Sort numeric outcomes: "0", "1", "2", "3", "4", "5+", etc.
function sortNumericSelections(selections: Selection[]): Selection[] {
  return [...selections].sort((a, b) => {
    const aL = (a.label || "").trim();
    const bL = (b.label || "").trim();
    const aNum = parseInt(aL);
    const bNum = parseInt(bL);
    // Non-numeric (like "5+") — extract leading number
    if (isNaN(aNum) && isNaN(bNum)) return aL.localeCompare(bL);
    if (isNaN(aNum)) return 1;
    if (isNaN(bNum)) return -1;
    if (aNum !== bNum) return aNum - bNum;
    // Same number but one has "+" suffix (e.g. "3+" > "3")
    return aL.length - bL.length;
  });
}

// ═══ HELPERS ═══

function formatKickoffTime(startsAt: string): string {
  const d = new Date(startsAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays <= 0) {
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return `Domani ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function mapDbToSportEvent(row: any, includeSuspended = false): SportEvent {
  const liveData = row.live_data || {};
  return {
    id: row.id,
    externalId: row.external_id || undefined,
    league: row.league?.name || "",
    leagueSlug: row.league?.slug || "",
    leagueIcon: row.sport?.icon || "⚽",
    sportName: row.sport?.name || "",
    sportSlug: row.sport?.slug || "",
    home: row.home_team,
    away: row.away_team,
    time: row.is_live
      ? `LIVE ${row.minute || 0}'`
      : formatKickoffTime(row.starts_at),
    live: (row.is_live || false) && row.status === "live",
    minute: row.minute,
    minuteReceivedAt: row.is_live ? Date.now() : undefined,
    scoreH: row.score_home,
    scoreA: row.score_away,
    period: row.period || undefined,
    periodCode: liveData.periodCode ?? undefined,
    halfScoreHome: Array.isArray(liveData.halfScoreHome) ? liveData.halfScoreHome : undefined,
    halfScoreAway: Array.isArray(liveData.halfScoreAway) ? liveData.halfScoreAway : undefined,
    stats: liveData.stats || undefined,
    matchEvents: Array.isArray(liveData.matchEvents) ? liveData.matchEvents : undefined,
    markets: (row.markets || [])
      .filter((m: any) => m.is_active && !m.is_suspended)
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        marketType: m.market_type,
        line: m.line,
        selections: sortSelections(
          m.name,
          (m.outcomes || [])
            .filter((o: any) => o.is_active && (includeSuspended || !o.is_suspended))
            .map((o: any) => ({
              id: o.id,
              label: o.name,
              odds: parseFloat(o.odds),
              previousOdds: o.previous_odds ? parseFloat(o.previous_odds) : undefined,
              suspended: o.is_suspended ? true : undefined,
            }))
        ),
      })),
  };
}

// ═══ SEED DATA — fallback when DB has no events ═══

const SEED_EVENTS: SportEvent[] = [
  {
    id: "e1", league: "Serie A", leagueIcon: "🇮🇹", sportName: "Calcio", sportSlug: "calcio",
    home: "Inter", away: "Juventus", time: "LIVE 72'", live: true, minute: 72, scoreH: 2, scoreA: 1,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.45 }, { label: "X", odds: 4.50 }, { label: "2", odds: 6.00 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.30 }, { label: "Under", odds: 3.40 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.55 }, { label: "NG", odds: 2.30 }] },
    ],
  },
  {
    id: "e2", league: "Serie A", leagueIcon: "🇮🇹", sportName: "Calcio", sportSlug: "calcio",
    home: "Milan", away: "Napoli", time: "20:45", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.10 }, { label: "X", odds: 3.40 }, { label: "2", odds: 3.20 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.85 }, { label: "Under", odds: 1.95 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.70 }, { label: "NG", odds: 2.10 }] },
    ],
  },
  {
    id: "e3", league: "Premier League", leagueIcon: "🏴", sportName: "Calcio", sportSlug: "calcio",
    home: "Arsenal", away: "Liverpool", time: "21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.30 }, { label: "X", odds: 3.50 }, { label: "2", odds: 2.90 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.75 }, { label: "Under", odds: 2.05 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.60 }, { label: "NG", odds: 2.25 }] },
    ],
  },
  {
    id: "e4", league: "La Liga", leagueIcon: "🇪🇸", sportName: "Calcio", sportSlug: "calcio",
    home: "Real Madrid", away: "Barcelona", time: "LIVE 34'", live: true, minute: 34, scoreH: 0, scoreA: 0,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.60 }, { label: "X", odds: 3.20 }, { label: "2", odds: 2.70 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 2.10 }, { label: "Under", odds: 1.72 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.80 }, { label: "NG", odds: 1.95 }] },
    ],
  },
  {
    id: "e5", league: "Bundesliga", leagueIcon: "🇩🇪", sportName: "Calcio", sportSlug: "calcio",
    home: "Bayern", away: "Dortmund", time: "18:30", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.65 }, { label: "X", odds: 4.00 }, { label: "2", odds: 4.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.50 }, { label: "Under", odds: 2.50 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.65 }, { label: "NG", odds: 2.15 }] },
    ],
  },
  {
    id: "e6", league: "Ligue 1", leagueIcon: "🇫🇷", sportName: "Calcio", sportSlug: "calcio",
    home: "PSG", away: "Marseille", time: "21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.35 }, { label: "X", odds: 5.50 }, { label: "2", odds: 7.50 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.55 }, { label: "Under", odds: 2.40 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.90 }, { label: "NG", odds: 1.85 }] },
    ],
  },
  {
    id: "e7", league: "Champions League", leagueIcon: "🏆", sportName: "Calcio", sportSlug: "calcio",
    home: "Man City", away: "Inter", time: "Domani 21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 1.80 }, { label: "X", odds: 3.60 }, { label: "2", odds: 4.20 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.80 }, { label: "Under", odds: 2.00 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.75 }, { label: "NG", odds: 2.05 }] },
    ],
  },
  {
    id: "e8", league: "Champions League", leagueIcon: "🏆", sportName: "Calcio", sportSlug: "calcio",
    home: "Real Madrid", away: "Bayern", time: "Domani 21:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.20 }, { label: "X", odds: 3.40 }, { label: "2", odds: 3.10 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.70 }, { label: "Under", odds: 2.10 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.65 }, { label: "NG", odds: 2.20 }] },
    ],
  },
  {
    id: "e9", league: "Serie A", leagueIcon: "🇮🇹", sportName: "Calcio", sportSlug: "calcio",
    home: "Roma", away: "Lazio", time: "LIVE 55'", live: true, minute: 55, scoreH: 1, scoreA: 1,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.80 }, { label: "X", odds: 2.90 }, { label: "2", odds: 2.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.90 }, { label: "Under", odds: 1.90 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.20 }, { label: "NG", odds: 4.50 }] },
    ],
  },
  {
    id: "e10", league: "Premier League", leagueIcon: "🏴", sportName: "Calcio", sportSlug: "calcio",
    home: "Man United", away: "Chelsea", time: "15:00", live: false,
    markets: [
      { name: "1X2", selections: [{ label: "1", odds: 2.50 }, { label: "X", odds: 3.30 }, { label: "2", odds: 2.80 }] },
      { name: "O/U 2.5", selections: [{ label: "Over", odds: 1.85 }, { label: "Under", odds: 1.95 }] },
      { name: "GG/NG", selections: [{ label: "GG", odds: 1.72 }, { label: "NG", odds: 2.08 }] },
    ],
  },
];

// ═══ HOOK ═══

export function useSportsbook() {
  const { user, wallet } = useAuth();
  const supabase = createClient();

  const { activeSport, setActiveSport, activeLeague, setActiveLeague } = useSportFilter();
  const [events, setEvents] = useState<SportEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMockData, setIsMockData] = useState(false);
  const [betslip, setBetslip] = useState<BetslipItem[]>([]);
  const [placingBet, setPlacingBet] = useState(false);
  const [betMode, setBetMode] = useState<"auto" | "sistema">("auto");
  const [systemComboSize, setSystemComboSize] = useState(2);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Fetch events from Supabase (via RPC for performance) ──
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      let query = supabase
        .from("events")
        .select(`
          *,
          sport:sports(name, slug, icon),
          league:leagues(name, slug, country, logo_url),
          markets(id, name, slug, market_type, line, sort_order, is_active, is_suspended,
            outcomes(id, name, odds, previous_odds, is_active, is_suspended))
        `)
        .eq("source", "kambi")
        .in("status", ["prematch", "live"]);

      const { data, error: fetchErr } = await query
        .or(`is_live.eq.true,starts_at.gte.${cutoff}`)
        .order("starts_at", { ascending: true })
        .limit(200);

      if (fetchErr) throw fetchErr;

      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        setEvents(SEED_EVENTS);
        setIsMockData(true);
      } else {
        const mapped = rows
          .map((row: any) => mapDbToSportEvent(row))
          .filter((e) => {
            // Exclude Giocatori (player props) — they have their own /marcatori page
            if ((e.sportSlug || "").startsWith("giocatori-")) return false;
            return true;
          });
        setEvents(mapped);
        setIsMockData(false);
      }
    } catch (err: any) {
      console.error("[useSportsbook] fetchEvents error:", err.message);
      setError(err.message);
      setEvents(SEED_EVENTS);
      setIsMockData(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Realtime: subscribe to odds + event updates ──
  useEffect(() => {
    fetchEvents();

    const channel = supabase
      .channel("sportsbook-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "outcomes" },
        (payload) => {
          const updated = payload.new as Record<string, any>;

          // If outcome deactivated or suspended, remove from UI + betslip
          if (!updated.is_active || updated.is_suspended) {
            setEvents((prev) =>
              prev.map((event) => ({
                ...event,
                markets: event.markets.map((market) => ({
                  ...market,
                  selections: market.selections.filter((sel) => sel.id !== updated.id),
                })),
              }))
            );
            setBetslip((prev) => prev.filter((item) => item.outcomeId !== updated.id));
            return;
          }

          const newOdds = parseFloat(updated.odds);

          // Update odds inside events
          setEvents((prev) =>
            prev.map((event) => ({
              ...event,
              markets: event.markets.map((market) => ({
                ...market,
                selections: market.selections.map((sel) =>
                  sel.id === updated.id
                    ? { ...sel, previousOdds: sel.odds, odds: newOdds, changedAt: Date.now() }
                    : sel
                ),
              })),
            }))
          );

          // Keep betslip odds in sync
          setBetslip((prev) =>
            prev.map((item) =>
              item.outcomeId === updated.id
                ? { ...item, odds: newOdds }
                : item
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "markets" },
        (payload) => {
          const updated = payload.new as Record<string, any>;

          // If market deactivated or suspended, remove it + its betslip items
          if (!updated.is_active || updated.is_suspended) {
            setEvents((prev) =>
              prev.map((event) => ({
                ...event,
                markets: event.markets.filter((m) => m.id !== updated.id),
              }))
            );
            setBetslip((prev) => prev.filter((item) => {
              const event = events.find((e) => e.markets.some((m) => m.id === updated.id));
              if (!event) return true;
              const market = event.markets.find((m) => m.id === updated.id);
              return !market || item.marketName !== market.name;
            }));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events" },
        (payload) => {
          const updated = payload.new as Record<string, any>;

          const updatedLiveData = updated.live_data || {};
          setEvents((prev) =>
            prev.map((event) =>
              event.id === updated.id
                ? {
                    ...event,
                    live: (updated.is_live || false) && updated.status === "live",
                    minute: updated.minute,
                    minuteReceivedAt: updated.is_live ? Date.now() : undefined,
                    scoreH: updated.score_home,
                    scoreA: updated.score_away,
                    period: updated.period || undefined,
                    periodCode: updatedLiveData.periodCode ?? undefined,
                    halfScoreHome: Array.isArray(updatedLiveData.halfScoreHome) ? updatedLiveData.halfScoreHome : undefined,
                    halfScoreAway: Array.isArray(updatedLiveData.halfScoreAway) ? updatedLiveData.halfScoreAway : undefined,
                    stats: updatedLiveData.stats || undefined,
                    matchEvents: Array.isArray(updatedLiveData.matchEvents) ? updatedLiveData.matchEvents : undefined,
                    time: updated.is_live
                      ? `LIVE ${updated.minute || 0}'`
                      : formatKickoffTime(updated.starts_at),
                  }
                : event
            )
          );
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  // ── SSE: live odds via Redis (fast path) ──
  const handleOddsChange = useCallback((msg: LiveOddsMessage) => {
    if (!msg.changes || msg.changes.length === 0) {
      // Score/minute-only update — still update event metadata
      if (msg.scores || msg.minute != null || msg.period) {
        setEvents((prev) =>
          prev.map((event) => {
            if (event.externalId !== msg.event_id) return event;
            return {
              ...event,
              ...(msg.scores ? { scoreH: msg.scores.home, scoreA: msg.scores.away } : {}),
              ...(msg.minute != null ? { minute: msg.minute, minuteReceivedAt: Date.now() } : {}),
              ...(msg.period ? { period: msg.period } : {}),
              time: `LIVE ${msg.minute || event.minute || 0}'`,
            };
          })
        );
      }
      return;
    }

    setEvents((prev) =>
      prev.map((event) => {
        if (event.externalId !== msg.event_id) return event;

        const updatedEvent = {
          ...event,
          ...(msg.scores ? { scoreH: msg.scores.home, scoreA: msg.scores.away } : {}),
          ...(msg.minute != null ? { minute: msg.minute, minuteReceivedAt: Date.now() } : {}),
          ...(msg.period ? { period: msg.period } : {}),
          time: `LIVE ${msg.minute || event.minute || 0}'`,
          markets: event.markets.map((market) => ({
            ...market,
            selections: market.selections.map((sel) => {
              const change = msg.changes.find(
                (c) => c.market_type === (market.marketType || market.name) && c.outcome_name === sel.label
              );
              if (!change) return sel;
              return {
                ...sel,
                previousOdds: sel.odds,
                odds: change.odds,
                changedAt: Date.now(),
              };
            }),
          })),
        };

        // Sync betslip odds
        for (const change of msg.changes) {
          setBetslip((prev) =>
            prev.map((item) => {
              if (item.eventId !== event.id) return item;
              if (item.marketName !== change.market_type && event.markets.find(m => m.id === item.marketId)?.marketType !== change.market_type) return item;
              if (item.selection !== change.outcome_name) return item;
              return { ...item, odds: change.odds };
            })
          );
        }

        return updatedEvent;
      })
    );
  }, []);

  useLiveOdds({
    onOddsChange: handleOddsChange,
    enabled: !isMockData,
  });

  // ── Filtered events by sport + league ──
  const filteredEvents = events.filter((e) => {
    if (activeSport && e.sportSlug !== activeSport) return false;
    if (activeLeague && e.leagueSlug !== activeLeague) return false;
    return true;
  });

  // ── Betslip: toggle selection ──
  const toggleBet = (event: SportEvent, marketName: string, selection: Selection) => {
    const exists = betslip.find(
      (b) => b.eventId === event.id && b.marketName === marketName && b.selection === selection.label
    );

    if (exists) {
      setBetslip(betslip.filter(
        (b) => !(b.eventId === event.id && b.marketName === marketName && b.selection === selection.label)
      ));
    } else {
      // Remove other selections for same event+market
      const filtered = betslip.filter(
        (b) => !(b.eventId === event.id && b.marketName === marketName)
      );
      filtered.push({
        eventId: event.id,
        marketName,
        selection: selection.label,
        odds: selection.odds,
        match: `${event.home} vs ${event.away}`,
        marketId: event.markets.find((m) => m.name === marketName)?.id,
        outcomeId: selection.id,
      });
      setBetslip(filtered);
    }
  };

  // ── Betslip: check if selected ──
  const isSelected = (eventId: string, marketName: string, selectionLabel: string) => {
    return betslip.some(
      (b) => b.eventId === eventId && b.marketName === marketName && b.selection === selectionLabel
    );
  };

  // ── Betslip: clear ──
  const clearBetslip = () => setBetslip([]);

  // ── Betslip: total odds ──
  const totalOdds = betslip.reduce((acc, b) => acc * b.odds, 1);

  // ── Place bet via server-side API ──
  const placeBet = async (stake: number, systemType?: string): Promise<{
    success: boolean;
    error?: string;
    flagged?: boolean;
    partial?: boolean;
    accepted_stake?: number;
    pending_acceptance?: boolean;
    updated_selections?: any[];
    combo_count?: number;
    stake_per_combo?: number;
  }> => {
    if (!user) return { success: false, error: "Devi accedere per scommettere" };
    if (!wallet || wallet.balance < stake) return { success: false, error: "Saldo insufficiente" };
    if (betslip.length === 0) return { success: false, error: "Schedina vuota" };
    if (stake < 1) return { success: false, error: "Puntata minima: $1" };
    if (stake > 10000) return { success: false, error: "Puntata massima: $10,000" };

    if (isMockData) {
      return { success: false, error: "Modalita' demo — connetti il database per piazzare scommesse" };
    }

    // Validate betslip — remove items with disappeared markets/outcomes
    const validBetslip = betslip.filter((item) => {
      const ev = events.find((e) => e.id === item.eventId);
      if (!ev) return false;
      const market = ev.markets.find((m) => m.name === item.marketName);
      if (!market) return false;
      return market.selections.some((s) => s.id === item.outcomeId);
    });
    if (validBetslip.length !== betslip.length) {
      setBetslip(validBetslip);
      return { success: false, error: "Alcune selezioni non sono più disponibili e sono state rimosse." };
    }

    setPlacingBet(true);

    try {
      const payload: any = {
        stake,
        selections: betslip.map((b) => ({
          eventId: b.eventId,
          marketId: b.marketId,
          outcomeId: b.outcomeId,
          odds: b.odds,
        })),
      };
      if (systemType) payload.systemType = systemType;

      const res = await fetch("/api/player/place-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setPlacingBet(false);

        // Handle odds changed — update betslip with new odds
        if (data.code === "ODDS_CHANGED" && data.updated_selections) {
          setBetslip((prev) =>
            prev.map((item) => {
              const updated = data.updated_selections.find(
                (s: any) => s.outcomeId === item.outcomeId
              );
              return updated ? { ...item, odds: updated.current_odds } : item;
            })
          );
          return {
            success: false,
            error: "Le quote sono cambiate. La schedina e' stata aggiornata.",
            updated_selections: data.updated_selections,
          };
        }

        // Handle limit exceeded — return max_stake for UI
        if (data.code === "LIMIT_EXCEEDED" || data.code === "DAILY_LIMIT_EXCEEDED") {
          return { success: false, error: data.error, accepted_stake: data.max_stake || data.remaining };
        }

        return { success: false, error: data.error || "Errore nel piazzamento" };
      }

      setBetslip([]);
      setBetMode("auto");
      setPlacingBet(false);

      return {
        success: true,
        flagged: data.flagged,
        partial: data.partial,
        accepted_stake: data.stake,
        pending_acceptance: data.status === "pending_acceptance",
        combo_count: data.combo_count,
        stake_per_combo: data.stake_per_combo,
      };
    } catch (err: any) {
      setPlacingBet(false);
      return { success: false, error: err.message || "Errore imprevisto" };
    }
  };

  return {
    // Events
    events,
    filteredEvents,
    allEvents: events,
    loading,
    error,
    isMockData,
    fetchEvents,

    // Sport filter
    activeSport,
    setActiveSport,

    // Betslip
    betslip,
    placingBet,
    toggleBet,
    isSelected,
    clearBetslip,
    totalOdds,
    placeBet,
    betMode,
    setBetMode,
    systemComboSize,
    setSystemComboSize,
  };
}
