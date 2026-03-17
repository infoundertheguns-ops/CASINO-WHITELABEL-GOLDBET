"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  fetchApi, formatNum, formatNumFull, formatTime,
  coverageColor, coverageBg,
  KPICard, CollapsibleSection, EventDetailModal,
  exportCsv, ExportButton, DonutRing,
} from "./shared";
import type { EventDetail } from "./shared";

// ═══ TYPES ═══

interface LeagueRow {
  league_id: string;
  league_name: string;
  country: string;
  events_count: number;
  avg_source: number;
  avg_db: number;
  coverage_pct: number;
  zero_markets: number;
  gap_events: number;
}

interface SportKPIs {
  total_events: number;
  avg_source: number;
  avg_db: number;
  coverage_pct: number;
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
  source_count: number | null;
  db_count: number;
  gap: number | null;
  coverage_pct: number | null;
}

interface CountryGroup {
  country: string;
  leagues: LeagueRow[];
  totalEvents: number;
  coveragePct: number;
}

// ═══ MAIN COMPONENT ═══

export default function SportDetailDashboard() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const source = "kambi";
  const sourceLabel = "Kambi";

  const [sportName, setSportName] = useState<string>("");
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [kpis, setKpis] = useState<SportKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");

  // Expanded countries (multiple allowed)
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());

  // Expanded league row (one at a time)
  const [expandedLeague, setExpandedLeague] = useState("");
  const [leagueEvents, setLeagueEvents] = useState<LeagueEventRow[]>([]);
  const [leagueEventsLoading, setLeagueEventsLoading] = useState(false);

  // Event detail modal
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Auto-refresh
  const refreshRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRefresh, setLastRefresh] = useState("");

  // ─── Group leagues by country ───
  const countryGroups = useMemo((): CountryGroup[] => {
    const map = new Map<string, LeagueRow[]>();
    for (const league of leagues) {
      const country = league.country || "Altro";
      const list = map.get(country);
      if (list) list.push(league);
      else map.set(country, [league]);
    }

    const groups: CountryGroup[] = [];
    for (const [country, countryLeagues] of map) {
      const totalEvents = countryLeagues.reduce((s, l) => s + l.events_count, 0);
      const totalSource = countryLeagues.reduce((s, l) => s + l.avg_source * l.events_count, 0);
      const totalDb = countryLeagues.reduce((s, l) => s + l.avg_db * l.events_count, 0);
      const coveragePct = totalSource > 0
        ? Math.round((totalDb / totalSource) * 1000) / 10
        : 100;

      groups.push({ country, leagues: countryLeagues, totalEvents, coveragePct });
    }

    // Sort by total events DESC
    groups.sort((a, b) => b.totalEvents - a.totalEvents);
    return groups;
  }, [leagues]);

  // ─── Load sport leagues ───
  const loadData = useCallback(async () => {
    try {
      const p: Record<string, string> = { sport: slug };
      if (statusFilter !== "all") p.status = statusFilter;

      const data = await fetchApi("sport-leagues", p, source);
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
  }, [slug, statusFilter, source]);

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

  // ─── Toggle country expand ───
  const toggleCountry = (country: string) => {
    setExpandedCountries(prev => {
      const next = new Set(prev);
      if (next.has(country)) next.delete(country);
      else next.add(country);
      return next;
    });
  };

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

      const data = await fetchApi("league-events", p, source);
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
    const headers = ["Paese", "Lega", "Eventi", `Avg ${sourceLabel}`, "Avg DB", "Coverage %", "Con Gap", "Zero"];
    const rows = leagues.map(l => [
      l.country || "N/D",
      l.league_name,
      l.events_count,
      l.avg_source,
      l.avg_db,
      l.coverage_pct,
      l.gap_events,
      l.zero_markets,
    ]);
    const filename = `${source}-coverage-${slug}.csv`;
    exportCsv(filename, headers, rows);
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--admin-text-muted, #94a3b8)", fontSize: 16 }}>
        Caricamento dettaglio sport...
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
      {/* Header with back button */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => router.push(`/admin/market-coverage?source=${source}`)}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--admin-border, #1e3a5f)",
              borderRadius: 8,
              color: "var(--admin-text, #e2e8f0)",
              cursor: "pointer",
              padding: "8px 14px",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
            }}
          >
            &larr; Indietro
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
              {sportName} &mdash; Coverage per Lega
            </h2>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
          Auto-refresh 30s {lastRefresh && `\u00B7 ${lastRefresh}`}
        </div>
      </div>

      {/* Filters */}
      <div style={{
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
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid var(--admin-border, #1e3a5f)",
                background: statusFilter === s ? "#2563eb" : "transparent",
                color: statusFilter === s ? "#fff" : "var(--admin-text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: 13,
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <KPICard
            label="Eventi Totali"
            value={formatNumFull(kpis.total_events)}
            color="var(--admin-text, #e2e8f0)"
          />
          <KPICard
            label="Coverage"
            value={`${kpis.coverage_pct}%`}
            color={coverageColor(kpis.coverage_pct)}
          >
            <DonutRing pct={kpis.coverage_pct} size={48} />
          </KPICard>
          <KPICard
            label={`Avg ${sourceLabel} / DB`}
            value={`${kpis.avg_source} / ${kpis.avg_db}`}
            color={kpis.coverage_pct >= 95 ? "#10b981" : "#f59e0b"}
          />
          <KPICard
            label="Zero Mercati"
            value={formatNumFull(kpis.zero_markets)}
            color={kpis.zero_markets > 0 ? "#ef4444" : "#10b981"}
          />
        </div>
      )}

      {/* Country Accordion */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12,
        overflow: "hidden",
      }}>
        <div style={{ maxHeight: 700, overflowY: "auto" }}>
          {countryGroups.map((group) => {
            const isCountryOpen = expandedCountries.has(group.country);
            const covColor = coverageColor(group.coveragePct);

            return (
              <div key={group.country}>
                {/* Country header */}
                <div
                  onClick={() => toggleCountry(group.country)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 20px",
                    background: isCountryOpen ? "rgba(37, 99, 235, 0.10)" : "rgba(255,255,255,0.02)",
                    borderBottom: "1px solid var(--admin-border, #1e3a5f)",
                    cursor: "pointer",
                    transition: "background 0.15s",
                    height: 44,
                  }}
                  onMouseEnter={(e) => { if (!isCountryOpen) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                  onMouseLeave={(e) => { if (!isCountryOpen) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      fontSize: 10,
                      color: "var(--admin-text-muted, #94a3b8)",
                      transition: "transform 0.2s",
                      display: "inline-block",
                      transform: isCountryOpen ? "rotate(90deg)" : "rotate(0deg)",
                    }}>
                      &#9654;
                    </span>
                    <span style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: "var(--admin-text, #e2e8f0)",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}>
                      {group.country}
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.06)",
                      color: "var(--admin-text-muted, #94a3b8)",
                    }}>
                      {group.leagues.length} {group.leagues.length === 1 ? "lega" : "leghe"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--admin-text-muted, #94a3b8)",
                    }}>
                      {formatNumFull(group.totalEvents)} eventi
                    </span>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: coverageBg(group.coveragePct),
                      color: covColor,
                    }}>
                      {group.coveragePct}%
                    </span>
                  </div>
                </div>

                {/* Leagues inside country */}
                {isCountryOpen && (
                  <div>
                    {/* League table header */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1.8fr 0.6fr 0.7fr 0.7fr 1fr 0.5fr 0.5fr",
                      padding: "8px 20px 8px 40px",
                      background: "rgba(255,255,255,0.015)",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: "var(--admin-text-muted, #94a3b8)",
                      letterSpacing: 0.5,
                    }}>
                      <div>Lega</div>
                      <div style={{ textAlign: "center" }}>Eventi</div>
                      <div style={{ textAlign: "center" }}>Avg {sourceLabel}</div>
                      <div style={{ textAlign: "center" }}>Avg DB</div>
                      <div style={{ textAlign: "center" }}>Coverage</div>
                      <div style={{ textAlign: "center" }}>Con Gap</div>
                      <div style={{ textAlign: "center" }}>Zero</div>
                    </div>

                    {/* League rows */}
                    {group.leagues.map((league, i) => {
                      const isExpanded = expandedLeague === league.league_id;
                      const leagueCovColor = coverageColor(league.coverage_pct);
                      return (
                        <div key={league.league_id}>
                          <div
                            onClick={() => handleExpandLeague(league.league_id)}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1.8fr 0.6fr 0.7fr 0.7fr 1fr 0.5fr 0.5fr",
                              padding: "10px 20px 10px 40px",
                              background: isExpanded ? "rgba(37, 99, 235, 0.08)" : (i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)"),
                              borderBottom: "1px solid rgba(255,255,255,0.025)",
                              cursor: "pointer",
                              fontSize: 13,
                              alignItems: "center",
                              transition: "background 0.15s",
                              height: 44,
                            }}
                            onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                            onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)"; }}
                          >
                            <div style={{ fontWeight: 600, color: "var(--admin-text, #e2e8f0)", display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 9, color: "var(--admin-text-muted)" }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                              {league.league_name}
                            </div>
                            <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                              {formatNumFull(league.events_count)}
                            </div>
                            <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b", fontSize: 12 }}>
                              {league.avg_source}
                            </div>
                            <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa", fontSize: 12 }}>
                              {league.avg_db}
                            </div>
                            <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                              <div style={{
                                width: 60, height: 6, borderRadius: 3,
                                background: "rgba(255,255,255,0.06)", overflow: "hidden",
                              }}>
                                <div style={{
                                  width: `${Math.min(100, league.coverage_pct)}%`,
                                  height: "100%", borderRadius: 3,
                                  background: leagueCovColor,
                                  transition: "width 0.3s",
                                }} />
                              </div>
                              <span style={{
                                fontSize: 11, fontWeight: 600, fontFamily: "monospace",
                                padding: "2px 6px", borderRadius: 3,
                                background: coverageBg(league.coverage_pct),
                                color: leagueCovColor,
                              }}>
                                {league.coverage_pct}%
                              </span>
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
                              padding: "8px 20px 12px 56px",
                              background: "rgba(37, 99, 235, 0.04)",
                              borderBottom: "1px solid var(--admin-border, #1e3a5f)",
                              maxHeight: 500,
                              overflowY: "auto",
                            }}>
                              {leagueEventsLoading ? (
                                <div style={{ fontSize: 13, color: "var(--admin-text-muted)", padding: 8 }}>Caricamento eventi...</div>
                              ) : leagueEvents.length === 0 ? (
                                <div style={{ fontSize: 13, color: "var(--admin-text-muted)", padding: 8 }}>Nessun evento</div>
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
                                    <div style={{ textAlign: "center" }}>{sourceLabel}</div>
                                    <div style={{ textAlign: "center" }}>DB</div>
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
                                        padding: "6px 8px",
                                        fontSize: 13,
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
                                        {ev.source_count != null ? ev.source_count : "\u2014"}
                                      </div>
                                      <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa", fontSize: 12 }}>
                                        {ev.db_count}
                                      </div>
                                      <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: ev.gap != null && ev.gap > 0 ? "#ef4444" : "var(--admin-text-muted)" }}>
                                        {ev.gap != null ? (ev.gap > 0 ? `\u2212${ev.gap}` : ev.gap === 0 ? "0" : `+${Math.abs(ev.gap)}`) : "\u2014"}
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
                                          <span style={{ color: "var(--admin-text-muted)", fontSize: 11 }}>&mdash;</span>
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
                  </div>
                )}
              </div>
            );
          })}

          {countryGroups.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
              Nessuna lega trovata
            </div>
          )}
        </div>
      </div>

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
