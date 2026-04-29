"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  fetchApi, formatNum, formatNumFull, formatTime,
  coverageColor, coverageBg,
  KPICard, CollapsibleSection, EventDetailModal,
  exportCsv, ExportButton, DonutRing,
} from "./shared";
import type { EventDetail } from "./shared";

// ═══ TYPES ═══

interface SportRow {
  sport_name: string;
  sport_slug: string;
  events: number;
  avg_source: number;
  avg_db: number;
  coverage_pct: number;
  gap_events: number;
  zero_markets: number;
}

interface GapEvent {
  event_id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  sport_name: string;
  sport_slug: string;
  league_name: string;
  status: string;
  source_count: number;
  betssolution_count: number;
  gap: number;
  coverage_pct: number;
  starts_at: string;
}

interface StatsKPIs {
  total_events: number;
  total_source_markets: number;
  total_db_markets: number;
  coverage_pct: number;
  zero_market_events: number;
}

interface StatsData {
  kpis: StatsKPIs;
  summary: SportRow[];
  gap_events: GapEvent[];
  generated_at: string;
}

interface LiveSportRow {
  name: string;
  slug: string;
  events: number;
  expected: number;
  actual: number;
  coverage_pct: number;
}

interface LiveCoverageData {
  sports: LiveSportRow[];
  totals: {
    events: number;
    expected: number;
    actual: number;
    coverage_pct: number;
  };
}

// ═══ MAIN COMPONENT ═══

