// Plan D D.1 — Settlement Coverage list endpoint.
// Combines top-strip KPIs + per-market_type catalog table from RPCs in mig 152.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type KpiRow = {
  category: string;
  legs_total: number | string;
  legs_won: number | string;
  legs_lost: number | string;
  legs_void: number | string;
  legs_pending: number | string;
  stake_total: number | string;
};

type MarketRow = {
  market_type: string;
  category: string;
  sport: string;
  bet_count: number | string;
  auto_settled: number | string;
  manual_settled: number | string;
  void_settled: number | string;
  pending: number | string;
  last_seen_at: string;
};

type FilterKpiRow = {
  markets_filtered: number | string;
  total_markets: number | string;
  pct: number | string;
  reason: string;
};

type SlaKpiRow = {
  category: string;
  legs_settled: number | string;
  legs_within_sla: number | string;
  settled_within_sla_pct: number | string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const window = Math.max(
    1,
    Math.min(90, parseInt(url.searchParams.get("window") ?? "7", 10))
  );

  const supa = createAdminClient();

  const [kpiRes, listRes, filterRes, slaRes] = await Promise.all([
    supa.rpc("settlement_coverage_kpis", { window_days: window }),
    supa.rpc("settlement_coverage_list", { window_days: window }),
    supa.rpc("settlement_coverage_filter_kpi", { window_days: window }),
    supa.rpc("settlement_coverage_sla_kpi", { window_days: window }),
  ]);

  if (kpiRes.error || listRes.error || filterRes.error || slaRes.error) {
    return NextResponse.json(
      {
        error:
          kpiRes.error?.message ??
          listRes.error?.message ??
          filterRes.error?.message ??
          slaRes.error?.message,
      },
      { status: 500 }
    );
  }

  // Build KPIs map by category, computing pct_of_total for the strip.
  const kpiRows = (kpiRes.data ?? []) as KpiRow[];
  const total = kpiRows.reduce((acc, r) => acc + Number(r.legs_total), 0);
  const kpis: Record<
    string,
    {
      legs_total: number;
      legs_won: number;
      legs_lost: number;
      legs_void: number;
      legs_pending: number;
      stake_total: number;
      pct_of_total: number;
    }
  > = {};
  for (const r of kpiRows) {
    kpis[r.category] = {
      legs_total: Number(r.legs_total),
      legs_won: Number(r.legs_won),
      legs_lost: Number(r.legs_lost),
      legs_void: Number(r.legs_void),
      legs_pending: Number(r.legs_pending),
      stake_total: Number(r.stake_total),
      pct_of_total:
        total === 0
          ? 0
          : Math.round((Number(r.legs_total) / total) * 1000) / 10,
    };
  }

  // Filter KPI: aggregate filtered+total across all reason rows for the strip.
  // Body in mig 152 is a STUB returning a single row 'mig-154-pending';
  // mig 154 replaces with multi-row breakdown by reason.
  const filterRows = (filterRes.data ?? []) as FilterKpiRow[];
  const filterAgg = filterRows.reduce(
    (acc, r) => {
      acc.markets_filtered += Number(r.markets_filtered);
      acc.total_markets = Math.max(acc.total_markets, Number(r.total_markets));
      return acc;
    },
    { markets_filtered: 0, total_markets: 0 }
  );
  const filterKpi = {
    markets_filtered: filterAgg.markets_filtered,
    total_markets: filterAgg.total_markets,
    pct:
      filterAgg.total_markets === 0
        ? 0
        : Math.round(
            (filterAgg.markets_filtered / filterAgg.total_markets) * 10000
          ) / 100,
    by_reason: filterRows.map((r) => ({
      reason: r.reason,
      markets_filtered: Number(r.markets_filtered),
      pct: Number(r.pct),
    })),
  };

  // SLA KPI: average settled-within-sla pct across categories (weighted by legs).
  const slaRows = (slaRes.data ?? []) as SlaKpiRow[];
  const slaTotalLegs = slaRows.reduce(
    (acc, r) => acc + Number(r.legs_settled),
    0
  );
  const slaWithinLegs = slaRows.reduce(
    (acc, r) => acc + Number(r.legs_within_sla),
    0
  );
  const slaKpi = {
    settled_within_sla_pct:
      slaTotalLegs === 0
        ? 0
        : Math.round((slaWithinLegs / slaTotalLegs) * 10000) / 100,
    by_category: slaRows.map((r) => ({
      category: r.category,
      legs_settled: Number(r.legs_settled),
      legs_within_sla: Number(r.legs_within_sla),
      settled_within_sla_pct: Number(r.settled_within_sla_pct),
    })),
  };

  return NextResponse.json({
    window_days: window,
    kpis,
    filter_kpi: filterKpi,
    sla_kpi: slaKpi,
    markets: (listRes.data ?? []) as MarketRow[],
    generated_at: new Date().toISOString(),
  });
}
