"use client";

import { useEffect, useState, useCallback } from "react";

const STATUS_OPTIONS = [
  { key: "", label: "Tutti" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approvati" },
  { key: "paid", label: "Pagati" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  approved: "#3b82f6",
  paid: "#10b981",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "In Attesa",
  approved: "Approvato",
  paid: "Pagato",
};

function KPI({ label, value, color, subtitle }: { label: string; value: string; color?: string; subtitle?: string }) {
  return (
    <div style={{
      background: "var(--admin-card, #0f172a)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 12, padding: "16px 20px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#94a3b8", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || "#e2e8f0", fontFamily: "monospace" }}>
        {value}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "#94a3b8";
  const label = STATUS_LABELS[status] || status;
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      background: `${color}22`,
      color,
      border: `1px solid ${color}55`,
      textTransform: "uppercase",
      letterSpacing: "0.4px",
    }}>
      {label}
    </span>
  );
}

export default function SettlementsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/settlements?${params}`);
      const json = await res.json();
      setData(json);
    } catch { }
    finally { setLoading(false); }
  }, [status, page]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset page when status filter changes
  const handleStatusChange = (s: string) => {
    setStatus(s);
    setPage(1);
  };

  const handleAction = async (settlementId: string, action: "approve" | "pay") => {
    setProcessing(prev => ({ ...prev, [settlementId]: true }));
    try {
      const res = await fetch(`/api/admin/settlements/${settlementId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "Errore durante l'operazione");
        return;
      }
      await loadData();
    } catch {
      alert("Errore di rete");
    } finally {
      setProcessing(prev => ({ ...prev, [settlementId]: false }));
    }
  };

  const fmt = (n: number) => `€${(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
  const fmtPct = (n: number) => n != null ? `${n}%` : "—";

  const kpis = data?.kpis || {};
  const settlements: any[] = data?.settlements || [];
  const pagination = data?.pagination || { page: 1, pages: 1, total: 0 };
  const canApprove: boolean = data?.can_approve ?? false;
  const myAgentId: string | null = data?.my_agent_id ?? null;

  if (loading && !data) {
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento settlements...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Settlements Agenti
          </h2>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            Gestione commissioni — approvazione e pagamento
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          style={{
            padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: loading ? "default" : "pointer",
            border: "1px solid #1e3a5f", background: "transparent", color: loading ? "#64748b" : "#94a3b8",
          }}
        >
          {loading ? "..." : "Aggiorna"}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <KPI
          label="Da Approvare"
          value={fmt(kpis.pending || 0)}
          color="#f59e0b"
          subtitle="Commissioni in attesa"
        />
        <KPI
          label="Da Pagare"
          value={fmt(kpis.approved || 0)}
          color="#3b82f6"
          subtitle="Approvati, non ancora pagati"
        />
        <KPI
          label="Pagati"
          value={fmt(kpis.paid || 0)}
          color="#10b981"
          subtitle="Commissioni liquidate"
        />
      </div>

      {/* Filters */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid #1e3a5f",
        borderRadius: 12, padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Stato
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => handleStatusChange(opt.key)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: status === opt.key ? `1px solid ${STATUS_COLORS[opt.key] || "#f0b429"}` : "1px solid #1e3a5f",
                background: status === opt.key ? `${STATUS_COLORS[opt.key] || "#f0b429"}20` : "transparent",
                color: status === opt.key ? (STATUS_COLORS[opt.key] || "#f0b429") : "#94a3b8",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
          {pagination.total} settlement{pagination.total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid #1e3a5f",
        borderRadius: 12, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              {["Agente", "Periodo", "Turnover", "Vincite", "GGR", "Comm.%", "Commissione €", "Stato", "Azioni"].map(h => (
                <th key={h} style={{
                  padding: "10px 12px", textAlign: "left", fontSize: 10, fontWeight: 700,
                  color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px",
                  borderBottom: "1px solid #1e3a5f",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {settlements.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                  Nessun settlement trovato
                </td>
              </tr>
            ) : settlements.map((s: any) => {
              const agent = s.agents || {};
              const isProcessing = processing[s.id] || false;
              const isOwn = myAgentId !== null && s.agent_id === myAgentId;
              const showApprove = canApprove && !isOwn && s.status === "pending";
              const showPay = canApprove && !isOwn && s.status === "approved";

              return (
                <tr key={s.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {/* Agente */}
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{agent.name || "—"}</div>
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: "#f0b429", marginTop: 2 }}>
                      {agent.code || ""}{agent.level ? ` · Lv${agent.level}` : ""}
                    </div>
                  </td>

                  {/* Periodo */}
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#94a3b8", whiteSpace: "nowrap" }}>
                    {fmtDate(s.period_start)} → {fmtDate(s.period_end)}
                  </td>

                  {/* Turnover */}
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#60a5fa" }}>
                    {fmt(s.total_turnover)}
                  </td>

                  {/* Vincite */}
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#ef4444" }}>
                    {fmt(s.total_winnings)}
                  </td>

                  {/* GGR */}
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: (s.ggr || 0) >= 0 ? "#10b981" : "#ef4444" }}>
                    {fmt(s.ggr)}
                  </td>

                  {/* Comm.% */}
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#94a3b8" }}>
                    {fmtPct(s.commission_pct)}
                  </td>

                  {/* Commissione € */}
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "#f0b429" }}>
                    {fmt(s.commission_amount)}
                  </td>

                  {/* Stato */}
                  <td style={{ padding: "10px 12px" }}>
                    <StatusBadge status={s.status} />
                  </td>

                  {/* Azioni */}
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {showApprove && (
                        <button
                          disabled={isProcessing}
                          onClick={() => handleAction(s.id, "approve")}
                          style={{
                            padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                            cursor: isProcessing ? "default" : "pointer",
                            border: "1px solid #3b82f6",
                            background: "#3b82f620",
                            color: isProcessing ? "#64748b" : "#3b82f6",
                          }}
                        >
                          {isProcessing ? "..." : "Approva"}
                        </button>
                      )}
                      {showPay && (
                        <button
                          disabled={isProcessing}
                          onClick={() => handleAction(s.id, "pay")}
                          style={{
                            padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                            cursor: isProcessing ? "default" : "pointer",
                            border: "1px solid #10b981",
                            background: "#10b98120",
                            color: isProcessing ? "#64748b" : "#10b981",
                          }}
                        >
                          {isProcessing ? "..." : "Segna Pagato"}
                        </button>
                      )}
                      {!showApprove && !showPay && (
                        <span style={{ fontSize: 11, color: "#374151" }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: page <= 1 ? "default" : "pointer",
              border: "1px solid #1e3a5f", background: "transparent",
              color: page <= 1 ? "#374151" : "#94a3b8",
            }}
          >
            ← Prec
          </button>

          <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}>
            {page} / {pagination.pages}
          </span>

          <button
            disabled={page >= pagination.pages}
            onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: page >= pagination.pages ? "default" : "pointer",
              border: "1px solid #1e3a5f", background: "transparent",
              color: page >= pagination.pages ? "#374151" : "#94a3b8",
            }}
          >
            Succ →
          </button>
        </div>
      )}
    </div>
  );
}
