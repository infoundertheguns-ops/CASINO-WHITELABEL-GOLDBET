"use client";

import { Suspense } from "react";
import CoverageDashboard from "@/components/admin/market-coverage/coverage-dashboard";

export default function MarketCoveragePage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>}>
      <CoverageDashboard />
    </Suspense>
  );
}
