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
  status: string;
  total_events: number;
  events_with_source: number;
  avg_source: number | null;
  avg_vincitu: number;
  gap_pct: number | null;
  gap_total: number;
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

  // ─── Filter summary rows ───
  const filteredRaw = (stats?.summary || []).filter((row) => {
    if (sportFilter !== "all" && row.sport_slug !== sportFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    return true;
  });

  // Aggregate by sport (merge live/prematch rows)
  const filteredSummary = (() => {
    const map = new Map<string, SummaryRow & { _sourceWeightedSum: number; _sourceCount: number }>();
    for (const row of filteredRaw) {
      const key = row.sport_slug;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...row,
          _sourceWeightedSum: (row.avg_source || 0) * row.events_with_source,
          _sourceCount: row.events_with_source,
        });
      } else {
        const prevTotal = existing.total_events;
        const newTotal = prevTotal + row.total_events;

        // Weighted avg_vincitu
        existing.avg_vincitu = Math.round(
          ((existing.avg_vincitu * prevTotal) + (row.avg_vincitu * row.total_events)) / newTotal * 10
        ) / 10;

        // Weighted avg_source
        existing._sourceWeightedSum += (row.avg_source || 0) * row.events_with_source;
        existing._sourceCount += row.events_with_source;
        existing.avg_source = existing._sourceCount > 0
          ? Math.round(existing._sourceWeightedSum / existing._sourceCount * 10) / 10
          : null;

        existing.total_events = newTotal;
        existing.events_with_source += row.events_with_source;
        existing.gap_total += row.gap_total;
        existing.zero_markets += row.zero_markets;

        // Recompute gap_pct
        existing.gap_pct = existing.avg_source != null && existing.avg_source > 0
          ? Math.round((1 - existing.avg_vincitu / existing.avg_source) * 1000) / 10
          : null;
      }
    }
    return Array.from(map.values())
      .map(({ _sourceWeightedSum, _sourceCount, ...rest }) => rest)
      .sort((a, b) => b.total_events - a.total_events);
  })();

  const filteredGapEvents = (stats?.gap_events || []).filter((row) => {
    if (sportFilter !== "all" && row.sport_slug !== sportFilter) return false;
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
  const totalEvents = stats?.total_events || 0;
  const eventsWithSource = stats?.events_with_source || 0;
  const sourceDataPct = totalEvents > 0 ? Math.round((eventsWithSource / totalEvents) * 100) : 0;
  const totalGap = filteredSummary.reduce((s, r) => s + r.gap_total, 0);
  const zeroMarketEvents = filteredSummary.reduce((s, r) => s + r.zero_markets, 0);

  // Weighted gap %
  const totalVincitu = filteredSummary.reduce((s, r) => s + r.avg_vincitu * r.total_events, 0);
  const totalSource = filteredSummary.reduce((s, r) => s + (r.avg_source || 0) * r.events_with_source, 0);
  const avgGapPct = totalSource > 0
    ? Math.round((1 - totalVincitu / (filteredSummary.reduce((s, r) => s + r.total_events, 0) || 1) / (totalSource / (filteredSummary.reduce((s, r) => s + r.events_with_source, 0) || 1))) * 1000) / 10
    : null;

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
    const headers = ["Sport", "Eventi", "Con Source", "Avg Source", "Avg Vincitu", "Gap %", "Mancanti", "Zero"];
    const rows = filteredSummary.map(r => [
      r.sport_name,
      r.total_events,
      r.events_with_source,
      r.avg_source,
      r.avg_vincitu,
      r.gap_pct,
      r.gap_total,
      r.zero_markets,
    ]);
    exportCsv("market-coverage-gap.csv", headers, rows);
  };

  const handleExportGap = () => {
    const headers = ["Evento", "Sport", "Lega", "Source", "Vincitu", "Gap", "Coverage %", "Data"];
    const rows = filteredGapEvents.map(ev => [
      `${ev.home_team} vs ${ev.away_team}`, ev.sport_name, ev.league_name,
      ev.source_count, ev.vincitu_count, ev.gap, ev.coverage_pct,
      new Date(ev.starts_at).toLocaleString("it-IT"),
    ]);
    exportCsv("market-coverage-gap-events.csv", headers, rows);
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
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text, #e2e8f0)" }}>
            Gap Mercati — Source vs Vincitu
          </h2>
          <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", marginTop: 4 }}>
            Source data disponibile per {eventsWithSource}/{totalEvents} eventi ({sourceDataPct}%)
          </div>
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
        <FilterSelect
          label="Sport"
          value={sportFilter}
          onChange={setSportFilter}
          options={[{ value: "all", label: "Tutti" }, ...sportOptions]}
        />
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
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KPICard
          label="Eventi con Gap"
          value={formatNum(filteredGapEvents.length)}
          color={filteredGapEvents.length > 0 ? "#f59e0b" : "#10b981"}
          subtitle={`su ${eventsWithSource} con source data`}
        />
        <KPICard
          label="Gap Medio"
          value={avgGapPct != null ? `${avgGapPct}%` : "N/D"}
          color={avgGapPct != null ? gapColor(avgGapPct) : "var(--admin-text-muted)"}
        />
        <KPICard
          label="Zero Mercati"
          value={formatNum(zeroMarketEvents)}
          color={zeroMarketEvents > 0 ? "#ef4444" : "#10b981"}
        />
        <KPICard
          label="Mercati Mancanti"
          value={formatNum(totalGap)}
          color={totalGap > 0 ? "#ef4444" : "#10b981"}
          subtitle="source − vincitu"
        />
      </div>

      {/* Sport Coverage Table */}
      <CollapsibleSection
        title={`Copertura per Sport (${filteredSummary.length})`}
        open={sportTableOpen}
        onToggle={() => setSportTableOpen(!sportTableOpen)}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 0.5fr 0.5fr 0.6fr 0.6fr 0.6fr 0.6fr 0.5fr",
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
            <div style={{ textAlign: "center" }}>Source</div>
            <div style={{ textAlign: "center" }}>Avg Source</div>
            <div style={{ textAlign: "center" }}>Avg Vincitu</div>
            <div style={{ textAlign: "center" }}>Gap %</div>
            <div style={{ textAlign: "center" }}>Mancanti</div>
            <div style={{ textAlign: "center" }}>Zero</div>
          </div>

          {/* Table rows */}
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            {filteredSummary.map((row, i) => (
              <div
                key={row.sport_slug}
                onClick={() => router.push(`/admin/market-coverage/${row.sport_slug}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 0.5fr 0.5fr 0.6fr 0.6fr 0.6fr 0.6fr 0.5fr",
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
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--admin-text-muted)" }}>
                  {row.events_with_source}/{row.total_events}
                </div>
                <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b", fontSize: 12 }}>
                  {row.avg_source != null ? row.avg_source : "—"}
                </div>
                <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa", fontSize: 12 }}>
                  {row.avg_vincitu}
                </div>
                <div style={{ textAlign: "center" }}>
                  {row.gap_pct != null ? (
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: gapBg(row.gap_pct),
                      color: gapColor(row.gap_pct),
                    }}>
                      {row.gap_pct}%
                    </span>
                  ) : (
                    <span style={{ color: "var(--admin-text-muted)", fontSize: 12 }}>—</span>
                  )}
                </div>
                <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: row.gap_total > 0 ? "#ef4444" : "var(--admin-text-muted)", fontSize: 12 }}>
                  {formatNum(row.gap_total)}
                </div>
                <div style={{ textAlign: "center", color: row.zero_markets > 0 ? "#ef4444" : "var(--admin-text-muted)", fontWeight: 600 }}>
                  {row.zero_markets}
                </div>
              </div>
            ))}

            {filteredSummary.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
                Nessun dato disponibile
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Gap Events */}
      <CollapsibleSection
        title={`Eventi con Gap (${filteredGapEvents.length})`}
        open={gapEventsOpen}
        onToggle={() => setGapEventsOpen(!gapEventsOpen)}
        badge={filteredGapEvents.length > 0 ? filteredGapEvents.length : undefined}
        badgeColor={filteredGapEvents.length > 0 ? "#f59e0b" : undefined}
      >
        {filteredGapEvents.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 13 }}>
            Nessun evento con gap source → vincitu
          </div>
        ) : (
          <div>
            <div style={{ padding: "4px 16px", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={handleExportGap}
                style={{
                  padding: "4px 10px", borderRadius: 4,
                  border: "1px solid var(--admin-border, #1e3a5f)",
                  background: "transparent", color: "var(--admin-text-muted, #94a3b8)",
                  cursor: "pointer", fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                }}
              >
                Esporta
              </button>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.8fr 0.8fr 0.5fr 0.5fr 0.5fr 0.6fr 0.6fr",
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
                    gridTemplateColumns: "1.8fr 0.8fr 0.5fr 0.5fr 0.5fr 0.6fr 0.6fr",
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
                  <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#f59e0b" }}>
                    {ev.source_count}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600, color: "#60a5fa" }}>
                    {ev.vincitu_count}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 700, color: "#ef4444" }}>
                    −{ev.gap}
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
