"use client";

import { useEffect, useState, useCallback } from "react";
import { Kpi, KpiRow } from "@/components/admin/ui";

// ═══ TYPES ═══

interface Actor {
  status: "healthy" | "warning" | "critical";
  last_push?: string;
  last_settlement?: string;
  last_run?: string;
  age_minutes: number | null;
  matched_24h?: number;
  interval_minutes?: number;
  next_in_minutes?: number | null;
}

interface StuckEvent {
  id: string;
  match: string;
  sport: string;
  starts_at: string;
  finished_since: string;
  stuck_minutes: number;
}

interface SettlementEntry {
  event_id: string;
  match: string;
  score: string | null;
  sport: string;
  settled_at: string;
}

interface Subsystem {
  score: number;
  weight: number;
  label: string;
  details: string;
}

interface HealthData {
  overall: "healthy" | "warning" | "critical";
  health_score: number;
  health_level: "healthy" | "degraded" | "critical";
  subsystems: Record<string, Subsystem>;
  backlog: number;
  stuck_events: StuckEvent[];
  rates: { last_1h: number; last_6h: number; last_24h: number };
  avg_settlement_minutes: number;
  backlog_by_sport: Record<string, number>;
  actors: {
    flashscore: Actor;
    verify_results: Actor;
    cleanup: Actor;
  };
  recent_settlements: SettlementEntry[];
  ippica: { unsettled_odds: number; pending_odds: number; finished_races: number };
  generated_at: string;
}

// ═══ HELPERS ═══

const STATUS_COLOR: Record<string, string> = {
  healthy: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
};

const STATUS_BG: Record<string, string> = {
  healthy: "#10b98115",
  warning: "#f59e0b15",
  critical: "#ef444415",
};

const STATUS_LABEL: Record<string, string> = {
  healthy: "OPERATIVO",
  warning: "ATTENZIONE",
  critical: "CRITICO",
};

