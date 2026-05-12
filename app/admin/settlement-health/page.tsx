"use client";

import { useEffect, useState, useCallback } from "react";
import { Kpi, KpiRow } from "@/components/admin/ui";

// ═══ TYPES ═══

interface Subsystem {
  score: number;
  weight: number;
  label: string;
  details: string;
}

interface StuckEvent {
  id: string;
  match: string;
  sport: string;
  starts_at: string;
  fs_ended_since: string;
  stuck_minutes: number;
}

interface PhantomLiveEvent {
  id: string;
  sport_slug: string | null;
  league_name: string | null;
  match: string;
  starts_at: string;
  minutes_since_kickoff: number;
  last_updated_at: string;
}

interface SettlementEntry {
  id: string;
  match: string;
  sport: string;
  score: string | null;
  settled_at: string;
}

interface CoverageRow {
  sport_slug: string;
  events_total: number;
  events_fs_trackable: number;
  fs_trackable_pct: number;
  prematch_markets: number;
  live_markets: number;
  score_markets: number;
  stats_markets: number;
  player_markets: number;
}

interface FlashscoreActor {
  status: "healthy" | "warning" | "critical";
  last_push: string | null;
  age_minutes: number | null;
  cron_age_minutes: number | null;
}

interface HealthData {
  overall: "ok" | "warning" | "critical";
  health_score: number;
  subsystems: Record<string, Subsystem>;
  metrics: {
    events_pending_settlement: number;
    events_settled_last_hour: number;
    events_settled_today: number;
    fs_scraper_cron_age_seconds: number | null;
    fs_data_freshness_seconds: number | null;
    settlement_cron_last_run: string | null;
    settlement_cron_age_minutes: number | null;
    live_events_count: number;
    live_events_tracked: number;
    live_events_phantom: number;
    live_fs_coverage_pct: number;
    fs_fixtures_cron_ts: string | null;
  };
  coverage_by_sport: CoverageRow[];
  coverage_total: CoverageRow & { sport_slug?: string };
  stuck_events: StuckEvent[];
  phantom_live_events: PhantomLiveEvent[];
  recent_settlements: SettlementEntry[];
  actors: { flashscore: FlashscoreActor };
  backlog: number;
  rates: { last_1h: number; last_6h: number; last_24h: number };
  generated_at: string;
}

// ═══ HELPERS ═══

const STATUS_COLOR: Record<string, string> = {
  healthy: "#10b981",
  ok: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
};

const STATUS_BG: Record<string, string> = {
  healthy: "#10b98115",
  ok: "#10b98115",
  warning: "#f59e0b15",
  critical: "#ef444415",
};

const STATUS_LABEL: Record<string, string> = {
  healthy: "OPERATIVO",
  ok: "OPERATIVO",
  warning: "ATTENZIONE",
  critical: "CRITICO",
};

function scoreColor(score: number): string {
  return score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
}

function pctColor(pct: number): string {
  return pct >= 85 ? "#10b981" : pct >= 60 ? "#f59e0b" : "#ef4444";
}

