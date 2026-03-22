"use client";

import { useEffect, useState, useCallback } from "react";

function KPI({ label, value, color, subtitle }: { label: string; value: string; color?: string; subtitle?: string }) {
  return (
    <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#94a3b8", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || "#e2e8f0", fontFamily: "monospace" }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export default function AgentDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      // Get current user's agent info
      const meRes = await fetch("/api/auth/me");
      const me = await meRes.json();
      const userId = me.user?.id;
      if (!userId) return;

      // Find my agent
      const agentsRes = await fetch("/api/admin/agents");
      const agentsData = await agentsRes.json();
      const myAgent = (agentsData.agents || []).find((a: any) => a.user_id === userId);
      if (!myAgent) return;

      // Get my financial data
      const finRes = await fetch(`/api/admin/financial?agent_id=${myAgent.id}&period=today`);
      const finToday = await finRes.json();

      const finWeekRes = await fetch(`/api/admin/financial?agent_id=${myAgent.id}&period=week`);
      const finWeek = await finWeekRes.json();

      const finMonthRes = await fetch(`/api/admin/financial?agent_id=${myAgent.id}&period=month`);
      const finMonth = await finMonthRes.json();

      // Get agent detail
      const detailRes = await fetch(`/api/admin/agents/${myAgent.id}`);
      const detail = await detailRes.json();

      setData({
        agent: myAgent,
        detail,
        today: finToday,
        week: finWeek,
        month: finMonth,
      });
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const fmt = (n: number) => `€${(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`;

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento dashboard...</div>;
  if (!data) return <div style={{ padding: 60, textAlign: "center", color: "#ef4444" }}>Errore caricamento</div>;

  const a = data.agent;
  const t = data.today?.kpis || {};
  const w = data.week?.kpis || {};
  const m = data.month?.kpis || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#e2e8f0" }}>
          Benvenuto, {a.name}
        </h2>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
          {a.code} · Commissione {a.commission_rate}% · Wallet {a.wallet_model}
          {a.wallet_model === "prepaid" && ` · Saldo: ${fmt(a.wallet_balance || 0)}`}
        </div>
      </div>

      {/* KPIs Oggi */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>Oggi</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <KPI label="Scommesse" value={String(t.total_bets || 0)} color="#60a5fa" />
          <KPI label="Turnover" value={fmt(t.turnover)} color="#60a5fa" />
          <KPI label="GGR" value={fmt(t.ggr)} color={(t.ggr || 0) >= 0 ? "#10b981" : "#ef4444"} />
          <KPI label="Margine" value={`${t.margin || 0}%`} color={(t.margin || 0) >= 0 ? "#10b981" : "#f59e0b"} />
          <KPI label="Commissione" value={fmt((t.ggr || 0) > 0 ? t.ggr * (a.commission_rate / 100) : 0)} color="#f0b429" />
        </div>
      </div>

      {/* KPIs Settimana + Mese */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 12 }}>Ultimi 7 Giorni</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div><div style={{ color: "#94a3b8", fontSize: 10 }}>BET</div><div style={{ fontWeight: 800, fontFamily: "monospace", color: "#e2e8f0", fontSize: 18 }}>{w.total_bets || 0}</div></div>
            <div><div style={{ color: "#94a3b8", fontSize: 10 }}>TURNOVER</div><div style={{ fontWeight: 800, fontFamily: "monospace", color: "#60a5fa", fontSize: 18 }}>{fmt(w.turnover)}</div></div>
            <div><div style={{ color: "#94a3b8", fontSize: 10 }}>GGR</div><div style={{ fontWeight: 800, fontFamily: "monospace", color: (w.ggr || 0) >= 0 ? "#10b981" : "#ef4444", fontSize: 18 }}>{fmt(w.ggr)}</div></div>
          </div>
        </div>
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 12 }}>Mese Corrente</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 13 }}>
            <div><div style={{ color: "#94a3b8", fontSize: 10 }}>BET</div><div style={{ fontWeight: 800, fontFamily: "monospace", color: "#e2e8f0", fontSize: 18 }}>{m.total_bets || 0}</div></div>
            <div><div style={{ color: "#94a3b8", fontSize: 10 }}>TURNOVER</div><div style={{ fontWeight: 800, fontFamily: "monospace", color: "#60a5fa", fontSize: 18 }}>{fmt(m.turnover)}</div></div>
            <div><div style={{ color: "#94a3b8", fontSize: 10 }}>GGR</div><div style={{ fontWeight: 800, fontFamily: "monospace", color: (m.ggr || 0) >= 0 ? "#10b981" : "#ef4444", fontSize: 18 }}>{fmt(m.ggr)}</div></div>
          </div>
        </div>
      </div>

      {/* Info rapide */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 12 }}>Giocatori</div>
          <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "monospace", color: "#60a5fa" }}>{a.player_count || 0}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>giocatori attivi</div>
        </div>
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", marginBottom: 12 }}>Sub-Agenti</div>
          <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "monospace", color: "#a78bfa" }}>{a.sub_agent_count || 0}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>sotto di te</div>
        </div>
      </div>
    </div>
  );
}
