"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopBar } from "@/components/layout/admin-topbar";
import { useAuth } from "@/lib/hooks/use-auth";
import { useAdminTheme } from "@/lib/hooks/use-admin-theme";
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
      { id: "risk", icon: "🛡️", label: "Risk & Trading", badge: 5 },
      { id: "liability", icon: "📊", label: "Liability" },
      { id: "odds-comparison", icon: "🔍", label: "Confronto Quote" },
    ],
  },
  {
    group: "SISTEMA",
    items: [
      { id: "scraper", icon: "🔄", label: "Scraper Monitor" },
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
  risk: "Risk & Trading Desk",
  liability: "Liability Management",
  "odds-comparison": "Confronto Quote",
  scraper: "Scraper Monitor",
  users: "Gestione Utenti",
  config: "Configurazione",
  audit: "Audit Log",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { initialize } = useAuth();
  const { theme, toggle } = useAdminTheme();
  const pathname = usePathname();
  const router = useRouter();

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
      liability: "/admin/risk",
      "odds-comparison": "/admin/odds-comparison",
      scraper: "/admin/scraper",
      users: "/admin/management",
      config: "/admin/config",
      audit: "/admin/audit",
    };
    router.push(`${routeMap[id] || "/admin/dashboard"}?tab=${id}`);
  };

  const notifCount = useMemo(() => {
    return NAVIGATION.flatMap((g) => g.items)
      .reduce((sum, item) => sum + (item.badge || 0), 0);
  }, []);

  const isLight = theme === "light";

  return (
    <div className={`admin-theme ${isLight ? "admin-light" : ""} flex min-h-screen font-sans`}
      style={{ background: "var(--admin-bg)", color: "var(--admin-text)" }}
    >
      <AdminSidebar
        navigation={NAVIGATION}
        activeId={activeId}
        onNavigate={handleNavigate}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopBar
          title={TITLES[activeId] || "Back Office"}
          notificationCount={notifCount}
          theme={theme}
          onToggleTheme={toggle}
        />

        <main className="flex-1 overflow-auto p-5">{children}</main>
      </div>
    </div>
  );
}