function formatAgeMin(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "N/A";
  if (minutes < 1) return "< 1 min fa";
  if (minutes < 60) return `${minutes} min fa`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h fa`;
  return `${Math.round(minutes / 1440)}d fa`;
}

function formatAgeSec(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "N/A";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatAgeMin(Math.round(seconds / 60));
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
}

// ═══ MAIN PAGE ═══

export default function SettlementHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settlement-health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date().toLocaleTimeString("it-IT"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) {
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento Settlement Health...</div>;
  }
  if (error) {
    return <div style={{ padding: 60, textAlign: "center", color: "#ef4444" }}>Errore: {error}</div>;
  }
  if (!data) return null;

  const fs = data.actors.flashscore;
  const m = data.metrics;
  const big = scoreColor(data.health_score);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header with Score */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            border: `3px solid ${big}`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: `${big}10`,
          }}>
            <span style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: big }}>
              {data.health_score}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--admin-text-muted, #94a3b8)", marginTop: -2 }}>/ 100</span>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
              Settlement Health
            </h2>
            <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 2 }}>
              FS-only architecture · Flashscore → events_v2.status='settled'
            </div>
          </div>
          <span style={{
            padding: "6px 14px", borderRadius: 999, fontSize: 11, fontWeight: 800,
            background: STATUS_BG[data.overall], color: STATUS_COLOR[data.overall],
            border: `1px solid ${STATUS_COLOR[data.overall]}44`,
          }}>
            {STATUS_LABEL[data.overall]}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
            Auto-refresh 30s · {lastRefresh}
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

      {/* KPI Row */}
      <KpiRow minWidth={160}>
        <Kpi
          label="Backlog"
          value={data.backlog}
          accent={data.backlog > 50 ? "#ef4444" : data.backlog > 10 ? "#f59e0b" : "#10b981"}
          sub="events FS-ended pending"
        />
        <Kpi label="Settlati 1h" value={data.rates.last_1h} accent="#60a5fa" />
        <Kpi label="Settlati oggi" value={data.rates.last_24h} accent="#60a5fa" />
        <Kpi
          label="Live tracked"
          value={`${m.live_events_tracked}/${m.live_events_count}`}
          accent={pctColor(m.live_fs_coverage_pct)}
          sub={`${m.live_fs_coverage_pct}% FS-coverage`}
        />
        <Kpi
          label="FS cron"
          value={formatAgeSec(m.fs_scraper_cron_age_seconds)}
          accent={(m.fs_scraper_cron_age_seconds ?? 9999) < 120 ? "#10b981" : (m.fs_scraper_cron_age_seconds ?? 9999) < 300 ? "#f59e0b" : "#ef4444"}
          sub="last results push"
        />
      </KpiRow>

      {/* Subsystem Score Bars */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, padding: 16,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)", marginBottom: 12 }}>
          Subsystem Scores (weights sum = {Object.values(data.subsystems).reduce((s, sub) => s + sub.weight, 0)})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Object.entries(data.subsystems).map(([key, sub]) => {
            const barColor = scoreColor(sub.score);
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 170, fontSize: 13, fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                  {sub.label}
                </span>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    width: `${sub.score}%`, height: "100%", borderRadius: 4,
                    background: barColor,
                    transition: "width 0.5s ease",
                  }} />
                </div>
                <span style={{ width: 45, textAlign: "right", fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: barColor }}>
                  {sub.score}
                </span>
                <span style={{ width: 30, fontSize: 10, color: "var(--admin-text-muted, #94a3b8)" }}>
                  /{sub.weight}
                </span>
                <span style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", minWidth: 220 }}>
                  {sub.details}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Flashscore actor + scraper link */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: `1px solid ${STATUS_COLOR[fs.status]}40`,
          borderRadius: 12, padding: 20,
          borderLeft: `4px solid ${STATUS_COLOR[fs.status]}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 24 }}>📡</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Flashscore Scraper</div>
                <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>Push results & live updates to events_v2</div>
              </div>
            </div>
            <span style={{
              padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 800,
              background: STATUS_BG[fs.status], color: STATUS_COLOR[fs.status],
            }}>
              {STATUS_LABEL[fs.status]}
            </span>
          </div>
          <div style={{ display: "flex", gap: 24, fontSize: 13, flexWrap: "wrap" }}>
            <div>
              <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Ultimo push: </span>
              <span style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 600 }}>{formatTime(fs.last_push)}</span>
            </div>
            <div>
              <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Età: </span>
              <span style={{ color: (fs.age_minutes ?? 0) > 5 ? STATUS_COLOR.warning : "var(--admin-text, #e2e8f0)", fontWeight: 600 }}>
                {formatAgeMin(fs.age_minutes)}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Fixtures cron: </span>
              <span style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 600 }}>{formatTime(m.fs_fixtures_cron_ts)}</span>
            </div>
          </div>
        </div>

        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, padding: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 24 }}>⚙️</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Event metrics</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
            <div><span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Pending settle: </span><b>{m.events_pending_settlement}</b></div>
            <div><span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Settled 1h: </span><b>{m.events_settled_last_hour}</b></div>
            <div><span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Settled today: </span><b>{m.events_settled_today}</b></div>
            <div><span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Live phantom: </span><b style={{ color: m.live_events_phantom > 0 ? "#f59e0b" : "inherit" }}>{m.live_events_phantom}</b></div>
            <div><span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Data freshness: </span><b>{formatAgeSec(m.fs_data_freshness_seconds)}</b></div>
            <div><span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Settle cron: </span><b>{formatAgeMin(m.settlement_cron_age_minutes)}</b></div>
          </div>
        </div>
      </div>

      {/* Coverage by Sport */}
      {data.coverage_by_sport.length > 0 && (
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, padding: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)" }}>
              FS Coverage by Sport
            </div>
            <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
              Total: {data.coverage_total.events_fs_trackable.toLocaleString("it-IT")}/{data.coverage_total.events_total.toLocaleString("it-IT")} events ({data.coverage_total.fs_trackable_pct}%) ·
              {" "}{(data.coverage_total.prematch_markets + data.coverage_total.live_markets + data.coverage_total.score_markets + data.coverage_total.stats_markets + data.coverage_total.player_markets).toLocaleString("it-IT")} markets
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                  <th style={th}>Sport</th>
                  <th style={thR}>Events</th>
                  <th style={thR}>FS-trackable</th>
                  <th style={thR}>%</th>
                  <th style={thR}>Prematch</th>
                  <th style={thR}>Live</th>
                  <th style={thR}>Score</th>
                  <th style={thR}>Stats</th>
                  <th style={thR}>Player</th>
                </tr>
              </thead>
              <tbody>
                {data.coverage_by_sport.map((r) => (
                  <tr key={r.sport_slug} style={{ borderTop: "1px solid var(--admin-border, #1e3a5f)" }}>
                    <td style={td}><code style={{ color: "#8b5cf6" }}>{r.sport_slug}</code></td>
                    <td style={tdR}>{r.events_total.toLocaleString("it-IT")}</td>
                    <td style={tdR}>{r.events_fs_trackable.toLocaleString("it-IT")}</td>
                    <td style={{ ...tdR, color: pctColor(r.fs_trackable_pct), fontWeight: 700 }}>{r.fs_trackable_pct}%</td>
                    <td style={tdR}>{r.prematch_markets.toLocaleString("it-IT")}</td>
                    <td style={tdR}>{r.live_markets.toLocaleString("it-IT")}</td>
                    <td style={tdR}>{r.score_markets.toLocaleString("it-IT")}</td>
                    <td style={tdR}>{r.stats_markets.toLocaleString("it-IT")}</td>
                    <td style={tdR}>{r.player_markets.toLocaleString("it-IT")}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--admin-border, #1e3a5f)", background: "rgba(255,255,255,0.03)", fontWeight: 700 }}>
                  <td style={td}>TOTAL</td>
                  <td style={tdR}>{data.coverage_total.events_total.toLocaleString("it-IT")}</td>
                  <td style={tdR}>{data.coverage_total.events_fs_trackable.toLocaleString("it-IT")}</td>
                  <td style={{ ...tdR, color: pctColor(data.coverage_total.fs_trackable_pct) }}>{data.coverage_total.fs_trackable_pct}%</td>
                  <td style={tdR}>{data.coverage_total.prematch_markets.toLocaleString("it-IT")}</td>
                  <td style={tdR}>{data.coverage_total.live_markets.toLocaleString("it-IT")}</td>
                  <td style={tdR}>{data.coverage_total.score_markets.toLocaleString("it-IT")}</td>
                  <td style={tdR}>{data.coverage_total.stats_markets.toLocaleString("it-IT")}</td>
                  <td style={tdR}>{data.coverage_total.player_markets.toLocaleString("it-IT")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stuck Events + Phantom Live (2 columns) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Stuck events */}
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, padding: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)", marginBottom: 8 }}>
            Stuck Events ({data.stuck_events.length})
            <span style={{ marginLeft: 8, fontSize: 10, textTransform: "none", letterSpacing: 0, color: "#64748b" }}>
              kickoff &gt; 3.5h ago, status live/pending
            </span>
          </div>
          {data.stuck_events.length === 0 ? (
            <div style={{ fontSize: 13, color: "#10b981", padding: 8 }}>✓ Nessun evento bloccato</div>
          ) : (
            <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left", position: "sticky", top: 0 }}>
                    <th style={th}>Match</th>
                    <th style={th}>Sport</th>
                    <th style={th}>Kickoff</th>
                    <th style={thR}>Stuck</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stuck_events.map((e) => (
                    <tr key={e.id} style={{ borderTop: "1px solid var(--admin-border, #1e3a5f)" }}>
                      <td style={td}>{e.match}</td>
                      <td style={td}><code style={{ color: "#8b5cf6", fontSize: 11 }}>{e.sport}</code></td>
                      <td style={td}>{formatDateTime(e.starts_at)}</td>
                      <td style={{ ...tdR, color: e.stuck_minutes > 720 ? "#ef4444" : "#f59e0b", fontWeight: 700 }}>
                        {Math.round(e.stuck_minutes / 60)}h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Phantom live events */}
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, padding: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)", marginBottom: 8 }}>
            Phantom Live ({data.phantom_live_events.length})
            <span style={{ marginLeft: 8, fontSize: 10, textTransform: "none", letterSpacing: 0, color: "#64748b" }}>
              status='live' but flashscore_id is NULL — matcher gap
            </span>
          </div>
          {data.phantom_live_events.length === 0 ? (
            <div style={{ fontSize: 13, color: "#10b981", padding: 8 }}>✓ Tutti gli eventi live sono FS-tracked</div>
          ) : (
            <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left", position: "sticky", top: 0 }}>
                    <th style={th}>Match</th>
                    <th style={th}>Sport / League</th>
                    <th style={thR}>Kickoff +</th>
                  </tr>
                </thead>
                <tbody>
                  {data.phantom_live_events.map((e) => (
                    <tr key={e.id} style={{ borderTop: "1px solid var(--admin-border, #1e3a5f)" }}>
                      <td style={td}>{e.match}</td>
                      <td style={td}>
                        <code style={{ color: "#8b5cf6", fontSize: 11 }}>{e.sport_slug ?? "?"}</code>
                        {e.league_name && <div style={{ fontSize: 10, color: "#64748b" }}>{e.league_name}</div>}
                      </td>
                      <td style={{ ...tdR, color: e.minutes_since_kickoff > 180 ? "#ef4444" : "#f59e0b", fontWeight: 700 }}>
                        {e.minutes_since_kickoff < 60 ? `${e.minutes_since_kickoff}m` : `${Math.round(e.minutes_since_kickoff / 60)}h`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Recent settlements */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, padding: 16,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)", marginBottom: 8 }}>
          Recent Settlements ({data.recent_settlements.length})
        </div>
        {data.recent_settlements.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--admin-text-muted, #94a3b8)", padding: 8 }}>Nessun settlement recente</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                  <th style={th}>Match</th>
                  <th style={th}>Sport</th>
                  <th style={th}>Score</th>
                  <th style={th}>Settled at</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_settlements.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--admin-border, #1e3a5f)" }}>
                    <td style={td}>{s.match}</td>
                    <td style={td}><code style={{ color: "#8b5cf6", fontSize: 11 }}>{s.sport}</code></td>
                    <td style={{ ...td, fontFamily: "monospace", fontWeight: 700 }}>{s.score ?? "—"}</td>
                    <td style={td}>{formatDateTime(s.settled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CanonicalCoverageCard />
    </div>
  );
}

// ═══ CANONICAL COVERAGE CARD (unchanged from prior version) ═══

interface CoverageCanonical {
  canonical_key: string;
  canonical_name_it: string | null;
  has_settler: boolean;
  void_by_design: boolean;
  total_mappings: number;
  verified_mappings: number;
  by_source: Record<string, { total: number; verified: number }>;
}
interface CoverageData {
  totals: {
    canonicals: number;
    settleable: number;
    void_by_design: number;
    gap: number;
    total_mappings: number;
    settleable_mappings: number;
  };
  canonicals: CoverageCanonical[];
}

function CanonicalCoverageCard() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showGaps, setShowGaps] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/settlement-health/canonical-coverage");
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        setData(json);
      } catch (e: any) { setErr(e?.message ?? String(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  const gaps = (data?.canonicals ?? []).filter((c) => !c.has_settler && !c.void_by_design).slice(0, 20);
  const coveragePct = data && data.totals.total_mappings > 0
    ? Math.round((data.totals.settleable_mappings / data.totals.total_mappings) * 100)
    : 0;

  return (
    <div style={{
      background: "var(--admin-card, #0f172a)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 12,
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>🎯</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Canonical dispatch coverage
          </div>
          <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 2 }}>
            Settlement Phase B/C fallback: quanto copre il <code>CANONICAL_TO_SETTLER</code> dei canonical oggi mappati in DB.
          </div>
        </div>
        {data && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 13 }}>
            <StatCell label="Canonicals mappati" value={data.totals.canonicals} />
            <StatCell label="Settleable" value={data.totals.settleable} color="#10b981" />
            <StatCell label="Void by design" value={data.totals.void_by_design} color="#64748b" />
            <StatCell label="Gap (actionable)" value={data.totals.gap} color={data.totals.gap > 0 ? "#f59e0b" : "#10b981"} />
            <StatCell label="Coverage vol." value={`${coveragePct}%`} color={coveragePct >= 95 ? "#10b981" : coveragePct >= 80 ? "#60a5fa" : "#f59e0b"} />
          </div>
        )}
      </div>

      {loading && <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>Caricamento…</div>}
      {err && <div style={{ padding: 8, background: "#ef444420", color: "#ef4444", borderRadius: 6, fontSize: 12 }}>{err}</div>}

      {data && data.totals.gap > 0 && (
        <>
          <button
            onClick={() => setShowGaps(!showGaps)}
            aria-label={showGaps ? "Nascondi dettaglio gap" : "Mostra dettaglio gap"}
            style={{
              alignSelf: "flex-start",
              padding: "4px 12px",
              background: "transparent",
              border: "1px solid #f59e0b66",
              color: "#f59e0b",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {showGaps ? "▼" : "▶"} Top gap canonicals (primi 20 per volume)
          </button>
          {showGaps && (
            <div style={{ border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                    <th style={thGap}>canonical_key</th>
                    <th style={thGap}>nome IT</th>
                    <th style={{ ...thGap, textAlign: "right" }}>Tipo mappati</th>
                    <th style={{ ...thGap, textAlign: "right" }}>Verificati</th>
                    <th style={thGap}>Fonti</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.map((g) => (
                    <tr key={g.canonical_key} style={{ borderTop: "1px solid var(--admin-border, #1e3a5f)" }}>
                      <td style={tdGap}><code style={{ color: "#8b5cf6" }}>{g.canonical_key}</code></td>
                      <td style={tdGap}>{g.canonical_name_it ?? "—"}</td>
                      <td style={{ ...tdGap, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{g.total_mappings}</td>
                      <td style={{ ...tdGap, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{g.verified_mappings}</td>
                      <td style={tdGap}>
                        {Object.keys(g.by_source).map((s) => (
                          <span key={s} style={{ display: "inline-block", marginRight: 6, fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(100,116,139,0.15)", color: "var(--admin-text-muted, #94a3b8)" }}>
                            {s}:{g.by_source[s].total}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)", letterSpacing: 0.5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "var(--admin-text, #e2e8f0)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>
        {typeof value === "number" ? value.toLocaleString("it-IT") : value}
      </div>
    </div>
  );
}

// ═══ STYLES ═══

const th: React.CSSProperties = { padding: "8px 10px", fontSize: 10, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)", fontWeight: 700, letterSpacing: 0.5 };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "6px 10px", color: "var(--admin-text, #e2e8f0)" };
const tdR: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const thGap: React.CSSProperties = { padding: "8px 10px", fontSize: 10, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)", fontWeight: 700, letterSpacing: 0.5 };
const tdGap: React.CSSProperties = { padding: "6px 10px", color: "var(--admin-text, #e2e8f0)" };