function formatAge(minutes: number | null): string {
  if (minutes === null) return "N/A";
  if (minutes < 1) return "< 1 min fa";
  if (minutes < 60) return `${minutes} min fa`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h fa`;
  return `${Math.round(minutes / 1440)}d fa`;
}

function formatCountdown(minutes: number | null): string {
  if (minutes === null) return "N/A";
  if (minutes <= 0) return "imminente";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.round(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ═══ COMPONENTS ═══

function ActorCard({ name, icon, actor, description }: { name: string; icon: string; actor: Actor; description: string }) {
  const age = actor.age_minutes;
  const lastActivity = actor.last_push || actor.last_settlement || actor.last_run;

  return (
    <div style={{
      background: "var(--admin-card, #0f172a)",
      border: `1px solid ${STATUS_COLOR[actor.status]}40`,
      borderRadius: 12, padding: 20,
      borderLeft: `4px solid ${STATUS_COLOR[actor.status]}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>{icon}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>{name}</div>
            <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>{description}</div>
          </div>
        </div>
        <span style={{
          padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 800,
          background: STATUS_BG[actor.status], color: STATUS_COLOR[actor.status],
        }}>
          {STATUS_LABEL[actor.status]}
        </span>
      </div>

      <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
        <div>
          <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Ultima attività: </span>
          <span style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 600 }}>
            {lastActivity ? formatTime(lastActivity) : "—"}
          </span>
        </div>
        <div>
          <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Età: </span>
          <span style={{ color: age !== null && age > 30 ? STATUS_COLOR.warning : "var(--admin-text, #e2e8f0)", fontWeight: 600 }}>
            {formatAge(age)}
          </span>
        </div>
        {(actor as any).settled_1h !== undefined && (
          <div>
            <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Settlati 1h: </span>
            <span style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 600 }}>{(actor as any).settled_1h}</span>
          </div>
        )}
        {actor.matched_24h !== undefined && (
          <div>
            <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Matchati 24h: </span>
            <span style={{ color: "var(--admin-text, #e2e8f0)", fontWeight: 600 }}>{actor.matched_24h}</span>
          </div>
        )}
      </div>

      {/* Next update countdown */}
      {actor.interval_minutes !== undefined && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", gap: 8, fontSize: 12,
        }}>
          <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Prossimo aggiornamento:</span>
          <span style={{
            fontWeight: 700, fontFamily: "monospace",
            color: (actor.next_in_minutes ?? 99) <= 0 ? "#10b981" : (actor.next_in_minutes ?? 99) <= 5 ? "#60a5fa" : "var(--admin-text, #e2e8f0)",
          }}>
            {formatCountdown(actor.next_in_minutes ?? null)}
          </span>
          <span style={{ color: "var(--admin-text-muted, #94a3b8)", fontSize: 10 }}>
            (ogni {actor.interval_minutes < 60 ? `${actor.interval_minutes} min` : `${Math.round(actor.interval_minutes / 60)}h`})
          </span>
        </div>
      )}
    </div>
  );
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


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header with Score */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Big Score Circle */}
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            border: `3px solid ${data.health_score >= 80 ? "#10b981" : data.health_score >= 50 ? "#f59e0b" : "#ef4444"}`,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: `${data.health_score >= 80 ? "#10b981" : data.health_score >= 50 ? "#f59e0b" : "#ef4444"}10`,
          }}>
            <span style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: data.health_score >= 80 ? "#10b981" : data.health_score >= 50 ? "#f59e0b" : "#ef4444" }}>
              {data.health_score}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--admin-text-muted, #94a3b8)", marginTop: -2 }}>/ 100</span>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
              Settlement Health
            </h2>
            <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 2 }}>
              Monitoraggio pipeline: Flashscore → Verify Results → Cleanup
            </div>
          </div>
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

      {/* KPIs — E9 shared primitive */}
      <KpiRow minWidth={160}>
        <Kpi
          label="Backlog"
          value={data.backlog}
          accent={data.backlog > 200 ? "#ef4444" : data.backlog > 50 ? "#f59e0b" : "#10b981"}
          sub="eventi finished in attesa"
        />
        <Kpi label="Settlati 1h" value={data.rates.last_1h} accent="#60a5fa" />
        <Kpi label="Settlati 6h" value={data.rates.last_6h} accent="#60a5fa" />
        <Kpi label="Settlati 24h" value={data.rates.last_24h} accent="#60a5fa" />
        <Kpi
          label="Tempo medio"
          value={`${data.avg_settlement_minutes}m`}
          accent={data.avg_settlement_minutes > 120 ? "#f59e0b" : "#10b981"}
          sub="da inizio evento a settlement"
        />
      </KpiRow>

      {/* Subsystem Score Bars */}
      {data.subsystems && (
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, padding: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)", marginBottom: 12 }}>
            Subsystem Scores
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(data.subsystems).map(([key, sub]) => {
              const barColor = sub.score >= 80 ? "#10b981" : sub.score >= 50 ? "#f59e0b" : "#ef4444";
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 140, fontSize: 13, fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
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
                  <span style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", minWidth: 180 }}>
                    {sub.details}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actors — Flashscore moved to Scraper Monitor (E7) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <FlashscoreLinkCard />
        <ActorCard
          name="Verify Results"
          icon="✅"
          actor={data.actors.verify_results}
          description="Matcha risultati e chiama settleEvent()"
        />
        <ActorCard
          name="Cleanup Cron"
          icon="🧹"
          actor={data.actors.cleanup}
          description="Safety net: chiude eventi non settlati"
        />
      </div>

      {/* Canonical dispatch coverage (Settlement Phase B/C observability) */}
      <CanonicalCoverageCard />

      {/* Ippica Settlement */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, padding: 16,
        display: "flex", alignItems: "center", gap: 24,
      }}>
        <span style={{ fontSize: 24 }}>🏇</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Ippica Settlement</div>
          <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 2 }}>
            Gestito dallo scraper MST (results-loop)
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 24, fontSize: 13 }}>
          <div>
            <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Corse finite: </span>
            <span style={{ fontWeight: 700, color: "var(--admin-text, #e2e8f0)", fontFamily: "monospace" }}>{data.ippica.finished_races}</span>
          </div>
          <div>
            <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Non settlate: </span>
            <span style={{ fontWeight: 700, color: data.ippica.unsettled_odds > 0 ? "#ef4444" : "#10b981", fontFamily: "monospace" }}>
              {data.ippica.unsettled_odds}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>In programma: </span>
            <span style={{ fontWeight: 700, color: "#60a5fa", fontFamily: "monospace" }}>
              {data.ippica.pending_odds}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}

// ═══ FLASHSCORE LINK CARD (E7: single source of truth) ═══

function FlashscoreLinkCard() {
  return (
    <a
      href="/admin/scraper#flashscore"
      style={{
        textDecoration: "none",
        background: "var(--admin-card, #0f172a)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      title="Apri Scraper Monitor — sezione Flashscore"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>📡</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Flashscore Scraper</div>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#06b6d4", background: "#06b6d415", border: "1px solid #06b6d444", borderRadius: 999, padding: "2px 8px", fontWeight: 700 }}>
          → Scraper Monitor
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", lineHeight: 1.5 }}>
        Status e ultimo push del Flashscore actor sono consolidati nello Scraper Monitor — clicca per aprire la sezione dedicata.
      </div>
    </a>
  );
}

// ═══ CANONICAL COVERAGE CARD (Settlement Phase B/C observability) ═══

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

const thGap: React.CSSProperties = { padding: "8px 10px", fontSize: 10, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)", fontWeight: 700, letterSpacing: 0.5 };
const tdGap: React.CSSProperties = { padding: "6px 10px", color: "var(--admin-text, #e2e8f0)" };
