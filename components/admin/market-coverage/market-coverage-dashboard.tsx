"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ═══ TYPES ═══

interface SummaryRow {
  sport_name: string;
  sport_slug: string;
  source: string;
  status: string;
  total_events: number;
  avg_markets: number;
  min_markets: number;
  max_markets: number;
  total_markets: number;
  zero_market_events: number;
  low_coverage_events: number;
  goldbet_avg: number | null;
  diff_pct: number | null;
}

interface LowCoverageEvent {
  event_id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  sport_name: string;
  sport_slug: string;
  source: string;
  status: string;
  market_count: number;
  sport_avg: number;
  coverage_pct: number;
  starts_at: string;
}

interface StatsData {
  summary: SummaryRow[];
  low_coverage_events: LowCoverageEvent[];
  generated_at: string;
  has_scraper_data: boolean;
}

interface EventRow {
  id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: string;
  source: string;
  sport_name: string;
  league_name: string;
  market_count: number;
  sport_avg: number;
  coverage_pct: number | null;
}

interface EventDetail {
  event: {
    id: string;
    home_team: string;
    away_team: string;
    starts_at: string;
    status: string;
    source: string;
    sport_name: string;
    league_name: string;
  };
  market_count: number;
  market_types: { type: string; count: number; markets: string[] }[];
}

// ═══ HELPERS ═══

