"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  fetchApi, formatNum, formatTime,
  gapColor, gapBg, coverageColor, coverageBg,
  KPICard, CollapsibleSection, FilterSelect, EventDetailModal,
  exportCsv, ExportButton,
} from "./shared";
import type { EventDetail } from "./shared";

// ═══ TYPES ═══

interface SummaryRow {
  sport_name: string;
  sport_slug: string;
  source: string;
  status: string;
  total_events: number;
  events_with_source: number;
  avg_source: number | null;
  avg_vincitu: number;
  gap_pct: number | null;
  gap_total: number | null;
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
  source: string;
  status: string;
  source_count: number;
  vincitu_count: number;
  gap: number;
  coverage_pct: number;
  starts_at: string;
}

interface StatsData {
  summary: SummaryRow[];
  gap_events: GapEvent[];
  total_events: number;
  events_with_source: number;
  generated_at: string;
}

// ═══ MAIN COMPONENT ═══

export default function MarketCoverageDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Filters
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Collapsible sections
  const [sportTableOpen, setSportTableOpen] = useState(true);
  const [gapEventsOpen, setGapEventsOpen] = useState(false);

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

  // ─── Filter & aggregate summary rows by sport ───
  const filteredRaw = (stats?.summary || []).filter((row) => {
    if (sportFilter !== "all" && row.sport_slug !== sportFilter) return false;
    if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    return true;
  });

  const filteredSummary = (() => {
    const map = new Map<string, SummaryRow>();
    for (const row of filteredRaw) {
      const key = row.sport_slug;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...row });
      } else {
        // Weighted merge
        const prevSrcWeight = existing.events_with_source;
        const newSrcWeight = row.events_with_source;
        const totalSrcWeight = prevSrcWeight + newSrcWeight;

        existing.total_events += row.total_events;
        existing.events_with_source += row.events_with_source;
        existing.zero_markets += row.zero_markets;
        existing.gap_total = (existing.gap_total ?? 0) + (row.gap_total ?? 0);

        // Weighted avg_source
        if (totalSrcWeight > 0) {
          existing.avg_source = Math.round(
            (((existing.avg_source ?? 0) * prevSrcWeight) + ((row.avg_source ?? 0) * newSrcWeight)) / totalSrcWeight * 10
          ) / 10;
        }

        // Weighted avg_vincitu
        const prevTotal = existing.total_events - row.total_events;
        existing.avg_vincitu = Math.round(
          ((existing.avg_vincitu * prevTotal) + (row.avg_vincitu * row.total_events)) / existing.total_events * 10
        ) / 10;

        // Weighted gap_pct
        if (totalSrcWeight > 0) {
          existing.gap_pct = Math.round(
            (((existing.gap_pct ?? 0) * prevSrcWeight) + ((row.gap_pct ?? 0) * newSrcWeight)) / totalSrcWeight * 10
          ) / 10;
        }
      }
    }
    return Array.from(map.values());
  })();

  const filteredGapEvents = (stats?.gap_events || []).filter((row) => {
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
  const avgGapPct = (() => {
    const rows = filteredSummary.filter(r => r.gap_pct != null && r.events_with_source > 0);
    if (rows.length === 0) return null;
    const totalWeighted = rows.reduce((s, r) => s + (r.gap_pct! * r.events_with_source), 0);
    const totalEvents = rows.reduce((s, r) => s + r.events_with_source, 0);
    return totalEvents > 0 ? Math.round(totalWeighted / totalEvents * 10) / 10 : null;
  })();
  const zeroMarketEvents = filteredSummary.reduce((s, r) => s + r.zero_markets, 0);
  const worstGapEvent = filteredGapEvents.length > 0 ? filteredGapEvents[0] : null;

  // Data availability
  const sourcePct = stats && stats.total_events > 0
    ? Math.round((stats.events_with_source / stats.total_events) * 1000) / 10
    : 0;

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
    const headers = ["Sport", "Eventi", "Avg Source", "Avg Vincitu", "Gap %", "Mancanti", "Zero"];
    const rows = filteredSummary.map(r => [
      r.sport_name,
      r.total_events,
      r.avg_source ?? "N/D",
      r.avg_vincitu,
      r.gap_pct != null ? `${r.gap_pct}%` : "N/D",
      r.gap_total ?? "N/D",
      r.zero_markets,
    ]);
    exportCsv("market-coverage-sport.csv", headers, rows);
  };

  const handleExportGapEvents = () => {
    const headers = ["Evento", "Sport", "Lega", "Source", "Goldbet", "Vincitu", "Gap", "Coverage %", "Data"];
    const rows = filteredGapEvents.map(ev => [
      `${ev.home_team} vs ${ev.away_team}`, ev.sport_name, ev.league_name, ev.source,
      ev.source_count, ev.vincitu_count, ev.gap, ev.coverage_pct,
      new Date(ev.starts_at).toLocaleString("it-IT"),
    ]);
    exportCsv("market-coverage-gap-eventi.csv", headers, rows);
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
          Gap Mercati — Source vs Vincitu
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>
          <span>
            Dati source: {stats?.events_with_source ?? 0}/{stats?.total_events ?? 0} eventi ({sourcePct}%)
          </span>
          <span>Auto-refresh 30s {lastRefresh && `· ${lastRefresh}`}</span>
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
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <ExportButton onClick={handleExportSummary} />
          {filteredGapEvents.length > 0 && (
            <button
              onClick={handleExportGapEvents}
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--admin-border, #1e3a5f)",
                background: "transparent",
                color: "var(--admin-text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#e2e8f0"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; }}
            >
              Esporta Gap
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KPICard
          label="Eventi con Gap"
          value={formatNum(filteredGapEvents.length)}
          color={filteredGapEvents.length > 0 ? "#f59e0b" : "#10b981"}
        />
        <KPICard
          label="Gap Medio %"
          value={avgGapPct != null ? `${avgGapPct}%` : "—"}
          color={gapColor(avgGapPct)}
        />
        <KPICard
          label="Zero Mercati"
          value={formatNum(zeroMarketEvents)}
          color={zeroMarketEvents > 0 ? "#ef4444" : "#10b981"}
        />
        <KPICard
          label="Peggior Gap"
          value={worstGapEvent ? `${worstGapEvent.gap}` : "—"}
          subtitle={worstGapEvent ? `${worstGapEvent.home_team} vs ${worstGapEvent.away_team}` : undefined}
          color={worstGapEvent ? "#ef4444" : "#10b981"}
        />
      </div>

      {/* Sport Coverage Table */}
      <CollapsibleSection
        title={`Gap per Sport (${filteredSummary.length})`}
        open={sportTableOpen}
        onToggle={() => setSportTableOpen(!sportTableOpen)}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 0.6fr 0.8fr 0.8fr 0.7fr 0.7fr 0.5fr",
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
            <div style={{ textAlign: "center" }}>Eventi</div>
            <div style={{ textAlign: "center" }}>Avg Source</div>
            <div style={{ textAlign: "center" }}>Avg Vincitu</div>
            <div style={{ textAlign: "center" }}>Gap %</div>
            <div style={{ textAlign: "center" }}>Mancanti</div>
            <div style={{ textAlign: "center" }}>Zero</div>
          </div>

          {/* Table rows */}
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            {filteredSummary.map((row, i) => {
              const rowKey = `${row.sport_slug}:${row.source}:${row.status}`;
              return (
                <div
                  key={rowKey}
                  onClick={() => router.push(`/admin/market-coverage/${row.sport_slug}`)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.5fr 0.6fr 0.8fr 0.8fr 0.7fr 0.7fr 0.5fr",
                    padding: "8px 16px",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                    borderBottom: "1px solid rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    fontSize: 13,
                    alignItems: "center",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)")}
                >
                  <div style={{ fontWeight: 600, color: "var(--admin-text, #e2e8f0)", display: "flex", alignItems: "center", gap: 6 }}>
                    {row.sport_name}
                    <span style={{ fontSize: 10, color: "var(--admin-text-muted)", opacity: 0.5 }}>→</span>
                  </div>
                  <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                    {formatNum(row.total_events)}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", color: row.avg_source != null ? "#f59e0b" : "var(--admin-text-muted)" }}>
                    {row.avg_source != null ? row.avg_source : "—"}
                  </div>
                  <div style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text, #e2e8f0)", fontFamily: "monospace" }}>
                    {row.avg_vincitu}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    {row.gap_pct != null ? (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 3,
                        background: gapBg(row.gap_pct),
                        color: gapColor(row.gap_pct),
                      }}>
                        {row.gap_pct}%
                      </span>
                    ) : (
                      <span style={{ color: "var(--admin-text-muted)" }}>—</span>
                    )}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", color: (row.gap_total ?? 0) > 0 ? "#ef4444" : "var(--admin-text-muted)", fontWeight: 600 }}>
                    {row.gap_total != null ? formatNum(row.gap_total) : "—"}
                  </div>
                  <div style={{ textAlign: "center", color: row.zero_markets > 0 ? "#ef4444" : "var(--admin-text-muted)", fontWeight: 600 }}>
                    {row.zero_markets}
                  </div>
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

      {/* Gap Events (replaces Low Coverage) */}
      <CollapsibleSection
        title={`Gap Maggiori (${filteredGapEvents.length})`}
        open={gapEventsOpen}
        onToggle={() => setGapEventsOpen(!gapEventsOpen)}
        badge={filteredGapEvents.length > 0 ? filteredGapEvents.length : undefined}
        badgeColor={filteredGapEvents.length > 0 ? "#ef4444" : undefined}
      >
        {filteredGapEvents.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
            Nessun evento con gap (source &gt; vincitu)
          </div>
        ) : (
          <div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "2fr 0.8fr 0.6fr 0.5fr 0.5fr 0.5fr 0.6fr 0.7fr",
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
              <div style={{ textAlign: "center" }}>Goldbet</div>
              <div style={{ textAlign: "center" }}>Vincitu</div>
              <div style={{ textAlign: "center" }}>Gap</div>
              <div style={{ textAlign: "center" }}>Coverage</div>
              <div style={{ textAlign: "center" }}>Data</div>
            </div>

            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {filteredGapEvents.map((ev, i) => (
                <div
                  key={ev.event_id}
                  onClick={() => handleEventDetail(ev.event_id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 0.8fr 0.6fr 0.5fr 0.5fr 0.5fr 0.6fr 0.7fr",
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
                  <div style={{ textAlign: "center", fontFamily: "monospace", color: "#f59e0b", fontWeight: 600 }}>
                    {ev.source_count}
                  </div>
                  <div style={{ textAlign: "center", fontWeight: 600, fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)" }}>
                    {ev.vincitu_count}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: "#ef4444" }}>
                    {ev.gap > 0 ? `−${ev.gap}` : ev.gap}
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
