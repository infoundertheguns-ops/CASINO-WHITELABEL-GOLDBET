"use client";

import { useEffect, useState } from "react";
import { KpiStrip } from "./components/kpi-strip";
import { CatalogTable } from "./components/catalog-table";
import { DrillDownModal } from "./components/drill-down-modal";

// Plan D D.1 — /admin/settlement-coverage page.
// Top-level client component: fetches /api/admin/settlement-coverage/list,
// renders KPI strip + catalog table + drill-down modal on row click.

type ListResponse = {
  window_days: number;
  kpis: Record<
    string,
    {
      legs_total: number;
      pct_of_total: number;
      legs_pending: number;
      stake_total: number;
    }
  >;
  filter_kpi: { markets_filtered: number; total_markets: number; pct: number };
  sla_kpi: { settled_within_sla_pct: number };
  markets: any[];
  generated_at: string;
};

export default function SettlementCoveragePage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(7);
  const [drillDown, setDrillDown] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/settlement-coverage/list?window=${windowDays}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(j.error);
        else setData(j);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [windowDays]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">📊 Settlement Coverage</h1>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Window:</label>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
            className="border rounded px-2 py-1"
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          {data?.generated_at && (
            <span className="text-xs text-muted-foreground">
              · gen {new Date(data.generated_at).toISOString().slice(11, 19)}Z
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-center text-muted-foreground py-8">Loading…</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3">
          Error: {error}
        </div>
      )}

      {data && !loading && !error && (
        <>
          <KpiStrip
            kpis={data.kpis as any}
            filterKpi={data.filter_kpi}
            slaKpi={data.sla_kpi}
            window={windowDays}
          />
          <CatalogTable
            markets={data.markets}
            onRowClick={(row) => setDrillDown(row.market_type)}
          />
        </>
      )}

      <DrillDownModal
        marketType={drillDown}
        onClose={() => setDrillDown(null)}
      />

      <div className="text-xs text-muted-foreground pt-4 border-t">
        Filter KPI 🚫 stub returns <code>mig-154-pending</code> until mig 154
        ships (Phase 1.5). Click any row in the catalog to drill down to last
        20 bets + last 20 events.
      </div>
    </div>
  );
}