function formatNum(n: number): string {
  return n.toLocaleString("it-IT");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function coverageColor(pct: number | null): string {
  if (pct == null) return "var(--admin-text-muted, #94a3b8)";
  if (pct >= 90) return "#10b981";
  if (pct >= 75) return "#f59e0b";
  return "#ef4444";
}

function coverageBg(pct: number | null): string {
  if (pct == null) return "transparent";
  if (pct >= 90) return "#10b98115";
  if (pct >= 75) return "#f59e0b15";
  return "#ef444415";
}

async function fetchApi(action: string, params: Record<string, string> = {}) {
  const sp = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/admin/market-coverage?${sp}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ═══ MAIN COMPONENT ═══

export default function MarketCoverageDashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Filters
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Collapsible sections
  const [sportTableOpen, setSportTableOpen] = useState(true);
  const [lowCovOpen, setLowCovOpen] = useState(false);

  // Expanded sport row (drill-down)
  const [expandedRow, setExpandedRow] = useState<string>("");
  const [expandedEvents, setExpandedEvents] = useState<EventRow[]>([]);
  const [expandedTotal, setExpandedTotal] = useState(0);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // Event detail modal
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Auto-refresh
  const refreshRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  // ─── Load stats ───
  const loadStats = useCallback(async () => {
    try {
      const data = await fetchApi("stats");
      setStats(data);
      setLastRefresh(new Date().toLocaleTimeString("it-IT"));
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(loadStats, 30000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [loadStats]);

  // ─── Filter summary rows ───
  const filteredSummary = (stats?.summary || []).filter((row) => {
    if (sportFilter !== "all" && row.sport_slug !== sportFilter) return false;
    if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    return true;
  });

  const filteredLowCov = (stats?.low_coverage_events || []).filter((row) => {
    if (sportFilter !== "all" && row.sport_slug !== sportFilter) return false;
    if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    return true;
  });

  // ─── Sport options for filter ───
  const sportOptions = Array.from(new Set((stats?.summary || []).map((r) => r.sport_slug)))
    .map((slug) => {
      const row = stats!.summary.find((r) => r.sport_slug === slug);
      return { value: slug, label: row?.sport_name || slug };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  // ─── KPI totals ───
  const totalEvents = filteredSummary.reduce((s, r) => s + r.total_events, 0);
  const totalMarkets = filteredSummary.reduce((s, r) => s + r.total_markets, 0);
  const avgMarketsGlobal = totalEvents > 0 ? Math.round((totalMarkets / totalEvents) * 10) / 10 : 0;
  const zeroMarketEvents = filteredSummary.reduce((s, r) => s + r.zero_market_events, 0);
  const lowCoverageCount = filteredSummary.reduce((s, r) => s + r.low_coverage_events, 0);

  // ─── Expand sport row ───
  const handleExpandRow = async (rowKey: string, sport: string, source: string, status: string) => {
    if (expandedRow === rowKey) {
      setExpandedRow("");
      return;
    }
    setExpandedRow(rowKey);
    setExpandedLoading(true);
    try {
      const data = await fetchApi("events", { sport, source, status, limit: "200" });
      setExpandedEvents(data.events || []);
      setExpandedTotal(data.total || 0);
    } catch {
      setExpandedEvents([]);
      setExpandedTotal(0);
    } finally {
      setExpandedLoading(false);
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

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text-muted, #94a3b8)" }}>
        Caricamento report coverage...
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
      {/* Header */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "16px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text, #e2e8f0)" }}>
          Market Coverage Report
        </h2>
        <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>
          Auto-refresh 30s {lastRefresh && `· ${lastRefresh}`}
          {stats?.has_scraper_data && (
            <span style={{ marginLeft: 8, color: "#10b981" }}>Scraper data disponibile</span>
          )}
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
        <FilterSelect
          label="Sport"
          value={sportFilter}
          onChange={setSportFilter}
          options={[{ value: "all", label: "Tutti" }, ...sportOptions]}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {["all", "goldbet", "kambi"].map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--admin-border, #1e3a5f)",
                background: sourceFilter === s ? "#2563eb" : "transparent",
                color: sourceFilter === s ? "#fff" : "var(--admin-text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              {s === "all" ? "Tutte" : s === "goldbet" ? "Goldbet" : "Kambi"}
            </button>
          ))}
        </div>
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
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KPICard label="Eventi Attivi" value={formatNum(totalEvents)} color="#60a5fa" />
        <KPICard label="Avg Mercati/Evento" value={String(avgMarketsGlobal)} color="#8b5cf6" />
        <KPICard label="Zero Mercati" value={formatNum(zeroMarketEvents)} color={zeroMarketEvents > 0 ? "#ef4444" : "#10b981"} />
        <KPICard label="Bassa Copertura" value={formatNum(lowCoverageCount)} color={lowCoverageCount > 0 ? "#f59e0b" : "#10b981"} />
      </div>

      {/* Sport Coverage Table */}
      <CollapsibleSection
        title={`Coverage per Sport (${filteredSummary.length})`}
        open={sportTableOpen}
        onToggle={() => setSportTableOpen(!sportTableOpen)}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 0.8fr 0.8fr 0.7fr 0.7fr 0.8fr 0.7fr 0.6fr 0.6fr",
            padding: "10px 16px",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid var(--admin-border, #1e3a5f)",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            color: "var(--admin-text-muted, #94a3b8)",
            letterSpacing: 0.5,
          }}>
            <div>Sport</div>
            <div style={{ textAlign: "center" }}>Source</div>
            <div style={{ textAlign: "center" }}>Status</div>
            <div style={{ textAlign: "center" }}>Eventi</div>
            <div style={{ textAlign: "center" }}>Avg DB</div>
            <div style={{ textAlign: "center" }}>Avg GB</div>
            <div style={{ textAlign: "center" }}>Diff%</div>
            <div style={{ textAlign: "center" }}>Low</div>
            <div style={{ textAlign: "center" }}>Zero</div>
          </div>

          {/* Table rows */}
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            {filteredSummary.map((row, i) => {
              const rowKey = `${row.sport_slug}:${row.source}:${row.status}`;
              const isExpanded = expandedRow === rowKey;
              return (
                <div key={rowKey}>
                  <div
                    onClick={() => handleExpandRow(rowKey, row.sport_slug, row.source, row.status)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.5fr 0.8fr 0.8fr 0.7fr 0.7fr 0.8fr 0.7fr 0.6fr 0.6fr",
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
                      {row.sport_name}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 3,
                        background: row.source === "goldbet" ? "#f59e0b20" : "#8b5cf620",
                        color: row.source === "goldbet" ? "#f59e0b" : "#8b5cf6",
                        textTransform: "uppercase",
                      }}>
                        {row.source === "goldbet" ? "GB" : "K"}
                      </span>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: row.status === "live" ? "#10b981" : "#94a3b8",
                        textTransform: "uppercase",
                      }}>
                        {row.status}
                      </span>
                    </div>
                    <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                      {formatNum(row.total_events)}
                    </div>
                    <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)", fontFamily: "monospace" }}>
                      {row.avg_markets}
                    </div>
                    <div style={{ textAlign: "center", fontFamily: "monospace", color: row.goldbet_avg != null ? "#f59e0b" : "var(--admin-text-muted)" }}>
                      {row.goldbet_avg != null ? row.goldbet_avg : "—"}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      {row.diff_pct != null ? (
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: coverageBg(row.diff_pct),
                          color: coverageColor(row.diff_pct),
                        }}>
                          {row.diff_pct.toFixed(0)}%
                        </span>
                      ) : (
                        <span style={{ color: "var(--admin-text-muted)" }}>—</span>
                      )}
                    </div>
                    <div style={{ textAlign: "center", color: row.low_coverage_events > 0 ? "#f59e0b" : "var(--admin-text-muted)", fontWeight: 600 }}>
                      {row.low_coverage_events}
                    </div>
                    <div style={{ textAlign: "center", color: row.zero_market_events > 0 ? "#ef4444" : "var(--admin-text-muted)", fontWeight: 600 }}>
                      {row.zero_market_events}
                    </div>
                  </div>

                  {/* Expanded: events list */}
                  {isExpanded && (
                    <div style={{ padding: "8px 16px 12px 32px", background: "rgba(37, 99, 235, 0.04)", borderBottom: "1px solid var(--admin-border, #1e3a5f)", maxHeight: 500, overflowY: "auto" }}>
                      {expandedLoading ? (
                        <div style={{ fontSize: 12, color: "var(--admin-text-muted)", padding: 8 }}>Caricamento eventi...</div>
                      ) : expandedEvents.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--admin-text-muted)", padding: 8 }}>Nessun evento</div>
                      ) : (
                        <div>
                          {expandedTotal > expandedEvents.length && (
                            <div style={{ fontSize: 11, color: "var(--admin-text-muted)", padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                              Mostrando {expandedEvents.length} di {expandedTotal} eventi (ordinati per coverage crescente)
                            </div>
                          )}
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 1fr 0.6fr 0.6fr 0.7fr 0.8fr",
                            padding: "6px 8px",
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            color: "var(--admin-text-muted, #94a3b8)",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                          }}>
                            <div>Evento</div>
                            <div>Torneo</div>
                            <div style={{ textAlign: "center" }}>Mercati</div>
                            <div style={{ textAlign: "center" }}>Avg</div>
                            <div style={{ textAlign: "center" }}>Coverage</div>
                            <div style={{ textAlign: "center" }}>Data</div>
                          </div>
                          {expandedEvents.map((ev) => (
                            <div
                              key={ev.id}
                              onClick={() => handleEventDetail(ev.id)}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "2fr 1fr 0.6fr 0.6fr 0.7fr 0.8fr",
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
                              <div style={{ color: "var(--admin-text-muted)", fontSize: 11 }}>
                                {ev.league_name || "—"}
                              </div>
                              <div style={{ textAlign: "center", fontWeight: 600, fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)" }}>
                                {ev.market_count}
                              </div>
                              <div style={{ textAlign: "center", fontFamily: "monospace", color: "var(--admin-text-muted)" }}>
                                {ev.sport_avg}
                              </div>
                              <div style={{ textAlign: "center" }}>
                                <span style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: 3,
                                  background: coverageBg(ev.coverage_pct),
                                  color: coverageColor(ev.coverage_pct),
                                }}>
                                  {ev.coverage_pct != null ? `${ev.coverage_pct}%` : "—"}
                                </span>
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

            {filteredSummary.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
                Nessun dato disponibile
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Low Coverage Events */}
      <CollapsibleSection
        title={`Eventi a Bassa Copertura (${filteredLowCov.length})`}
        open={lowCovOpen}
        onToggle={() => setLowCovOpen(!lowCovOpen)}
        badge={filteredLowCov.length > 0 ? filteredLowCov.length : undefined}
        badgeColor={filteredLowCov.length > 0 ? "#f59e0b" : undefined}
      >
        {filteredLowCov.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
            Nessun evento con copertura &lt;30%
          </div>
        ) : (
          <div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 0.7fr 0.6fr 0.6fr 0.7fr 0.8fr",
              padding: "10px 16px",
              background: "rgba(255,255,255,0.03)",
              borderBottom: "1px solid var(--admin-border, #1e3a5f)",
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--admin-text-muted, #94a3b8)",
              letterSpacing: 0.5,
            }}>
              <div>Evento</div>
              <div>Sport</div>
              <div style={{ textAlign: "center" }}>Source</div>
              <div style={{ textAlign: "center" }}>Mercati</div>
              <div style={{ textAlign: "center" }}>Avg</div>
              <div style={{ textAlign: "center" }}>Coverage</div>
              <div style={{ textAlign: "center" }}>Data</div>
            </div>

            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {filteredLowCov.map((ev, i) => (
                <div
                  key={ev.event_id}
                  onClick={() => handleEventDetail(ev.event_id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 0.7fr 0.6fr 0.6fr 0.7fr 0.8fr",
                    padding: "7px 16px",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    fontSize: 12,
                    cursor: "pointer",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)")}
                >
                  <div style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 500 }}>
                    {ev.home_team} vs {ev.away_team}
                  </div>
                  <div style={{ color: "var(--admin-text-muted)", fontSize: 11 }}>
                    {ev.sport_name}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: ev.source === "goldbet" ? "#f59e0b20" : "#8b5cf620",
                      color: ev.source === "goldbet" ? "#f59e0b" : "#8b5cf6",
                      textTransform: "uppercase",
                    }}>
                      {ev.source === "goldbet" ? "GB" : "K"}
                    </span>
                  </div>
                  <div style={{ textAlign: "center", fontWeight: 600, fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)" }}>
                    {ev.market_count}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", color: "var(--admin-text-muted)" }}>
                    {ev.sport_avg}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 3,
                      background: coverageBg(ev.coverage_pct),
                      color: coverageColor(ev.coverage_pct),
                    }}>
                      {ev.coverage_pct}%
                    </span>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 11, color: "var(--admin-text-muted)" }}>
                    {formatTime(ev.starts_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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

// ═══ SUB-COMPONENTS ═══

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)" }}>
        {label}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--admin-bg, #0a1929)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 4,
          color: "var(--admin-text, #e2e8f0)",
          padding: "6px 10px",
          fontSize: 13,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function KPICard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: "var(--admin-card, #0f1f35)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 8,
      padding: "16px 20px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--admin-text-muted, #94a3b8)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}

function CollapsibleSection({ title, open, onToggle, children, badge, badgeColor }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: number;
  badgeColor?: string;
}) {
  return (
    <div style={{
      background: "var(--admin-card, #0f1f35)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 8,
      overflow: "hidden",
    }}>
      <div
        onClick={onToggle}
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          background: "rgba(255,255,255,0.02)",
          borderBottom: open ? "1px solid var(--admin-border, #1e3a5f)" : "none",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--admin-text-muted)" }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--admin-text, #e2e8f0)" }}>
          {title}
        </span>
        {badge != null && badge > 0 && (
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 10,
            background: `${badgeColor || "#f59e0b"}20`,
            color: badgeColor || "#f59e0b",
          }}>
            {badge}
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
}

function EventDetailModal({ detail, loading, onClose }: {
  detail: EventDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--admin-card, #0f1f35)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12,
          padding: 24,
          minWidth: 500,
          maxWidth: 700,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Caricamento...</div>
        ) : detail ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
                  {detail.event.home_team} vs {detail.event.away_team}
                </h3>
                <div style={{ fontSize: 12, color: "var(--admin-text-muted)", marginTop: 4, display: "flex", gap: 12 }}>
                  <span>{detail.event.sport_name} · {detail.event.league_name}</span>
                  <span style={{ color: detail.event.status === "live" ? "#10b981" : "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>
                    {detail.event.status}
                  </span>
                  <span>{formatTime(detail.event.starts_at)}</span>
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--admin-text-muted)",
                  fontSize: 18,
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{
              padding: "12px 16px",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 8,
              marginBottom: 16,
              display: "flex",
              gap: 24,
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Mercati</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#60a5fa", fontFamily: "monospace" }}>{detail.market_count}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Tipi</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#8b5cf6", fontFamily: "monospace" }}>{detail.market_types.length}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Source</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: detail.event.source === "goldbet" ? "#f59e0b" : "#8b5cf6", textTransform: "uppercase", marginTop: 4 }}>
                  {detail.event.source}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--admin-text-muted)", marginBottom: 8, letterSpacing: 0.5 }}>
              Distribuzione per Tipo
            </div>

            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {detail.market_types.map((mt) => (
                <div
                  key={mt.type}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "var(--admin-text, #e2e8f0)" }}>
                    {mt.type}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: Math.max(4, (mt.count / (detail.market_types[0]?.count || 1)) * 120),
                      height: 8,
                      borderRadius: 4,
                      background: "#2563eb",
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)", minWidth: 24, textAlign: "right" }}>
                      {mt.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun dettaglio</div>
        )}
      </div>
    </div>
  );
}
