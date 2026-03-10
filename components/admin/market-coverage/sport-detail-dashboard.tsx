"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchApi, formatNum, formatTime,
  gapColor, gapBg, coverageColor, coverageBg,
  KPICard, CollapsibleSection, EventDetailModal,
  exportCsv, ExportButton,
} from "./shared";
import type { EventDetail } from "./shared";

// ═══ TYPES ═══

interface LeagueRow {
  league_id: string;
  league_name: string;
  country: string;
  events_count: number;
  events_with_source: number;
  avg_vincitu: number;
  avg_source: number | null;
  gap_pct: number | null;
  gap_total: number;
  zero_markets: number;
  gap_events: number;
}

interface SportKPIs {
  total_events: number;
  events_with_source: number;
  avg_vincitu: number;
  avg_source: number;
  gap_pct: number | null;
  zero_markets: number;
  gap_events: number;
}

interface LeagueEventRow {
  id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: string;
  source: string;
  league_name: string;
  source_count: number | null;
  vincitu_count: number;
  gap: number | null;
  coverage_pct: number | null;
}

// ═══ MAIN COMPONENT ═══

export default function SportDetailDashboard() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [sportName, setSportName] = useState<string>("");
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [kpis, setKpis] = useState<SportKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");

  // Expanded league row
  const [expandedLeague, setExpandedLeague] = useState("");
  const [leagueEvents, setLeagueEvents] = useState<LeagueEventRow[]>([]);
  const [leagueEventsLoading, setLeagueEventsLoading] = useState(false);

  // Event detail modal
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Auto-refresh
  const refreshRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRefresh, setLastRefresh] = useState("");

  // ─── Load sport leagues ───
  const loadData = useCallback(async () => {
    try {
      const p: Record<string, string> = { sport: slug };
      if (statusFilter !== "all") p.status = statusFilter;

      const data = await fetchApi("sport-leagues", p);
      setSportName(data.sport?.name || slug);
      setLeagues(data.leagues || []);
      setKpis(data.kpis || null);
      setLastRefresh(new Date().toLocaleTimeString("it-IT"));
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [slug, statusFilter]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  // Auto-refresh 30s
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(loadData, 30000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [loadData]);

  // ─── Expand league → load events ───
  const handleExpandLeague = async (leagueId: string) => {
    if (expandedLeague === leagueId) {
      setExpandedLeague("");
      return;
    }
    setExpandedLeague(leagueId);
    setLeagueEventsLoading(true);
    try {
      const p: Record<string, string> = { league_id: leagueId };
      if (statusFilter !== "all") p.status = statusFilter;

      const data = await fetchApi("league-events", p);
      setLeagueEvents(data.events || []);
    } catch {
      setLeagueEvents([]);
    } finally {
      setLeagueEventsLoading(false);
    }
  };

  // ─── Event detail ───
  const handleEventDetail = async (eventId: string) => {
    setDetailLoading(true);
    try {
      const data = await fetchApi("event-detail", { event_id: eventId });
      setSelectedEvent(data);
    } catch {
      setSelectedEvent(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExportLeagues = () => {
    const headers = ["Lega", "Paese", "Eventi", "Con Source", "Avg Source", "Avg Vincitu", "Gap %", "Mancanti", "Con Gap", "Zero"];
    const rows = leagues.map(l => [
      l.league_name,
      l.country || "N/D",
      l.events_count,
      l.events_with_source,
      l.avg_source,
      l.avg_vincitu,
      l.gap_pct,
      l.gap_total,
      l.gap_events,
      l.zero_markets,
    ]);
    const filename = `market-coverage-${slug}.csv`;
    exportCsv(filename, headers, rows);
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text-muted, #94a3b8)" }}>
        Caricamento dettaglio sport...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#ef4444" }}>
        Errore: {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header with back button */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "16px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => router.push("/admin/market-coverage")}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--admin-border, #1e3a5f)",
              borderRadius: 6,
              color: "var(--admin-text, #e2e8f0)",
              cursor: "pointer",
              padding: "6px 10px",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
            }}
          >
            ← Indietro
          </button>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text, #e2e8f0)" }}>
            {sportName} — Gap per Lega
          </h2>
        </div>
        <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>
          Auto-refresh 30s {lastRefresh && `· ${lastRefresh}`}
        </div>
      </div>

      {/* Filters */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "12px 20px",
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["all", "live", "prematch"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--admin-border, #1e3a5f)",
                background: statusFilter === s ? "#2563eb" : "transparent",
                color: statusFilter === s ? "#fff" : "var(--admin-text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              {s === "all" ? "Tutti" : s === "live" ? "Live" : "Prematch"}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <ExportButton onClick={handleExportLeagues} />
        </div>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <KPICard
            label="Eventi Totali"
            value={formatNum(kpis.total_events)}
            color="var(--admin-text, #e2e8f0)"
            subtitle={`${kpis.events_with_source} con source data`}
          />
          <KPICard
            label="Avg Source → Vincitu"
            value={`${kpis.avg_source || "—"} → ${kpis.avg_vincitu}`}
            color={kpis.gap_pct != null && kpis.gap_pct > 5 ? "#f59e0b" : "#10b981"}
          />
          <KPICard
            label="Gap Medio"
            value={kpis.gap_pct != null ? `${kpis.gap_pct}%` : "N/D"}
            color={kpis.gap_pct != null ? gapColor(kpis.gap_pct) : "var(--admin-text-muted)"}
          />
          <KPICard
            label="Zero Mercati"
            value={formatNum(kpis.zero_markets)}
            color={kpis.zero_markets > 0 ? "#ef4444" : "#10b981"}
          />
        </div>
      )}

      {/* Leagues Table */}
      <CollapsibleSection
        title={`Leghe (${leagues.length})`}
        open={true}
        onToggle={() => {}}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 0.6fr 0.5fr 0.6fr 0.6fr 0.6fr 0.5fr 0.5fr 0.4fr",
            padding: "10px 16px",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid var(--admin-border, #1e3a5f)",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            color: "var(--admin-text-muted, #94a3b8)",
            letterSpacing: 0.5,
          }}>
            <div>Lega</div>
            <div style={{ textAlign: "center" }}>Eventi</div>
            <div style={{ textAlign: "center" }}>Source</div>
            <div style={{ textAlign: "center" }}>Avg Src</div>
            <div style={{ textAlign: "center" }}>Avg Vin</div>
            <div style={{ textAlign: "center" }}>Gap %</div>
            <div style={{ textAlign: "center" }}>Mancanti</div>
            <div style={{ textAlign: "center" }}>Con Gap</div>
            <div style={{ textAlign: "center" }}>Zero</div>
          </div>

          {/* Table rows */}
          <div style={{ maxHeight: 600, overflowY: "auto" }}>
            {leagues.map((league, i) => {
              const isExpanded = expandedLeague === league.league_id;
              return (
                <div key={league.league_id}>
                  <div
                    onClick={() => handleExpandLeague(league.league_id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.6fr 0.6fr 0.5fr 0.6fr 0.6fr 0.6fr 0.5fr 0.5fr 0.4fr",
                      padding: "8px 16px",
                      background: isExpanded ? "rgba(37, 99, 235, 0.08)" : (i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)"),
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      fontSize: 13,
                      alignItems: "center",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget.style.background = "rgba(255,255,255,0.04)"); }}
                    onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)"); }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--admin-text, #e2e8f0)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "var(--admin-text-muted)" }}>{isExpanded ? "▼" : "▶"}</span>
                      {league.league_name}
                    </div>
                    <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                      {formatNum(league.events_count)}
                    </div>
                    <div style={{ textAlign: "center", fontSize: 11, color: "var(--admin-text-muted)" }}>
                      {league.events_with_source}/{league.events_count}
                    </div>
                    <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b", fontSize: 12 }}>
                      {league.avg_source != null ? league.avg_source : "—"}
                    </div>
                    <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa", fontSize: 12 }}>
                      {league.avg_vincitu}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      {league.gap_pct != null ? (
                        <span style={{
                          fontSize: 12,
                          fontWeight: 600,
                          fontFamily: "monospace",
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: gapBg(league.gap_pct),
                          color: gapColor(league.gap_pct),
                        }}>
                          {league.gap_pct}%
                        </span>
                      ) : (
                        <span style={{ color: "var(--admin-text-muted)", fontSize: 12 }}>—</span>
                      )}
                    </div>
                    <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: league.gap_total > 0 ? "#ef4444" : "var(--admin-text-muted)", fontSize: 12 }}>
                      {formatNum(league.gap_total)}
                    </div>
                    <div style={{ textAlign: "center", fontWeight: 600, color: league.gap_events > 0 ? "#f59e0b" : "var(--admin-text-muted)" }}>
                      {league.gap_events}
                    </div>
                    <div style={{ textAlign: "center", color: league.zero_markets > 0 ? "#ef4444" : "var(--admin-text-muted)", fontWeight: 600 }}>
                      {league.zero_markets}
                    </div>
                  </div>

                  {/* Expanded: league events */}
                  {isExpanded && (
                    <div style={{
                      padding: "8px 16px 12px 32px",
                      background: "rgba(37, 99, 235, 0.04)",
                      borderBottom: "1px solid var(--admin-border, #1e3a5f)",
                      maxHeight: 500,
                      overflowY: "auto",
                    }}>
                      {leagueEventsLoading ? (
                        <div style={{ fontSize: 12, color: "var(--admin-text-muted)", padding: 8 }}>Caricamento eventi...</div>
                      ) : leagueEvents.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--admin-text-muted)", padding: 8 }}>Nessun evento</div>
                      ) : (
                        <div>
                          {/* Events header */}
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 0.5fr 0.5fr 0.5fr 0.6fr 0.6fr",
                            padding: "6px 8px",
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            color: "var(--admin-text-muted, #94a3b8)",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                          }}>
                            <div>Evento</div>
                            <div style={{ textAlign: "center" }}>Source</div>
                            <div style={{ textAlign: "center" }}>Vincitu</div>
                            <div style={{ textAlign: "center" }}>Gap</div>
                            <div style={{ textAlign: "center" }}>Coverage</div>
                            <div style={{ textAlign: "center" }}>Data</div>
                          </div>

                          {/* Events rows */}
                          {leagueEvents.map((ev) => (
                            <div
                              key={ev.id}
                              onClick={() => handleEventDetail(ev.id)}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "2fr 0.5fr 0.5fr 0.5fr 0.6fr 0.6fr",
                                padding: "5px 8px",
                                fontSize: 12,
                                cursor: "pointer",
                                borderBottom: "1px solid rgba(255,255,255,0.02)",
                                alignItems: "center",
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                            >
                              <div style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 500 }}>
                                {ev.home_team} vs {ev.away_team}
                              </div>
                              <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b", fontSize: 12 }}>
                                {ev.source_count != null ? ev.source_count : "—"}
                              </div>
                              <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa", fontSize: 12 }}>
                                {ev.vincitu_count}
                              </div>
                              <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: ev.gap != null && ev.gap > 0 ? "#ef4444" : "var(--admin-text-muted)" }}>
                                {ev.gap != null ? (ev.gap > 0 ? `−${ev.gap}` : ev.gap === 0 ? "0" : `+${Math.abs(ev.gap)}`) : "—"}
                              </div>
                              <div style={{ textAlign: "center" }}>
                                {ev.coverage_pct != null ? (
                                  <span style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: "2px 6px",
                                    borderRadius: 3,
                                    background: coverageBg(ev.coverage_pct),
                                    color: coverageColor(ev.coverage_pct),
                                  }}>
                                    {ev.coverage_pct}%
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--admin-text-muted)", fontSize: 11 }}>—</span>
                                )}
                              </div>
                              <div style={{ textAlign: "center", fontSize: 11, color: "var(--admin-text-muted)" }}>
                                {formatTime(ev.starts_at)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {leagues.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
                Nessuna lega trovata
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Event Detail Modal */}
      {(selectedEvent || detailLoading) && (
        <EventDetailModal
          detail={selectedEvent}
          loading={detailLoading}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
