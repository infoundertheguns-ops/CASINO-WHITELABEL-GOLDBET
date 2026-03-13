"use client";

import { Suspense } from "react";
import LeonCoverageDashboard from "@/components/admin/market-coverage/leon-coverage-dashboard";

export default function MarketCoveragePage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>}>
      <LeonCoverageDashboard />
    </Suspense>
  );
}
