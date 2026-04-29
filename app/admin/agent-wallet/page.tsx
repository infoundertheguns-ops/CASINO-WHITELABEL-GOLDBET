"use client";

import { useEffect, useState, useCallback } from "react";

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  credit_load:       { label: "Caricamento",   color: "#10b981" },
  credit_distribute: { label: "Distribuzione", color: "#f59e0b" },
  credit_collect:    { label: "Raccolta",       color: "#3b82f6" },
  commission:        { label: "Commissione",    color: "#8b5cf6" },
  settlement:        { label: "Settlement",     color: "#06b6d4" },
};

const PERIOD_OPTIONS = [
  { value: "today", label: "Oggi" },
  { value: "7d",    label: "7 Giorni" },
  { value: "30d",   label: "30 Giorni" },
];

const TYPE_OPTIONS = [
  { value: "",                  label: "Tutti" },
  { value: "credit_load",       label: "Caricamento" },
  { value: "credit_distribute", label: "Distribuzione" },
  { value: "credit_collect",    label: "Raccolta" },
  { value: "commission",        label: "Commissione" },
  { value: "settlement",        label: "Settlement" },
];

export default function AgentWalletPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [period, setPeriod] = useState("30d");
  const [type, setType]     = useState("");
  const [page, setPage]     = useState(1);

  const loadData = useCallback(async (p: number, per: string, typ: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ period: per, page: String(p), limit: "50" });
      if (typ) params.set("type", typ);
      const res = await fetch(`/api/agent/wallet?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Errore"); return; }
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(page, period, type); }, [loadData, page, period, type]);

  const handlePeriod = (val: string) => { setPeriod(val); setPage(1); };
  const handleType   = (val: string) => { setType(val);   setPage(1); };

  const kpis = data?.kpis;
  const transactions: any[] = data?.transactions || [];
  const pagination = data?.pagination;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;
  const walletModel: string = data?.wallet_model || "prepaid";
  const balance: number = kpis?.balance ?? 0;

  const fmt = (n: number) => `€${Math.abs(n).toFixed(2)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Il Mio Wallet</h2>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: "#ef444420", color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Balance card */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
        border: "1px solid #312e81",
        borderRadius: 16,
        padding: "32px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Saldo Disponibile
          </div>
          <div style={{
            fontSize: 48,
            fontWeight: 800,
            fontFamily: "monospace",
            color: balance >= 0 ? "#10b981" : "#ef4444",
            lineHeight: 1,
          }}>
            {balance >= 0 ? "+" : ""}{fmt(balance)}
          </div>
          <div style={{ marginTop: 10 }}>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: 20,
              background: walletModel === "prepaid" ? "#10b98120" : "#f59e0b20",
              color: walletModel === "prepaid" ? "#10b981" : "#f59e0b",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}>
              {walletModel === "prepaid" ? "Prepagato" : "Postpagato"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { label: "Totale Caricato",    value: fmt(kpis?.total_loaded ?? 0),        color: "#10b981" },
            { label: "Totale Distribuito", value: fmt(kpis?.total_distributed ?? 0),   color: "#f59e0b" },
            { label: "Commissioni",        value: fmt(kpis?.total_commissions ?? 0),   color: "#8b5cf6" },
          ].map(kpi => (
            <div key={kpi.label} style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              padding: "14px 20px",
              minWidth: 140,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{kpi.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: kpi.color }}>{kpi.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid #1e3a5f",
        borderRadius: 12,
        padding: "14px 20px",
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#64748b", marginRight: 4 }}>Periodo:</span>
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handlePeriod(opt.value)}
              style={{
                padding: "5px 14px",
                borderRadius: 6,
                border: period === opt.value ? "none" : "1px solid #1e3a5f",
                background: period === opt.value ? "#8b5cf6" : "transparent",
                color: period === opt.value ? "#fff" : "#94a3b8",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#64748b", marginRight: 4 }}>Tipo:</span>
          <select
            value={type}
            onChange={e => handleType(e.target.value)}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid #1e3a5f",
              background: "#0a0914",
              color: "#e2e8f0",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {loading && <span style={{ fontSize: 12, color: "#64748b" }}>Caricamento...</span>}
      </div>

      {/* Transactions table */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid #1e3a5f" }}>
              {["Data", "Tipo", "Importo", "Saldo Dopo", "Note"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 30, textAlign: "center", color: "#64748b" }}>
                  {loading ? "Caricamento..." : "Nessuna transazione nel periodo selezionato"}
                </td>
              </tr>
            ) : transactions.map((tx: any) => {
              const typeInfo = TYPE_LABELS[tx.type] || { label: tx.type, color: "#94a3b8" };
              const amount: number = tx.amount ?? 0;
              const isPositive = amount >= 0;
              return (
                <tr key={tx.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#94a3b8", fontSize: 11, whiteSpace: "nowrap" }}>
                    {tx.created_at
                      ? new Date(tx.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 4,
                      background: `${typeInfo.color}20`,
                      color: typeInfo.color,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}>
                      {typeInfo.label}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: isPositive ? "#10b981" : "#ef4444", whiteSpace: "nowrap" }}>
                    {isPositive ? "+" : "−"}{fmt(amount)}
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#94a3b8", fontSize: 12 }}>
                    {tx.balance_after != null ? `€${Number(tx.balance_after).toFixed(2)}` : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12, maxWidth: 240 }}>
                    {tx.notes || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: page <= 1 ? "#334155" : "#94a3b8", cursor: page <= 1 ? "default" : "pointer", fontSize: 12 }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: "#64748b" }}>Pagina {page} di {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: page >= totalPages ? "#334155" : "#94a3b8", cursor: page >= totalPages ? "default" : "pointer", fontSize: 12 }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
