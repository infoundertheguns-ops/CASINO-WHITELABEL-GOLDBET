"use client";

import { useEffect, useState, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopBar } from "@/components/layout/admin-topbar";
import { useAuth } from "@/lib/hooks/use-auth";
import type { AdminNavGroup } from "@/lib/types";

// ═══ NAVIGATION STRUCTURE — Betting Only ═══
const NAVIGATION: AdminNavGroup[] = [
  {
    group: "OVERVIEW",
    items: [{ id: "dashboard", icon: "📊", label: "Dashboard" }],
  },
  {
    group: "SPORTSBOOK",
    items: [
      { id: "bets", icon: "🎯", label: "Scommesse", badge: 4 },
      { id: "settlement", icon: "⚖️", label: "Settlement", badge: 2 },
      { id: "risk", icon: "🛡️", label: "Risk & AI Agent", badge: 5 },
    ],
  },
  {
    group: "GESTIONE",
    items: [
      { id: "users", icon: "👥", label: "Utenti" },
      { id: "config", icon: "⚙️", label: "Configurazione" },
      { id: "audit", icon: "📋", label: "Audit Log" },
    ],
  },
];

const TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  bets: "Scommesse",
  settlement: "Settlement",
  risk: "Risk Management & AI Agent",
  users: "Gestione Utenti",
  config: "Configurazione",
  audit: "Audit Log",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { initialize, isLoading, isAdmin } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Derive active module from URL
  const activeId = useMemo(() => {
    const segment = pathname.split("/").pop() || "dashboard";
    return segment;
  }, [pathname]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleNavigate = (id: string) => {
    const routeMap: Record<string, string> = {
      dashboard: "/admin/dashboard",
      bets: "/admin/sportsbook",
      settlement: "/admin/sportsbook",
      risk: "/admin/risk",
      users: "/admin/management",
      config: "/admin/config",
      audit: "/admin/audit",
    };
    router.push(`${routeMap[id] || "/admin/dashboard"}?tab=${id}`);
  };

  // Total notification count
  const notifCount = useMemo(() => {
    return NAVIGATION.flatMap((g) => g.items)
      .reduce((sum, item) => sum + (item.badge || 0), 0);
  }, []);

  return (
    <div className="admin-theme flex min-h-screen bg-admin-bg text-txt font-sans">
      <AdminSidebar
        navigation={NAVIGATION}
        activeId={activeId}
        onNavigate={handleNavigate}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopBar
          title={TITLES[activeId] || "Back Office"}
          notificationCount={notifCount}
        />

        <main className="flex-1 overflow-auto p-5">{children}</main>
      </div>
    </div>
  );
}
