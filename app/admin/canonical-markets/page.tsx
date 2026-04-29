"use client";

// E10 — filter+sort+page query persisted in URL for deep-linkable sharing.
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CanonicalMarketDetailModal } from "@/components/admin/canonical/canonical-market-detail-modal";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";
import {
  Kpi, KpiRow,
  AdminTable, AdminThead, AdminTh, AdminTd, AdminTr, AdminEmptyRow,
  Pagination,
} from "@/components/admin/ui";

interface Outcome { key: string; name_it: string; }
interface CanonicalMarket {
  canonical_key: string;
  base_key: string;
  period: string;
  canonical_name_it: string;
  has_line: boolean;
  outcomes: Outcome[];
  notes: string | null;
  mapped_count: number;
  outcome_count: number;
  created_at?: string;
  updated_at?: string;
}

type SortKey = "canonical_key" | "base_key" | "period" | "canonical_name_it" | "mapped_count" | "outcome_count" | "updated_at";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 50;

export default function CanonicalMarketsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "var(--admin-text-muted)" }}>Caricamento…</div>}>
      <CanonicalMarketsInner />
    </Suspense>
  );
}

function CanonicalMarketsInner() {
  const { filters, updateFilter } = useAdminFilters({
    q: "",
    sort: "base_key" as SortKey,
    dir: "asc" as SortDir,
    page: 1,
  });
  const filter = filters.q as string;
  const sortKey = filters.sort as SortKey;
  const sortDir = filters.dir as SortDir;
  const page = Number(filters.page) || 1;

  const setFilter = (v: string) => { updateFilter("q", v); updateFilter("page", 1); };
  const setSort = (k: SortKey) => {
    if (k === sortKey) updateFilter("dir", sortDir === "asc" ? "desc" : "asc");
    else { updateFilter("sort", k); updateFilter("dir", "asc"); }
    updateFilter("page", 1);
  };
  const setPage = (p: number) => updateFilter("page", p);

  const [rows, setRows] = useState<CanonicalMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<{ key: string | null; mode: "view" | "create" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/canonical-markets`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setRows(r.rows ?? []);
      setError("");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter (client-side over the indice — small dataset, ~450 canonicals).
  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    if (!f) return rows;
    return rows.filter((r) =>
      r.canonical_key.toLowerCase().includes(f) ||
      r.base_key.toLowerCase().includes(f) ||
      r.canonical_name_it.toLowerCase().includes(f) ||
      (r.notes ?? "").toLowerCase().includes(f)
    );
  }, [rows, filter]);

  // Sort.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // Pagination.
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage]
  );

  // KPIs (computed over full dataset, not filtered/paged).
  // Orphans now consider BOTH market and outcome refs — a canonical with
  // 0 markets but 100 outcomes is NOT orphan. (review #1bis bug A)
  const kpis = useMemo(() => {
    const total = rows.length;
    const withLine = rows.filter((r) => r.has_line).length;
    const orphans = rows.filter((r) => (r.mapped_count ?? 0) === 0 && (r.outcome_count ?? 0) === 0).length;
    const periodCounts: Record<string, number> = {};
    for (const r of rows) periodCounts[r.period] = (periodCounts[r.period] ?? 0) + 1;
    const topPeriods = Object.entries(periodCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return { total, withLine, orphans, withLinePct: total > 0 ? Math.round((withLine / total) * 100) : 0, topPeriods };
  }, [rows]);

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI row */}
      <KpiRow>
        <Kpi label="Totale canonicali" value={kpis.total} />
        <Kpi label="Con linea" value={`${kpis.withLine} (${kpis.withLinePct}%)`} accent="#3b82f6" />
        <Kpi label="Orphans" value={kpis.orphans} sub="0 markets · 0 outcomes" accent={kpis.orphans > 0 ? "#eab308" : "#64748b"} />
        <Kpi
          label="Per period"
          value={kpis.topPeriods.length === 0 ? "—" : kpis.topPeriods.map(([p, n]) => `${p}:${n}`).join(" · ")}
          accent="#8b5cf6"
          small
        />
      </KpiRow>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            placeholder="Filtra canonical_key / base_key / nome / notes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", paddingRight: filter ? 32 : 12, border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)" }}
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              aria-label="Cancella filtro"
              title="Cancella filtro"
              style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: "var(--admin-text-muted)", cursor: "pointer", padding: "4px 8px", fontSize: 12 }}
            >✕</button>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Ricarica lista"
          title="Ricarica lista"
          style={{ padding: "8px 12px", borderRadius: 6, background: "transparent", color: "var(--admin-text-muted)", border: "1px solid var(--admin-border)", fontWeight: 600, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.5 : 1 }}
        >
          {loading ? "…" : "↻ Refresh"}
        </button>
        <button
          onClick={() => setModal({ key: null, mode: "create" })}
          style={{ padding: "8px 16px", borderRadius: 6, background: "#10b981", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer" }}
        >
          + Nuovo canonical
        </button>
      </div>

      {error && <div style={{ padding: 12, background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5" }}>{error}</div>}

      {/* Table — sortable headers, drill-link on mapped count */}
      <AdminTable>
        <AdminThead>
          <SortableTh col="canonical_key" current={sortKey} dir={sortDir} onSort={setSort}>canonical_key</SortableTh>
          <SortableTh col="base_key" current={sortKey} dir={sortDir} onSort={setSort}>base_key</SortableTh>
          <SortableTh col="period" current={sortKey} dir={sortDir} onSort={setSort}>period</SortableTh>
          <SortableTh col="canonical_name_it" current={sortKey} dir={sortDir} onSort={setSort}>name_it</SortableTh>
          <AdminTh>line?</AdminTh>
          <AdminTh>outcomes</AdminTh>
          <AdminTh>notes</AdminTh>
          <SortableTh col="updated_at" current={sortKey} dir={sortDir} onSort={setSort}>aggiornato</SortableTh>
          <SortableTh col="mapped_count" current={sortKey} dir={sortDir} onSort={setSort} align="right">markets</SortableTh>
          <SortableTh col="outcome_count" current={sortKey} dir={sortDir} onSort={setSort} align="right">outcomes ref</SortableTh>
        </AdminThead>
        <tbody>
          {pageRows.map((r) => (
            <AdminTr key={r.canonical_key} onClick={() => setModal({ key: r.canonical_key, mode: "view" })}>
              <AdminTd><code style={{ color: "#8b5cf6" }}>{r.canonical_key}</code></AdminTd>
              <AdminTd style={{ fontFamily: "monospace", fontSize: 11 }}>{r.base_key}</AdminTd>
              <AdminTd>{r.period}</AdminTd>
              <AdminTd>{r.canonical_name_it}</AdminTd>
              <AdminTd>{r.has_line ? "yes" : "—"}</AdminTd>
              <AdminTd style={{ fontFamily: "monospace", fontSize: 10, color: "var(--admin-text-muted)", maxWidth: 180 }}>
                <OutcomesCell outcomes={r.outcomes} />
              </AdminTd>
              <AdminTd style={{ fontSize: 11, color: "var(--admin-text-muted)", maxWidth: 220 }}>
                <span title={r.notes ?? ""} style={{ display: "inline-block", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>
                  {truncate(r.notes ?? "", 40)}
                </span>
              </AdminTd>
              <AdminTd style={{ fontSize: 11, color: "var(--admin-text-muted)", whiteSpace: "nowrap" }}>
                {r.updated_at ? relativeDate(r.updated_at) : "—"}
              </AdminTd>
              <AdminTd align="right" style={{ fontVariantNumeric: "tabular-nums" }}>
                {(r.mapped_count ?? 0) === 0 ? (
                  <span style={{ color: "var(--admin-text-muted)" }}>0</span>
                ) : (
                  <a
                    href={`/admin/market-normalization?canonical=${encodeURIComponent(r.canonical_key)}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Apri Market Normalization filtrato su questo canonical"
                    style={{ color: "#8b5cf6", fontWeight: 700, textDecoration: "none" }}
                  >
                    {r.mapped_count} ↗
                  </a>
                )}
              </AdminTd>
              <AdminTd align="right" style={{ fontVariantNumeric: "tabular-nums" }}>
                {(r.outcome_count ?? 0) === 0 ? (
                  <span style={{ color: "var(--admin-text-muted)" }}>0</span>
                ) : (
                  <a
                    href={`/admin/outcome-normalization?canonical=${encodeURIComponent(r.canonical_key)}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Apri Outcome Normalization filtrato su questo canonical"
                    style={{ color: "#3b82f6", fontWeight: 700, textDecoration: "none" }}
                  >
                    {r.outcome_count} ↗
                  </a>
                )}
              </AdminTd>
            </AdminTr>
          ))}
          {!loading && pageRows.length === 0 && <AdminEmptyRow colSpan={10}>Nessun canonical.</AdminEmptyRow>}
        </tbody>
      </AdminTable>

      {/* Pagination */}
      {sorted.length > PAGE_SIZE && (
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onPage={setPage}
          totalRows={sorted.length}
        />
      )}

      {/* Modal */}
      {modal && (
        <CanonicalMarketDetailModal
          canonicalKey={modal.key}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function OutcomesCell({ outcomes }: { outcomes: Outcome[] }) {
  if (!outcomes || outcomes.length === 0) return <span>—</span>;
  const full = outcomes.map((o) => o.key).join(", ");
  if (outcomes.length <= 4) return <span title={full}>{full}</span>;
  // 5+ outcomes: show first 3 + count badge with full list in tooltip.
  const head = outcomes.slice(0, 3).map((o) => o.key).join(", ");
  return (
    <span title={full}>
      {head}, <span style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", padding: "1px 6px", borderRadius: 8, fontSize: 9, fontWeight: 700 }}>+{outcomes.length - 3}</span>
    </span>
  );
}

function SortableTh({
  col, current, dir, onSort, align, children,
}: {
  col: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right" | "center";
  children: React.ReactNode;
}) {
  const active = current === col;
  return (
    <AdminTh align={align}>
      <button
        onClick={() => onSort(col)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: active ? "var(--admin-text)" : "var(--admin-text-muted)",
          fontSize: "inherit",
          fontWeight: active ? 700 : "inherit",
          fontFamily: "inherit",
          textTransform: "inherit",
          letterSpacing: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        aria-label={`Ordina per ${col} (${active ? (dir === "asc" ? "asc" : "desc") : "asc"})`}
      >
        {children}
        <span style={{ fontSize: 9, opacity: active ? 1 : 0.3 }}>
          {active ? (dir === "asc" ? "▲" : "▼") : "▲▼"}
        </span>
      </button>
    </AdminTh>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function relativeDate(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  const m = 60 * 1000, h = 60 * m, d = 24 * h;
  if (diff < m) return "ora";
  if (diff < h) return `${Math.floor(diff / m)}m fa`;
  if (diff < d) return `${Math.floor(diff / h)}h fa`;
  if (diff < 30 * d) return `${Math.floor(diff / d)}g fa`;
  return new Date(iso).toLocaleDateString("it-IT");
}