export default function CoverageDashboard({ source = "odds-api" }: { source?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [liveData, setLiveData] = useState<LiveCoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Collapsible sections
  const [gapEventsOpen, setGapEventsOpen] = useState(false);

  // Event detail modal
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Auto-refresh
  const refreshRef = useRef<NodeJS.Timeout | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const sourceLabel = source === "flashscore" ? "Flashscore" : "Odds API";

  // ─── Load stats ───
  const loadStats = useCallback(async () => {
    try {
      const [data, live] = await Promise.all([
        fetchApi("stats", {}, source),
        fetchApi("live-summary", {}, source),
      ]);
      setStats(data);
      setLiveData(live);
      setLastRefresh(new Date().toLocaleTimeString("it-IT"));
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(loadStats, 30000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [loadStats]);

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

  const handleExportSummary = () => {
    const headers = ["Sport", "Eventi", `Avg ${sourceLabel}`, "Avg DB", "Coverage %", "Con Gap", "Zero"];
    const rows = (stats?.summary || []).map(r => [
      r.sport_name,
      r.events,
      r.avg_source,
      r.avg_db,
      r.coverage_pct,
      r.gap_events,
      r.zero_markets,
    ]);
    exportCsv(`${source}-coverage.csv`, headers, rows);
  };

  const handleExportGap = () => {
    const headers = ["Evento", "Sport", "Lega", sourceLabel, "DB", "Gap", "Coverage %", "Data"];
    const rows = (stats?.gap_events || []).map(ev => [
      `${ev.home_team} vs ${ev.away_team}`, ev.sport_name, ev.league_name,
      ev.source_count, ev.betssolution_count, ev.gap, ev.coverage_pct,
      new Date(ev.starts_at).toLocaleString("it-IT"),
    ]);
    exportCsv(`${source}-coverage-gap-events.csv`, headers, rows);
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--admin-text-muted, #94a3b8)", fontSize: 16 }}>
        Caricamento Coverage...
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

  const kpis = stats?.kpis;
  const summary = stats?.summary || [];
  const gapEvents = stats?.gap_events || [];

  // Totals for footer row
  const totalEvents = summary.reduce((s, r) => s + r.events, 0);
  const totalGapEvents = summary.reduce((s, r) => s + r.gap_events, 0);
  const totalZero = summary.reduce((s, r) => s + r.zero_markets, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* A. Header + Source Tabs */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
              {sourceLabel} Market Coverage
            </h2>
            <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 4 }}>
              Confronto mercati {sourceLabel} attesi vs DB Vincitu
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
            {lastRefresh && `Aggiornato: ${lastRefresh}`}
          </span>
          <button
            onClick={() => { setLoading(true); loadStats(); }}
            style={{
              padding: "8px 16px", borderRadius: 8,
              border: "1px solid var(--admin-border, #1e3a5f)",
              background: "transparent", color: "var(--admin-text, #e2e8f0)",
              cursor: "pointer", fontSize: 13, fontWeight: 600,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Aggiorna
          </button>
        </div>
      </div>

      {/* B. KPI Hero */}
      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <KPICard
            label="Eventi Totali"
            value={formatNumFull(kpis.total_events)}
            color="var(--admin-text, #e2e8f0)"
            subtitle="prematch + live"
          />
          <KPICard
            label="Coverage"
            value={`${kpis.coverage_pct}%`}
            color={coverageColor(kpis.coverage_pct)}
          >
            <DonutRing pct={kpis.coverage_pct} size={52} />
          </KPICard>
          <KPICard
            label="Mercati in DB"
            value={formatNum(kpis.total_db_markets)}
            color="#60a5fa"
            subtitle={`/ ${formatNum(kpis.total_source_markets)} attesi`}
          />
          <KPICard
            label="Zero Mercati"
            value={formatNumFull(kpis.zero_market_events)}
            color={kpis.zero_market_events > 0 ? "#ef4444" : "#10b981"}
            subtitle="eventi senza mercati"
          />
        </div>
      )}

      {/* C. Sport Coverage Table */}
      <div style={{
        background: "var(--admin-card, #0f1f35)", border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(255,255,255,0.02)",
          borderBottom: "1px solid var(--admin-border, #1e3a5f)",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--admin-text, #e2e8f0)" }}>
            Copertura per Sport
          </span>
          <ExportButton onClick={handleExportSummary} />
        </div>

        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.8fr 1fr 0.5fr 0.5fr",
          padding: "10px 20px",
          background: "rgba(255,255,255,0.03)",
          borderBottom: "1px solid var(--admin-border, #1e3a5f)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          color: "var(--admin-text-muted, #94a3b8)",
          letterSpacing: 0.5,
        }}>
          <div>Sport</div>
          <div style={{ textAlign: "center" }}>Eventi</div>
          <div style={{ textAlign: "center" }}>{sourceLabel} Attesi</div>
          <div style={{ textAlign: "center" }}>DB Attuali</div>
          <div style={{ textAlign: "center" }}>Coverage</div>
          <div style={{ textAlign: "center" }}>Zero</div>
          <div style={{ textAlign: "center" }}>Con Gap</div>
        </div>

        {/* Table rows */}
        {summary.map((row, i) => {
          const covColor = coverageColor(row.coverage_pct);
          return (
            <div
              key={row.sport_slug}
              onClick={() => router.push(`/admin/market-coverage/${row.sport_slug}?source=${source}`)}
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.8fr 1fr 0.5fr 0.5fr",
                padding: "12px 20px",
                background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                cursor: "pointer",
                fontSize: 14,
                alignItems: "center",
                transition: "background 0.15s",
                height: 48,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)")}
            >
              <div style={{ fontWeight: 600, color: "var(--admin-text, #e2e8f0)", display: "flex", alignItems: "center", gap: 8 }}>
                {row.sport_name}
                <span style={{ fontSize: 10, color: "var(--admin-text-muted)", opacity: 0.5 }}>&rarr;</span>
              </div>
              <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                {formatNumFull(row.events)}
              </div>
              <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b", fontSize: 13 }}>
                {row.avg_source != null ? row.avg_source : "\u2014"}
              </div>
              <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa", fontSize: 13 }}>
                {row.avg_db}
              </div>
              <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <div style={{
                  width: 80, height: 6, borderRadius: 3,
                  background: "rgba(255,255,255,0.06)", overflow: "hidden",
                }}>
                  <div style={{
                    width: `${Math.min(100, row.coverage_pct)}%`,
                    height: "100%", borderRadius: 3,
                    background: covColor,
                    transition: "width 0.3s",
                  }} />
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 600, fontFamily: "monospace",
                  padding: "2px 8px", borderRadius: 4,
                  background: coverageBg(row.coverage_pct),
                  color: covColor,
                }}>
                  {row.coverage_pct}%
                </span>
              </div>
              <div style={{ textAlign: "center", color: row.zero_markets > 0 ? "#ef4444" : "var(--admin-text-muted)", fontWeight: 600 }}>
                {row.zero_markets}
              </div>
              <div style={{ textAlign: "center", color: row.gap_events > 0 ? "#f59e0b" : "var(--admin-text-muted)", fontWeight: 600 }}>
                {row.gap_events}
              </div>
            </div>
          );
        })}

        {/* Totals row */}
        {summary.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.8fr 1fr 0.5fr 0.5fr",
            padding: "12px 20px",
            background: "rgba(59, 130, 246, 0.06)",
            fontWeight: 700,
            fontSize: 14,
            alignItems: "center",
            height: 48,
          }}>
            <div style={{ color: "var(--admin-text, #e2e8f0)" }}>TOTALE</div>
            <div style={{ textAlign: "center", color: "var(--admin-text, #e2e8f0)" }}>{formatNumFull(totalEvents)}</div>
            <div style={{ textAlign: "center", color: "#f59e0b", fontFamily: "monospace" }}>{kpis ? formatNum(kpis.total_source_markets) : "\u2014"}</div>
            <div style={{ textAlign: "center", color: "#60a5fa", fontFamily: "monospace" }}>{kpis ? formatNum(kpis.total_db_markets) : "\u2014"}</div>
            <div style={{ textAlign: "center" }}>
              {kpis && (
                <span style={{
                  fontSize: 13, fontWeight: 700, fontFamily: "monospace",
                  padding: "3px 10px", borderRadius: 4,
                  background: coverageBg(kpis.coverage_pct),
                  color: coverageColor(kpis.coverage_pct),
                }}>
                  {kpis.coverage_pct}%
                </span>
              )}
            </div>
            <div style={{ textAlign: "center", color: totalZero > 0 ? "#ef4444" : "var(--admin-text-muted)" }}>{totalZero}</div>
            <div style={{ textAlign: "center", color: totalGapEvents > 0 ? "#f59e0b" : "var(--admin-text-muted)" }}>{totalGapEvents}</div>
          </div>
        )}

        {summary.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
            Nessun dato disponibile
          </div>
        )}
      </div>

      {/* D. Live Coverage */}
      {liveData && liveData.sports.length > 0 && (
        <div style={{
          background: "var(--admin-card, #0f1f35)", border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "rgba(255,255,255,0.02)",
            borderBottom: "1px solid var(--admin-border, #1e3a5f)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
              <span style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--admin-text, #e2e8f0)" }}>
                Coverage Live
              </span>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 10,
                background: coverageBg(liveData.totals.coverage_pct),
                color: coverageColor(liveData.totals.coverage_pct),
              }}>
                {liveData.totals.coverage_pct}%
              </span>
            </div>
            <span style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
              {liveData.totals.events} eventi &middot; {formatNum(liveData.totals.actual)}/{formatNum(liveData.totals.expected)} mercati
            </span>
          </div>

          {/* Live table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.8fr 1fr",
            padding: "10px 20px",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid var(--admin-border, #1e3a5f)",
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            color: "var(--admin-text-muted, #94a3b8)", letterSpacing: 0.5,
          }}>
            <div>Sport</div>
            <div style={{ textAlign: "center" }}>Eventi</div>
            <div style={{ textAlign: "center" }}>Attesi</div>
            <div style={{ textAlign: "center" }}>In DB</div>
            <div style={{ textAlign: "center" }}>Coverage</div>
          </div>

          {/* Live table rows */}
          {liveData.sports.map((s, i) => {
            const covColor = coverageColor(s.coverage_pct);
            return (
              <div
                key={s.slug}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.8fr 1fr",
                  padding: "10px 20px",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  fontSize: 14, alignItems: "center", height: 44,
                }}
              >
                <div style={{ fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{s.name}</div>
                <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{s.events}</div>
                <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b", fontSize: 13 }}>{formatNumFull(s.expected)}</div>
                <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa", fontSize: 13 }}>{formatNumFull(s.actual)}</div>
                <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <div style={{ width: 80, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, s.coverage_pct)}%`, height: "100%", borderRadius: 3, background: covColor, transition: "width 0.3s" }} />
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 600, fontFamily: "monospace",
                    padding: "2px 8px", borderRadius: 4,
                    background: coverageBg(s.coverage_pct), color: covColor,
                  }}>
                    {s.coverage_pct}%
                  </span>
                </div>
              </div>
            );
          })}

          {/* Live totals row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 0.6fr 0.8fr 0.8fr 1fr",
            padding: "10px 20px",
            background: "rgba(16, 185, 129, 0.06)",
            fontWeight: 700, fontSize: 14, alignItems: "center", height: 44,
          }}>
            <div style={{ color: "var(--admin-text, #e2e8f0)" }}>TOTALE</div>
            <div style={{ textAlign: "center", color: "var(--admin-text, #e2e8f0)" }}>{liveData.totals.events}</div>
            <div style={{ textAlign: "center", fontFamily: "monospace", color: "#f59e0b" }}>{formatNum(liveData.totals.expected)}</div>
            <div style={{ textAlign: "center", fontFamily: "monospace", color: "#60a5fa" }}>{formatNum(liveData.totals.actual)}</div>
            <div style={{ textAlign: "center" }}>
              <span style={{
                fontSize: 13, fontWeight: 700, fontFamily: "monospace",
                padding: "3px 10px", borderRadius: 4,
                background: coverageBg(liveData.totals.coverage_pct),
                color: coverageColor(liveData.totals.coverage_pct),
              }}>
                {liveData.totals.coverage_pct}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* E. Gap Events (collapsible) */}
      <CollapsibleSection
        title={`Eventi con Gap (${gapEvents.length})`}
        open={gapEventsOpen}
        onToggle={() => setGapEventsOpen(!gapEventsOpen)}
        badge={gapEvents.length > 0 ? gapEvents.length : undefined}
        badgeColor={gapEvents.length > 0 ? "#f59e0b" : undefined}
      >
        {gapEvents.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
            Nessun evento con gap {sourceLabel} &rarr; DB
          </div>
        ) : (
          <div>
            <div style={{ padding: "8px 20px", display: "flex", justifyContent: "flex-end" }}>
              <ExportButton onClick={handleExportGap} />
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.8fr 0.7fr 0.8fr 0.5fr 0.5fr 0.5fr 0.6fr 0.6fr",
              padding: "10px 20px",
              background: "rgba(255,255,255,0.03)",
              borderBottom: "1px solid var(--admin-border, #1e3a5f)",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--admin-text-muted, #94a3b8)",
              letterSpacing: 0.5,
            }}>
              <div>Evento</div>
              <div>Sport</div>
              <div>Lega</div>
              <div style={{ textAlign: "center" }}>{sourceLabel}</div>
              <div style={{ textAlign: "center" }}>DB</div>
              <div style={{ textAlign: "center" }}>Gap</div>
              <div style={{ textAlign: "center" }}>Coverage</div>
              <div style={{ textAlign: "center" }}>Kickoff</div>
            </div>

            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {gapEvents.map((ev, i) => (
                <div
                  key={ev.event_id}
                  onClick={() => handleEventDetail(ev.event_id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.8fr 0.7fr 0.8fr 0.5fr 0.5fr 0.5fr 0.6fr 0.6fr",
                    padding: "8px 20px",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    fontSize: 13,
                    cursor: "pointer",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)")}
                >
                  <div style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 500 }}>
                    {ev.home_team} vs {ev.away_team}
                  </div>
                  <div style={{ color: "var(--admin-text-muted)", fontSize: 12 }}>
                    {ev.sport_name}
                  </div>
                  <div style={{ color: "var(--admin-text-muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.league_name}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b" }}>
                    {ev.source_count}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa" }}>
                    {ev.betssolution_count}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: "#ef4444" }}>
                    &minus;{ev.gap}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: coverageBg(ev.coverage_pct),
                      color: coverageColor(ev.coverage_pct),
                    }}>
                      {ev.coverage_pct}%
                    </span>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--admin-text-muted)" }}>
                    {formatTime(ev.starts_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* Auto-refresh indicator */}
      <div style={{ textAlign: "right", fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
        Auto-refresh ogni 30s
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
