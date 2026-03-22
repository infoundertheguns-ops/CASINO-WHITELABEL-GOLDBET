"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatNumFull, coverageColor, KPICard } from "./shared";

// ═══ TYPES ═══

interface MeetingRow {
  id: string;
  name: string;
  country: string;
  race_type: string;
  meeting_date: string;
  status: string;
  race_count: number;
  races_in_db: number;
  runners_count: number;
  markets_count: number;
  odds_count: number;
}

interface RaceRow {
  id: string;
  title: string;
  race_number: number;
  scheduled_at: string;
  status: string;
  runners_count: number;
  winner_odds: number;
  place_odds: number;
  h2h_markets: number;
  eo_markets: number;
  total_odds: number;
}

// ═══ MAIN ═══

export default function IppicaCoverage() {
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);
  const [races, setRaces] = useState<RaceRow[]>([]);
  const [racesLoading, setRacesLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");

  const loadData = useCallback(async () => {
    try {
      const supabase = createClient();

      // Fetch meetings with aggregated counts
      const { data: meetingsData, error: mErr } = await supabase
        .from("ippica_meetings")
        .select("*")
        .order("meeting_date", { ascending: false })
        .order("country")
        .order("name")
        .limit(200);

      if (mErr) throw mErr;

      // For each meeting, get race/runner/market/odds counts
      const meetingIds = (meetingsData || []).map((m: any) => m.id);

      // Races per meeting
      const { data: racesData } = await supabase
        .from("ippica_races")
        .select("id, meeting_id, runners_count")
        .in("meeting_id", meetingIds);

      // Markets per race
      const raceIds = (racesData || []).map((r: any) => r.id);
      const { data: marketsData } = await supabase
        .from("ippica_markets")
        .select("id, race_id")
        .in("race_id", raceIds.length > 0 ? raceIds : ["none"])
        .eq("is_active", true);

      // Odds count per market
      const marketIds = (marketsData || []).map((m: any) => m.id);
      let oddsCount = 0;
      if (marketIds.length > 0) {
        // Count in batches
        for (let i = 0; i < marketIds.length; i += 500) {
          const batch = marketIds.slice(i, i + 500);
          const { count } = await supabase
            .from("ippica_odds")
            .select("id", { count: "exact", head: true })
            .in("market_id", batch);
          oddsCount += count || 0;
        }
      }

      // Build meeting rows
      const racesByMeeting = new Map<string, any[]>();
      for (const r of (racesData || [])) {
        const list = racesByMeeting.get(r.meeting_id) || [];
        list.push(r);
        racesByMeeting.set(r.meeting_id, list);
      }

      const marketsByRace = new Map<string, number>();
      for (const m of (marketsData || [])) {
        marketsByRace.set(m.race_id, (marketsByRace.get(m.race_id) || 0) + 1);
      }

      const rows: MeetingRow[] = (meetingsData || []).map((m: any) => {
        const mRaces = racesByMeeting.get(m.id) || [];
        const runnersTotal = mRaces.reduce((s: number, r: any) => s + (r.runners_count || 0), 0);
        const marketsTotal = mRaces.reduce((s: number, r: any) => s + (marketsByRace.get(r.id) || 0), 0);

        return {
          id: m.id,
          name: m.name,
          country: m.country,
          race_type: m.race_type,
          meeting_date: m.meeting_date,
          status: m.status,
          race_count: m.race_count,
          races_in_db: mRaces.length,
          runners_count: runnersTotal,
          markets_count: marketsTotal,
          odds_count: 0, // filled below
        };
      });

      setMeetings(rows);
      setLastRefresh(new Date().toLocaleTimeString("it-IT"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Load races for expanded meeting
  const loadRaces = async (meetingId: string) => {
    if (expandedMeeting === meetingId) { setExpandedMeeting(null); return; }
    setExpandedMeeting(meetingId);
    setRacesLoading(true);
    try {
      const supabase = createClient();
      const { data: racesData } = await supabase
        .from("ippica_races")
        .select("id, title, race_number, scheduled_at, status, runners_count")
        .eq("meeting_id", meetingId)
        .order("race_number");

      if (!racesData || racesData.length === 0) { setRaces([]); return; }

      const raceIds = racesData.map((r: any) => r.id);
      const { data: marketsData } = await supabase
        .from("ippica_markets")
        .select("id, race_id, market_type")
        .in("race_id", raceIds)
        .eq("is_active", true);

      const { data: oddsData } = await supabase
        .from("ippica_odds")
        .select("id, market_id")
        .in("market_id", (marketsData || []).map((m: any) => m.id).length > 0
          ? (marketsData || []).map((m: any) => m.id)
          : ["none"]);

      // Count odds per race
      const oddsPerMarket = new Map<string, number>();
      for (const o of (oddsData || [])) {
        oddsPerMarket.set(o.market_id, (oddsPerMarket.get(o.market_id) || 0) + 1);
      }

      const raceRows: RaceRow[] = racesData.map((r: any) => {
        const rMarkets = (marketsData || []).filter((m: any) => m.race_id === r.id);
        const winner = rMarkets.filter((m: any) => m.market_type === "Winner").length;
        const place = rMarkets.filter((m: any) => m.market_type.startsWith("Place")).length;
        const h2h = rMarkets.filter((m: any) => m.market_type === "Head to head").length;
        const eo = rMarkets.filter((m: any) => m.market_type === "Even and odd").length;
        const totalOdds = rMarkets.reduce((s: number, m: any) => s + (oddsPerMarket.get(m.id) || 0), 0);

        return {
          id: r.id,
          title: r.title,
          race_number: r.race_number,
          scheduled_at: r.scheduled_at,
          status: r.status,
          runners_count: r.runners_count,
          winner_odds: winner,
          place_odds: place,
          h2h_markets: h2h,
          eo_markets: eo,
          total_odds: totalOdds,
        };
      });

      setRaces(raceRows);
    } catch {
      setRaces([]);
    } finally {
      setRacesLoading(false);
    }
  };

  // KPIs
  const totalMeetings = meetings.length;
  const totalRaces = meetings.reduce((s, m) => s + m.races_in_db, 0);
  const totalRunners = meetings.reduce((s, m) => s + m.runners_count, 0);
  const totalMarkets = meetings.reduce((s, m) => s + m.markets_count, 0);
  const activeMeetings = meetings.filter(m => m.status === "active" || m.status === "scheduled").length;

  const STATUS_COLORS: Record<string, string> = {
    scheduled: "#94a3b8",
    active: "#10b981",
    completed: "#60a5fa",
  };

  const RACE_STATUS_COLORS: Record<string, string> = {
    scheduled: "#94a3b8",
    open: "#10b981",
    closed: "#f59e0b",
    running: "#ef4444",
    finished: "#60a5fa",
    abandoned: "#6b7280",
  };

  const COUNTRY_FLAGS: Record<string, string> = {
    "Italy": "🇮🇹", "United Kingdom": "🇬🇧", "France": "🇫🇷",
    "Ireland": "🇮🇪", "USA": "🇺🇸", "Sweden": "🇸🇪",
    "Germany": "🇩🇪", "Australia": "🇦🇺", "South Africa": "🇿🇦",
    "Japan": "🇯🇵", "Argentina": "🇦🇷", "Brazil": "🇧🇷",
    "Chile": "🇨🇱", "UAE": "🇦🇪", "Hong Kong": "🇭🇰",
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "#94a3b8", fontSize: 16 }}>
        Caricamento Ippica Coverage...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "#ef4444", fontSize: 16 }}>
        Errore: {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Ippica Market Coverage
          </h2>
          <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 4 }}>
            MST Channel — Meeting, Corse, Mercati, Quote
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
            {lastRefresh && `Aggiornato: ${lastRefresh}`}
          </span>
          <button
            onClick={() => { setLoading(true); loadData(); }}
            style={{
              padding: "8px 16px", borderRadius: 8,
              border: "1px solid var(--admin-border, #1e3a5f)",
              background: "transparent", color: "var(--admin-text, #e2e8f0)",
              cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}
          >
            Aggiorna
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
        <KPICard label="Meeting" value={formatNumFull(totalMeetings)} color="#e2e8f0" subtitle={`${activeMeetings} attivi`} />
        <KPICard label="Corse" value={formatNumFull(totalRaces)} color="#60a5fa" />
        <KPICard label="Runners" value={formatNumFull(totalRunners)} color="#a78bfa" />
        <KPICard label="Mercati" value={formatNumFull(totalMarkets)} color="#10b981" />
        <KPICard label="Paesi" value={formatNumFull(new Set(meetings.map(m => m.country)).size)} color="#f59e0b" />
      </div>

      {/* Meeting Table */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        borderRadius: 12,
        border: "1px solid var(--admin-border, #1e3a5f)",
        overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{
              background: "rgba(255,255,255,0.03)",
              borderBottom: "1px solid var(--admin-border, #1e3a5f)",
            }}>
              {["", "Meeting", "Paese", "Tipo", "Data", "Status", "Corse", "Runners", "Mercati"].map(h => (
                <th key={h} style={{
                  padding: "10px 12px", textAlign: "left", fontSize: 11,
                  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px",
                  color: "var(--admin-text-muted, #94a3b8)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meetings.map(m => (
              <>
                <tr
                  key={m.id}
                  onClick={() => loadRaces(m.id)}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    cursor: "pointer",
                    background: expandedMeeting === m.id ? "rgba(255,255,255,0.03)" : "transparent",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = expandedMeeting === m.id ? "rgba(255,255,255,0.03)" : "transparent"; }}
                >
                  <td style={{ padding: "8px 12px", width: 30, color: "#94a3b8" }}>
                    {expandedMeeting === m.id ? "▼" : "▶"}
                  </td>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                    {m.name}
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--admin-text-muted, #94a3b8)" }}>
                    {COUNTRY_FLAGS[m.country] || "🏳️"} {m.country}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: m.race_type === "TR" ? "#7c3aed20" : "#06b6d420",
                      color: m.race_type === "TR" ? "#a78bfa" : "#22d3ee",
                    }}>
                      {m.race_type === "TR" ? "TROTTO" : "GALOPPO"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--admin-text-muted, #94a3b8)", fontFamily: "monospace", fontSize: 12 }}>
                    {m.meeting_date}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: `${STATUS_COLORS[m.status] || "#94a3b8"}20`,
                      color: STATUS_COLORS[m.status] || "#94a3b8",
                    }}>
                      {m.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)" }}>
                    {m.races_in_db}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)" }}>
                    {m.runners_count}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)" }}>
                    {m.markets_count}
                  </td>
                </tr>

                {/* Expanded races */}
                {expandedMeeting === m.id && (
                  <tr key={`${m.id}-detail`}>
                    <td colSpan={9} style={{ padding: 0 }}>
                      <div style={{
                        background: "rgba(0,0,0,0.2)",
                        borderTop: "1px solid rgba(255,255,255,0.04)",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}>
                        {racesLoading ? (
                          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                            Caricamento corse...
                          </div>
                        ) : races.length === 0 ? (
                          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                            Nessuna corsa
                          </div>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                                {["#", "Titolo", "Ora", "Status", "Runners", "Winner", "Place", "H2H", "P/D", "Tot Quote"].map(h => (
                                  <th key={h} style={{
                                    padding: "8px 10px", textAlign: "left", fontSize: 10,
                                    fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px",
                                    color: "#64748b",
                                  }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {races.map(r => (
                                <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                                  <td style={{ padding: "6px 10px", fontWeight: 700, color: "#f0b429" }}>
                                    {r.race_number}
                                  </td>
                                  <td style={{ padding: "6px 10px", color: "#e2e8f0", fontWeight: 500 }}>
                                    {r.title}
                                  </td>
                                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#94a3b8" }}>
                                    {new Date(r.scheduled_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                                  </td>
                                  <td style={{ padding: "6px 10px" }}>
                                    <span style={{
                                      padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                                      background: `${RACE_STATUS_COLORS[r.status] || "#94a3b8"}20`,
                                      color: RACE_STATUS_COLORS[r.status] || "#94a3b8",
                                    }}>
                                      {r.status.toUpperCase()}
                                    </span>
                                  </td>
                                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#e2e8f0" }}>
                                    {r.runners_count}
                                  </td>
                                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: r.winner_odds > 0 ? "#10b981" : "#ef4444" }}>
                                    {r.winner_odds > 0 ? "✓" : "✗"}
                                  </td>
                                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: r.place_odds > 0 ? "#10b981" : "#ef4444" }}>
                                    {r.place_odds > 0 ? `✓ (${r.place_odds})` : "✗"}
                                  </td>
                                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: r.h2h_markets > 0 ? "#10b981" : "#6b7280" }}>
                                    {r.h2h_markets || "—"}
                                  </td>
                                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: r.eo_markets > 0 ? "#10b981" : "#6b7280" }}>
                                    {r.eo_markets || "—"}
                                  </td>
                                  <td style={{ padding: "6px 10px", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa" }}>
                                    {r.total_odds}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
