"use client";

import { Suspense, useState } from "react";
import CoverageDashboard from "@/components/admin/market-coverage/coverage-dashboard";
import IppicaCoverage from "@/components/admin/market-coverage/ippica-coverage";

const TABS = [
  { key: "kambi", label: "Kambi Sport" },
  { key: "ippica", label: "Ippica" },
];

export default function MarketCoveragePage() {
  const [activeTab, setActiveTab] = useState("kambi");

  return (
    <div>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              border: activeTab === tab.key ? "1px solid #f0b429" : "1px solid var(--admin-border, #1e3a5f)",
              background: activeTab === tab.key ? "#f0b42920" : "transparent",
              color: activeTab === tab.key ? "#f0b429" : "var(--admin-text-muted, #94a3b8)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              transition: "all 0.15s",
            }}
          >
            {tab.key === "ippica" ? "🏇 " : "⚽ "}{tab.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>}>
        {activeTab === "kambi" ? <CoverageDashboard /> : <IppicaCoverage />}
      </Suspense>
    </div>
  );
}
