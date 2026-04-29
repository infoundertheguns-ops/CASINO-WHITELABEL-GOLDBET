"use client";

// E10 — tab persisted in URL for deep-linkable sharing.
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import CoverageDashboard from "@/components/admin/market-coverage/coverage-dashboard";
import IppicaCoverage from "@/components/admin/market-coverage/ippica-coverage";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";

const TABS = [
  { key: "odds-api", label: "Odds API Sport", icon: "⚽", color: "#f0b429" },
  { key: "flashscore", label: "Flashscore Sport", icon: "📊", color: "#22c55e" },
  { key: "ippica", label: "Ippica", icon: "🏇", color: "#f0b429" },
];

export default function MarketCoveragePage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento…</div>}>
      <MarketCoverageInner />
    </Suspense>
  );
}

function MarketCoverageInner() {
  const { filters, updateFilter } = useAdminFilters({ tab: "odds-api" });
  const activeTab = filters.tab;
  const setActiveTab = (v: string) => updateFilter("tab", v);

  const activeColor = TABS.find(t => t.key === activeTab)?.color || "#f0b429";

  return (
    <div>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: active ? `1px solid ${tab.color}` : "1px solid var(--admin-border, #1e3a5f)",
                background: active ? `${tab.color}20` : "transparent",
                color: active ? tab.color : "var(--admin-text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 700,
                transition: "all 0.15s",
              }}
            >
              {tab.icon} {tab.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>}>
        {activeTab === "ippica" ? (
          <IppicaCoverage />
        ) : (
          <CoverageDashboard key={activeTab} source={activeTab} />
        )}
      </Suspense>
    </div>
  );
}
