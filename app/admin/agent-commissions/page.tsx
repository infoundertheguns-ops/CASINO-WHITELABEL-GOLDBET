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
    <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#94a3b8", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || "#e2e8f0", fontFamily: "monospace" }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export default function AgentCommissionsPage() {
  const [data, setData] = useState<any>(null);
  const [agent, setAgent] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

  const loadData = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      const me = await meRes.json();
      const userId = me.user?.id;
      if (!userId) return;

      const agentsRes = await fetch("/api/admin/agents");
      const agentsData = await agentsRes.json();
      const myAgent = (agentsData.agents || []).find((a: any) => a.user_id === userId);
      if (!myAgent) return;
      setAgent(myAgent);

      // Financial data scoped to this agent
      const finRes = await fetch(`/api/admin/financial?agent_id=${myAgent.id}&period=${period}`);
      const finData = await finRes.json();
      setData(finData);

      // Transactions
      const detailRes = await fetch(`/api/admin/agents/${myAgent.id}`);
      const detail = await detailRes.json();
      setTransactions(detail.transactions || []);
    } catch { }
    finally { setLoading(false); }
  }, [period]);

  useEffect(() => { loadData(); }, [loadData]);

  const fmt = (n: number) => `€${(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`;

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento report...</div>;

  const k = data?.kpis || {};
  const commission = (k.ggr || 0) > 0 ? k.ggr * ((agent?.commission_rate || 0) / 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header + Period */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Report & Commissioni</h2>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <KPI label="Scommesse" value={String(k.total_bets || 0)} color="#60a5fa" />
        <KPI label="Turnover" value={fmt(k.turnover)} color="#60a5fa" />
        <KPI label="Vincite" value={fmt(k.winnings)} color="#ef4444" />
        <KPI label="GGR" value={fmt(k.ggr)} color={(k.ggr || 0) >= 0 ? "#10b981" : "#ef4444"} subtitle={`Margine: ${k.margin || 0}%`} />
        <KPI label="Commissione" value={fmt(commission)} color="#f0b429" subtitle={`${agent?.commission_rate || 0}% su GGR`} />
      </div>

      {/* Sport breakdown */}
      {(data?.by_sport || []).length > 0 && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
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
              {(data?.by_sport || []).map((s: any) => (
                <tr key={s.sport} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0", fontWeight: 600 }}>{s.sport}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{s.bets}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#60a5fa" }}>{fmt(s.turnover)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#ef4444" }}>{fmt(s.winnings)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: s.ggr >= 0 ? "#10b981" : "#ef4444" }}>{fmt(s.ggr)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{s.margin}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transactions */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
          Ultime Transazioni
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              {["Data", "Tipo", "Importo", "Saldo Dopo", "Note"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Nessuna transazione</td></tr>
            ) : transactions.map((t: any) => (
              <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#94a3b8" }}>
                  {new Date(t.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td style={{ padding: "6px 12px", color: "#e2e8f0", fontWeight: 500 }}>{t.type}</td>
                <td style={{ padding: "6px 12px", fontFamily: "monospace", fontWeight: 700, color: t.amount >= 0 ? "#10b981" : "#ef4444" }}>
                  {t.amount >= 0 ? "+" : ""}{t.amount?.toFixed(2)}
                </td>
                <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{t.balance_after?.toFixed(2) ?? "—"}</td>
                <td style={{ padding: "6px 12px", color: "#64748b", fontSize: 11 }}>{t.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
