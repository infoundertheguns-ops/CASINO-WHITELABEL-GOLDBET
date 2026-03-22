"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  IppicaMeeting, IppicaRace, IppicaMarketWithOdds, NextRaceInfo,
} from "@/lib/types/ippica";

// ═══ MEETINGS + RACES HOOK ═══

export function useIppica() {
  const [meetings, setMeetings] = useState<IppicaMeeting[]>([]);
  const [races, setRaces] = useState<IppicaRace[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialSelectDone = useRef(false);

  const fetchMeetings = useCallback(async () => {
    try {
      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);
      const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      const { data, error: mErr } = await supabase
        .from("ippica_meetings")
        .select("*")
        .gte("meeting_date", today)
        .lte("meeting_date", weekAhead)
        .order("country")
        .order("name");

      if (mErr) throw mErr;
      const meetingsData = data || [];
      setMeetings(meetingsData);

      // Auto-select first meeting (prefer Italian)
      if (!initialSelectDone.current && meetingsData.length > 0) {
        const italian = meetingsData.find(m => m.country === "Italy");
        setSelectedMeetingId(italian?.id || meetingsData[0].id);
        initialSelectDone.current = true;
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

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

  useEffect(() => { fetchMeetings(); }, [fetchMeetings]);
  useEffect(() => { fetchRaces(); }, [fetchRaces]);

  // Refresh every 60s
  useEffect(() => {
    const interval = setInterval(() => { fetchMeetings(); fetchRaces(); }, 60000);
    return () => clearInterval(interval);
  }, [fetchMeetings, fetchRaces]);

  // Group meetings by country, Italy first
  const meetingsByCountry = useMemo(() => {
    const map = new Map<string, IppicaMeeting[]>();
    for (const m of meetings) {
      const list = map.get(m.country) || [];
      list.push(m);
      map.set(m.country, list);
    }
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
    loading, error, refresh: fetchMeetings,
  };
}

// ═══ RACE DETAIL HOOK (with polling) ═══

export function useIppicaRace(raceId: string | null) {
  const [race, setRace] = useState<IppicaRace | null>(null);
  const [runners, setRunners] = useState<any[]>([]);
  const [markets, setMarkets] = useState<IppicaMarketWithOdds[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRace = useCallback(async () => {
    if (!raceId) { setLoading(false); return; }
    try {
      const supabase = createClient();

      const { data: raceData } = await supabase
        .from("ippica_races")
        .select("*, ippica_meetings!inner(name, country, race_type)")
        .eq("id", raceId)
        .single();

      if (raceData) {
        setRace({
          ...raceData,
          meeting_name: (raceData as any).ippica_meetings?.name,
          meeting_country: (raceData as any).ippica_meetings?.country,
          meeting_race_type: (raceData as any).ippica_meetings?.race_type,
        });
      }

      const { data: runnersData } = await supabase
        .from("ippica_runners")
        .select("*")
        .eq("race_id", raceId)
        .order("runner_number");

      setRunners(runnersData || []);

      const { data: marketsData } = await supabase
        .from("ippica_markets")
        .select("*, ippica_odds(*)")
        .eq("race_id", raceId)
        .eq("is_active", true);

      if (marketsData) {
        setMarkets(marketsData.map((m: any) => ({
          ...m,
          odds: m.ippica_odds || [],
        })));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [raceId]);

  useEffect(() => { fetchRace(); }, [fetchRace]);

  // Poll every 30s
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
