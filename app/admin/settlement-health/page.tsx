"use client";

import { useEffect, useState, useCallback } from "react";

// ═══ TYPES ═══

interface Actor {
  status: "healthy" | "warning" | "critical";
  last_push?: string;
  last_settlement?: string;
  last_run?: string;
  age_minutes: number | null;
  matched_24h?: number;
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
  created_at: string;
  markets_settled: number;
  bets_settled: number;
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
  ippica: { unsettled_odds: number; finished_races: number };
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ═══ COMPONENTS ═══

function KPI({ label, value, color, subtitle }: { label: string; value: string | number; color?: string; subtitle?: string }) {
  return (
    <div style={{
      background: "var(--admin-card, #0f172a)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 12, padding: "16px 20px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || "var(--admin-text, #e2e8f0)", fontFamily: "monospace" }}>
        {value}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

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

  const sportBacklogEntries = Object.entries(data.backlog_by_sport).sort((a, b) => b[1] - a[1]);

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

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
        <KPI
          label="Backlog"
          value={data.backlog}
          color={data.backlog > 200 ? "#ef4444" : data.backlog > 50 ? "#f59e0b" : "#10b981"}
          subtitle="eventi finished in attesa"
        />
        <KPI label="Settlati 1h" value={data.rates.last_1h} color="#60a5fa" />
        <KPI label="Settlati 6h" value={data.rates.last_6h} color="#60a5fa" />
        <KPI label="Settlati 24h" value={data.rates.last_24h} color="#60a5fa" />
        <KPI
          label="Tempo medio"
          value={`${data.avg_settlement_minutes}m`}
          color={data.avg_settlement_minutes > 120 ? "#f59e0b" : "#10b981"}
          subtitle="da inizio evento a settlement"
        />
      </div>

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

      {/* Actors */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <ActorCard
          name="Flashscore Scraper"
          icon="📡"
          actor={data.actors.flashscore}
          description="Manda risultati + fixtures al DB"
        />
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

      {/* Backlog by Sport + Stuck Events side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        {/* Backlog by Sport */}
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--admin-border, #1e3a5f)", fontSize: 13, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Backlog per Sport
          </div>
          {sportBacklogEntries.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#10b981", fontSize: 13 }}>
              Nessun backlog
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {sportBacklogEntries.map(([sport, count]) => (
                  <tr key={sport} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "8px 16px", color: "var(--admin-text, #e2e8f0)" }}>{sport}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: count > 20 ? "#f59e0b" : "var(--admin-text, #e2e8f0)" }}>
                      {count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Stuck Events */}
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--admin-border, #1e3a5f)", fontSize: 13, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Eventi Stuck ({">"}30 min in finished)
          </div>
          {data.stuck_events.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#10b981", fontSize: 13 }}>
              Nessun evento stuck
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
                  {["Evento", "Sport", "Stuck da", "Inizio"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.stuck_events.map(e => (
                  <tr key={e.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "6px 12px", color: "var(--admin-text, #e2e8f0)", fontWeight: 500 }}>{e.match}</td>
                    <td style={{ padding: "6px 12px", color: "var(--admin-text-muted, #94a3b8)" }}>{e.sport}</td>
                    <td style={{ padding: "6px 12px", fontFamily: "monospace", color: e.stuck_minutes > 60 ? "#ef4444" : "#f59e0b", fontWeight: 700 }}>
                      {e.stuck_minutes} min
                    </td>
                    <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "var(--admin-text-muted, #94a3b8)", fontSize: 11 }}>
                      {new Date(e.starts_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

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
            <span style={{ color: "var(--admin-text-muted, #94a3b8)" }}>Quote non settlate: </span>
            <span style={{ fontWeight: 700, color: data.ippica.unsettled_odds > 100 ? "#f59e0b" : "#10b981", fontFamily: "monospace" }}>
              {data.ippica.unsettled_odds}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Settlement Log */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--admin-border, #1e3a5f)", fontSize: 13, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
          Ultimi Settlement
        </div>
        {data.recent_settlements.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted, #94a3b8)", fontSize: 13 }}>
            Nessun settlement recente nel log
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                {["Ora", "Event ID", "Mercati", "Scommesse"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recent_settlements.map((s, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "var(--admin-text-muted, #94a3b8)" }}>
                    {formatTime(s.created_at)}
                  </td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)", fontSize: 11 }}>
                    {s.event_id.slice(0, 8)}...
                  </td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#60a5fa", fontWeight: 600 }}>
                    {s.markets_settled ?? "—"}
                  </td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#a78bfa", fontWeight: 600 }}>
                    {s.bets_settled ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
