// app/admin/bets/page.tsx
"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { BetsKpiCards } from "@/components/admin/bets/BetsKpiCards";
import { BetsFilters } from "@/components/admin/bets/BetsFilters";
import { BetsTable } from "@/components/admin/bets/BetsTable";
import type { BetsListResponse, BetsListFilters } from "@/lib/types/bets-admin";

const POLL_MS = 30_000;

export default function AdminBetsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--admin-text4)" }}>Caricamento…</div>}>
      <AdminBetsPageInner />
    </Suspense>
  );
}

function AdminBetsPageInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<BetsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const filters: BetsListFilters = {
    status: (sp.get("status") as any) || "all",
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    min_stake: sp.get("min_stake") ? Number(sp.get("min_stake")) : undefined,
    max_stake: sp.get("max_stake") ? Number(sp.get("max_stake")) : undefined,
    is_live: sp.get("is_live") === "true",
    risk_min: sp.get("risk_min") ? Number(sp.get("risk_min")) : undefined,
    risk_max: sp.get("risk_max") ? Number(sp.get("risk_max")) : undefined,
    search: sp.get("search") || undefined,
    limit: 50,
    offset: sp.get("offset") ? Number(sp.get("offset")) : 0,
  };

  const fetchBets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(sp);
      const res = await fetch(`/api/admin/bets?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Errore caricamento");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sp]);

  useEffect(() => {
    fetchBets();
  }, [fetchBets]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchBets, POLL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, fetchBets]);

  const exportUrl = `/api/admin/bets/export?${sp.toString()}`;
  const totalPages = data ? Math.ceil(data.total / 50) : 0;
  const currentPage = Math.floor((filters.offset ?? 0) / 50) + 1;

  const goPage = (p: number) => {
    const params = new URLSearchParams(sp);
    params.set("offset", String((p - 1) * 50));
    router.push(`?${params.toString()}`);
  };

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--admin-text)" }}>SCOMMESSE</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 11, color: "var(--admin-text4)", display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh 30s
          </label>
          <a href={exportUrl} download style={{ padding: "6px 12px", background: "#10b981", color: "#fff", borderRadius: 4, fontSize: 12, textDecoration: "none" }}>
            📥 Esporta CSV
          </a>
        </div>
      </div>

      {data && <BetsKpiCards agg={data.aggregates} total={data.total} />}

      <BetsFilters initial={filters} />

      {error && <div style={{ padding: 12, background: "#7f1d1d30", color: "#ef4444", borderRadius: 4 }}>{error}</div>}
      {loading && !data && <div style={{ padding: 40, textAlign: "center", color: "var(--admin-text4)" }}>Caricamento…</div>}
      {data && <BetsTable bets={data.bets} />}

      {data && totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "center", fontSize: 12, color: "var(--admin-text)" }}>
          <button disabled={currentPage <= 1} onClick={() => goPage(currentPage - 1)}
            style={{ padding: "4px 10px", background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 4 }}>◀</button>
          <span>Pagina {currentPage} di {totalPages}</span>
          <button disabled={currentPage >= totalPages} onClick={() => goPage(currentPage + 1)}
            style={{ padding: "4px 10px", background: "var(--admin-surface)", border: "1px solid var(--admin-border)", borderRadius: 4 }}>▶</button>
        </div>
      )}
    </div>
  );
}
