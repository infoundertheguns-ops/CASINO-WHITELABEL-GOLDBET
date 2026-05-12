"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ─── Status config ───────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  open: "#3b82f6",
  won: "#10b981",
  lost: "#ef4444",
  void: "#6b7280",
  pending_acceptance: "#f59e0b",
  rejected: "#ef4444",
  cashout: "#8b5cf6",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Aperta",
  won: "Vinta",
  lost: "Persa",
  // Plan D: half-stake variants from Asian Handicap quarter / Goal Line .25/.75 markets
  half_won: "Mezza vinta",
  half_lost: "Mezza persa",
  void: "Void",
  pending_acceptance: "In attesa",
  rejected: "Rifiutata",
  cashout: "Cashout",
};

const PERIODS = [
  { key: "today", label: "Oggi" },
  { key: "7d", label: "7 Giorni" },
  { key: "30d", label: "30 Giorni" },
];

const STATUSES = [
  { key: "", label: "Tutti" },
  { key: "open", label: "Aperte" },
  { key: "won", label: "Vinte" },
  { key: "lost", label: "Perse" },
  { key: "void", label: "Void" },
  { key: "pending_acceptance", label: "In attesa" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function KPI({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: string;
  color?: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid #1e3a5f",
        borderRadius: 12,
        padding: "16px 20px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "#94a3b8",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 800,
          color: color || "#e2e8f0",
          fontFamily: "monospace",
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] || "#6b7280";
  const label = STATUS_LABEL[status] || status;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

function SelectionRow({ sel }: { sel: any }) {
  // Plan D: half-stake variants from Asian Handicap quarter / Goal Line .25/.75 markets
  const resultColor =
    sel.result === "won"
      ? "#10b981"
      : sel.result === "lost"
      ? "#ef4444"
      : sel.result === "half_won"
      ? "#f59e0b"
      : sel.result === "half_lost"
      ? "#f59e0b"
      : sel.result === "void"
      ? "#6b7280"
      : "#94a3b8";

  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <td style={{ padding: "6px 16px", color: "#e2e8f0", fontSize: 12 }}>
        {sel.event?.home && sel.event?.away
          ? `${sel.event.home} - ${sel.event.away}`
          : "—"}
      </td>
      <td
        style={{
          padding: "6px 12px",
          color: "#94a3b8",
          fontSize: 11,
          textTransform: "capitalize",
        }}
      >
        {sel.event?.sport_name || "—"}
      </td>
      <td style={{ padding: "6px 12px", color: "#94a3b8", fontSize: 11 }}>
        {sel.market?.market_name || "—"}
      </td>
      <td style={{ padding: "6px 12px", color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>
        {sel.outcome?.outcome_key || "—"}
      </td>
      <td
        style={{
          padding: "6px 12px",
          fontFamily: "monospace",
          color: "#60a5fa",
          fontSize: 12,
        }}
      >
        {sel.odds_at_placement?.toFixed(2) || "—"}
      </td>
      <td style={{ padding: "6px 12px", fontSize: 11, color: resultColor, fontWeight: 600 }}>
        {sel.result ? STATUS_LABEL[sel.result] || sel.result : "—"}
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AgentBetsPage() {
  const [bets, setBets] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("today");
  const [sportFilter, setSportFilter] = useState("");
  // {slug, label} pairs: dropdown shows sport_name labels but filter sends sport_slug
  // (API agent/bets route filters events_v2.sport_slug, which is the English slug)
  const [sports, setSports] = useState<{ slug: string; label: string }[]>([]);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const LIMIT = 50;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (periodFilter) params.set("period", periodFilter);
      if (sportFilter) params.set("sport", sportFilter);
      params.set("page", String(page));
      params.set("limit", String(LIMIT));

      const res = await fetch(`/api/agent/bets?${params.toString()}`);
      if (!res.ok) {
        setBets([]);
        return;
      }
      const data = await res.json();
      setBets(data.bets || []);
      setKpis(data.kpis || null);
      const total = data.pagination?.total || 0;
      setTotalPages(Math.max(1, Math.ceil(total / LIMIT)));

      // Derive sports list from current bets for filter dropdown.
      // events_v2 has flat sport_slug (English, filter key) + sport_name (display label).
      const sportMap = new Map<string, string>(); // slug → label
      for (const bet of data.bets || []) {
        for (const sel of bet.selections || []) {
          if (sel.event?.sport_slug) {
            sportMap.set(sel.event.sport_slug, sel.event.sport_name || sel.event.sport_slug);
          }
        }
      }
      if (sportMap.size > 0) {
        setSports((prev) => {
          const merged = new Map(prev.map((p) => [p.slug, p.label]));
          sportMap.forEach((label, slug) => merged.set(slug, label));
          return Array.from(merged, ([slug, label]) => ({ slug, label }));
        });
      }
    } catch {
      setBets([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, periodFilter, sportFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, periodFilter, sportFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const fmt = (n: number) =>
    `€${(n || 0).toLocaleString("it-IT", { minimumFractionDigits: 2 })}`;

  const fmtDate = (s: string) =>
    new Date(s).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
          Scommesse Giocatori
        </h2>
        <button
          onClick={loadData}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            border: "1px solid #1e3a5f",
            background: "transparent",
            color: "#94a3b8",
          }}
        >
          ↻ Aggiorna
        </button>
      </div>

      {/* KPI cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <KPI
          label="Scommesse"
          value={String(kpis?.total_bets ?? "—")}
          color="#60a5fa"
        />
        <KPI
          label="Turnover"
          value={kpis ? fmt(kpis.turnover) : "—"}
          color="#60a5fa"
        />
        <KPI
          label="Vincite"
          value={kpis ? fmt(kpis.winnings) : "—"}
          color="#ef4444"
        />
        <KPI
          label="Margine"
          value={kpis ? `${kpis.margin_pct?.toFixed(1)}%` : "—"}
          color={
            kpis
              ? (kpis.margin_pct || 0) >= 0
                ? "#10b981"
                : "#ef4444"
              : "#94a3b8"
          }
          subtitle="GGR / Turnover"
        />
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {/* Status */}
        <div style={{ display: "flex", gap: 4 }}>
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                border:
                  statusFilter === s.key
                    ? "1px solid #f0b429"
                    : "1px solid #1e3a5f",
                background:
                  statusFilter === s.key ? "#f0b42920" : "transparent",
                color: statusFilter === s.key ? "#f0b429" : "#94a3b8",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Period */}
        <div style={{ display: "flex", gap: 4 }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriodFilter(p.key)}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                border:
                  periodFilter === p.key
                    ? "1px solid #3b82f6"
                    : "1px solid #1e3a5f",
                background:
                  periodFilter === p.key ? "#3b82f620" : "transparent",
                color: periodFilter === p.key ? "#60a5fa" : "#94a3b8",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Sport dropdown */}
        {sports.length > 0 && (
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              border: "1px solid #1e3a5f",
              background: "var(--admin-card, #0f172a)",
              color: sportFilter ? "#e2e8f0" : "#94a3b8",
            }}
          >
            <option value="">Tutti i sport</option>
            {sports.map((sp) => (
              <option key={sp.slug} value={sp.slug} style={{ textTransform: "capitalize" }}>
                {sp.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div
        style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid #1e3a5f",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
              {[
                "Data",
                "Giocatore",
                "Tipo",
                "Stake",
                "Quota",
                "Vincita pot.",
                "Stato",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}
                >
                  Caricamento...
                </td>
              </tr>
            ) : bets.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{ padding: 40, textAlign: "center", color: "#64748b" }}
                >
                  Nessuna scommessa trovata
                </td>
              </tr>
            ) : (
              bets.map((bet: any) => {
                const isExpanded = expandedId === bet.id;
                return (
                  <>
                    <tr
                      key={bet.id}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : bet.id)
                      }
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        cursor: "pointer",
                        background: isExpanded
                          ? "rgba(59,130,246,0.06)"
                          : undefined,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded)
                          (e.currentTarget as HTMLTableRowElement).style.background =
                            "rgba(255,255,255,0.02)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded)
                          (e.currentTarget as HTMLTableRowElement).style.background =
                            "";
                      }}
                    >
                      {/* Data */}
                      <td
                        style={{
                          padding: "10px 12px",
                          fontFamily: "monospace",
                          color: "#94a3b8",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtDate(bet.created_at)}
                      </td>
                      {/* Giocatore */}
                      <td
                        style={{
                          padding: "10px 12px",
                          color: "#e2e8f0",
                          fontWeight: 600,
                        }}
                      >
                        <Link
                          href={`/admin/bets/${bet.id}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "#60a5fa", textDecoration: "none" }}
                        >
                          {bet.users?.username || bet.user_id?.slice(0, 8) || "—"}
                        </Link>
                      </td>
                      {/* Tipo */}
                      <td
                        style={{
                          padding: "10px 12px",
                          color: "#94a3b8",
                          textTransform: "capitalize",
                        }}
                      >
                        {bet.bet_type === "singola"
                          ? "Singola"
                          : bet.bet_type === "multipla"
                          ? `Multipla (${bet.selections_count})`
                          : bet.bet_type || "—"}
                      </td>
                      {/* Stake */}
                      <td
                        style={{
                          padding: "10px 12px",
                          fontFamily: "monospace",
                          color: "#60a5fa",
                          fontWeight: 700,
                        }}
                      >
                        {fmt(bet.stake)}
                      </td>
                      {/* Quota */}
                      <td
                        style={{
                          padding: "10px 12px",
                          fontFamily: "monospace",
                          color: "#e2e8f0",
                        }}
                      >
                        {bet.total_odds?.toFixed(2) || "—"}
                      </td>
                      {/* Vincita pot. */}
                      <td
                        style={{
                          padding: "10px 12px",
                          fontFamily: "monospace",
                          color:
                            bet.status === "won"
                              ? "#10b981"
                              : "#94a3b8",
                        }}
                      >
                        {bet.status === "won"
                          ? fmt(bet.actual_win)
                          : fmt(bet.potential_win)}
                      </td>
                      {/* Stato */}
                      <td style={{ padding: "10px 12px" }}>
                        <StatusBadge status={bet.status} />
                      </td>
                    </tr>

                    {/* Expanded selections row */}
                    {isExpanded && (
                      <tr key={`${bet.id}-detail`}>
                        <td
                          colSpan={7}
                          style={{
                            padding: 0,
                            background: "rgba(15,23,42,0.8)",
                            borderBottom: "1px solid rgba(59,130,246,0.2)",
                          }}
                        >
                          <div style={{ padding: "4px 0" }}>
                            <table
                              style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: 12,
                              }}
                            >
                              <thead>
                                <tr
                                  style={{
                                    background: "rgba(255,255,255,0.02)",
                                  }}
                                >
                                  {[
                                    "Evento",
                                    "Sport",
                                    "Mercato",
                                    "Esito",
                                    "Quota",
                                    "Risultato",
                                  ].map((h) => (
                                    <th
                                      key={h}
                                      style={{
                                        padding: "6px 12px 6px 16px",
                                        textAlign: "left",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        color: "#4b6a8a",
                                        textTransform: "uppercase",
                                      }}
                                    >
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(bet.selections || []).length === 0 ? (
                                  <tr>
                                    <td
                                      colSpan={6}
                                      style={{
                                        padding: "12px 16px",
                                        color: "#64748b",
                                        fontSize: 12,
                                      }}
                                    >
                                      Nessuna selezione disponibile
                                    </td>
                                  </tr>
                                ) : (
                                  (bet.selections || []).map((sel: any) => (
                                    <SelectionRow key={sel.id} sel={sel} />
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: page === 1 ? "default" : "pointer",
              border: "1px solid #1e3a5f",
              background: "transparent",
              color: page === 1 ? "#374151" : "#94a3b8",
            }}
          >
            ← Prec
          </button>
          <span
            style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}
          >
            {page} / {totalPages}
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: page === totalPages ? "default" : "pointer",
              border: "1px solid #1e3a5f",
              background: "transparent",
              color: page === totalPages ? "#374151" : "#94a3b8",
            }}
          >
            Succ →
          </button>
        </div>
      )}
    </div>
  );
}
