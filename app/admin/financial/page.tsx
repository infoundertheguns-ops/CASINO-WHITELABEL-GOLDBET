"use client";

import { useEffect, useState, useCallback } from "react";

const PERIODS = [
  { key: "today", label: "Oggi" },
  { key: "yesterday", label: "Ieri" },
  { key: "week", label: "7 Giorni" },
  { key: "month", label: "Mese" },
];

function KPI({ label, value, color, subtitle }: { label: string; value: string; color?: string; subtitle?: string }) {
  return (
    <div style={{
      background: "var(--admin-card, #0f172a)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 12, padding: "16px 20px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--admin-text-muted, #94a3b8)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || "var(--admin-text, #e2e8f0)", fontFamily: "monospace" }}>
        {value}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export default function FinancialPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("today");
  const [lastRefresh, setLastRefresh] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/financial?period=${period}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date().toLocaleTimeString("it-IT"));
    } catch { }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { loadData(); }, [loadData]);

  const fmt = (n: number) => `€${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (loading && !data) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento report...</div>;

  const k = data?.kpis || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header + Period tabs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Financial Report
          </h2>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            Turnover, GGR, Margine, Commissioni
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: period === p.key ? "1px solid #f0b429" : "1px solid #1e3a5f",
                background: period === p.key ? "#f0b42920" : "transparent",
                color: period === p.key ? "#f0b429" : "#94a3b8",
              }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KPI label="Turnover" value={fmt(k.turnover || 0)} color="#60a5fa" subtitle={`${k.total_bets || 0} scommesse`} />
        <KPI label="Vincite Pagate" value={fmt(k.winnings || 0)} color="#ef4444" />
        <KPI label="GGR" value={fmt(k.ggr || 0)} color={k.ggr >= 0 ? "#10b981" : "#ef4444"} subtitle={`Margine: ${k.margin || 0}%`} />
        <KPI label="Media" value={fmt(k.avg_stake || 0)} subtitle={`Quota media: ${k.avg_odds || 0}`} />
      </div>

      {/* Two columns: Sport breakdown + Bet type */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        {/* Sport breakdown */}
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
            GGR per Sport
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                {["Sport", "Bet", "Turnover", "Vincite", "GGR", "Margine"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.by_sport || []).length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Nessun dato</td></tr>
              ) : (data?.by_sport || []).map((s: any) => (
                <tr key={s.sport} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0", fontWeight: 600 }}>{s.sport}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{s.bets}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#60a5fa" }}>{fmt(s.turnover)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#ef4444" }}>{fmt(s.winnings)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: s.ggr >= 0 ? "#10b981" : "#ef4444" }}>{fmt(s.ggr)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: s.margin >= 0 ? "#10b981" : "#ef4444" }}>{s.margin}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bet type + Live/Prematch */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{
            background: "var(--admin-card, #0f172a)",
            border: "1px solid #1e3a5f", borderRadius: 12, padding: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 12 }}>Per Tipo</div>
            {(data?.by_type || []).map((t: any) => (
              <div key={t.type} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                <span style={{ color: "#e2e8f0", fontWeight: 600, textTransform: "capitalize" }}>{t.type}</span>
                <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>{t.count} · {fmt(t.stake)}</span>
              </div>
            ))}
          </div>

          <div style={{
            background: "var(--admin-card, #0f172a)",
            border: "1px solid #1e3a5f", borderRadius: 12, padding: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 12 }}>Live vs Prematch</div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: "#ef4444" }}>{data?.live_vs_prematch?.live?.count || 0}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>LIVE</div>
              </div>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "monospace", color: "#60a5fa" }}>{data?.live_vs_prematch?.prematch?.count || 0}</div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>PREMATCH</div>
              </div>
            </div>
          </div>

          {/* Ticket stats */}
          <div style={{
            background: "var(--admin-card, #0f172a)",
            border: "1px solid #1e3a5f", borderRadius: 12, padding: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 12 }}>Ticket Kiosk</div>
            <div style={{ fontSize: 13 }}>
              {[
                { label: "Stampati", val: data?.tickets?.total || 0, color: "#e2e8f0" },
                { label: "Vinti", val: data?.tickets?.won || 0, color: "#10b981" },
                { label: "Incassati", val: data?.tickets?.claimed || 0, color: "#a78bfa" },
                { label: "Persi", val: data?.tickets?.lost || 0, color: "#ef4444" },
                { label: "Pagato", val: fmt(data?.tickets?.total_paid || 0), color: "#f59e0b" },
              ].map(r => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span style={{ color: "#94a3b8" }}>{r.label}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: r.color }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Agent breakdown */}
      {(data?.by_agent || []).length > 0 && (
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
            P&L per Agente
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                {["Codice", "Nome", "Giocatori", "Bet", "Turnover", "Vincite", "GGR", "Comm. %", "Commissione"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.by_agent || []).map((a: any) => (
                <tr key={a.agent_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: "#f0b429" }}>{a.code}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: "#e2e8f0" }}>{a.name}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{a.players}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{a.bets}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#60a5fa" }}>{fmt(a.turnover)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#ef4444" }}>{fmt(a.winnings)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: a.ggr >= 0 ? "#10b981" : "#ef4444" }}>{fmt(a.ggr)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{a.commission_rate}%</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: "#f0b429" }}>{fmt(a.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
