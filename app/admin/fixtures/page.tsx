"use client";

// E6 — force-dynamic required because FixturesDashboard uses useSearchParams via useAdminFilters.
export const dynamic = "force-dynamic";

import FixturesDashboard from "@/components/admin/fixtures/fixtures-dashboard";

export default function FixturesPage() {
  return <FixturesDashboard />;
}
