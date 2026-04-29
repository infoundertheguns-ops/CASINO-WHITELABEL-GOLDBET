"use client";

// Plan D D.1 — KPI strip for /admin/settlement-coverage.
// 5 cards: 🟢 score | 🟡 stats | 🔴 player | 🚫 filtered | ✅ SLA.

type Kpi = {
  legs_total: number;
  pct_of_total: number;
  legs_pending: number;
  stake_total: number;
};

type Props = {
  kpis: Record<"score" | "stats" | "player", Kpi | undefined>;
  filterKpi: { markets_filtered: number; total_markets: number; pct: number };
  slaKpi: { settled_within_sla_pct: number };
  window: number;
};

const CATEGORY_CARDS: Array<{
  key: "score" | "stats" | "player";
  label: string;
  emoji: string;
  color: string;
}> = [
  { key: "score", label: "Score-only", emoji: "🟢", color: "border-green-500" },
  { key: "stats", label: "Stats", emoji: "🟡", color: "border-yellow-500" },
  { key: "player", label: "Player events", emoji: "🔴", color: "border-red-500" },
];

export function KpiStrip({ kpis, filterKpi, slaKpi, window }: Props) {
  const filterAlarm = filterKpi.pct >= 3.0;
  const slaAlarm = slaKpi.settled_within_sla_pct < 95;

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
      {CATEGORY_CARDS.map(({ key, label, emoji, color }) => {
        const k = kpis[key];
        const pct = k?.pct_of_total ?? 0;
        const pending = k?.legs_pending ?? 0;
        const stake = k?.stake_total ?? 0;
        return (
          <div
            key={key}
            className={`border-l-4 ${color} bg-card rounded p-3 shadow-sm`}
          >
            <div className="text-xs text-muted-foreground">
              {emoji} {label}
            </div>
            <div className="text-2xl font-semibold">{pct}%</div>
            <div className="text-xs text-muted-foreground">
              {k?.legs_total ?? 0} legs / €{stake.toFixed(0)}
            </div>
            {pending > 0 && (
              <div className="text-xs text-amber-600 mt-1">
                {pending} pending
              </div>
            )}
          </div>
        );
      })}

      {/* 🚫 Filter shrinkage card */}
      <div
        className={`border-l-4 ${
          filterAlarm ? "border-red-600" : "border-gray-400"
        } bg-card rounded p-3 shadow-sm`}
      >
        <div className="text-xs text-muted-foreground">🚫 filtered</div>
        <div
          className={`text-2xl font-semibold ${
            filterAlarm ? "text-red-700" : ""
          }`}
        >
          {filterKpi.pct}%
        </div>
        <div className="text-xs text-muted-foreground">
          {filterKpi.markets_filtered} / {filterKpi.total_markets} markets
        </div>
        {filterAlarm && (
          <div className="text-xs text-red-600 mt-1">≥3% alarm</div>
        )}
      </div>

      {/* ✅ SLA card */}
      <div
        className={`border-l-4 ${
          slaAlarm ? "border-amber-500" : "border-emerald-500"
        } bg-card rounded p-3 shadow-sm`}
      >
        <div className="text-xs text-muted-foreground">✅ SLA ({window}d)</div>
        <div
          className={`text-2xl font-semibold ${
            slaAlarm ? "text-amber-700" : "text-emerald-700"
          }`}
        >
          {slaKpi.settled_within_sla_pct}%
        </div>
        <div className="text-xs text-muted-foreground">
          settled within target
        </div>
        {slaAlarm && (
          <div className="text-xs text-amber-600 mt-1">below 95%</div>
        )}
      </div>
    </div>
  );
}
