"use client";

import { Suspense } from "react";
import SportDetailDashboard from "@/components/admin/market-coverage/sport-detail-dashboard";

export default function SportCoveragePage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>}>
      <SportDetailDashboard />
    </Suspense>
  );
}
