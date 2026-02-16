"use client";

import { useEffect, useState, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopBar } from "@/components/layout/admin-topbar";
import { useAuth } from "@/lib/hooks/use-auth";
import type { AdminNavGroup } from "@/lib/types";

// ═══ NAVIGATION STRUCTURE ═══
// Badges will be filled by real-time data in production
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
    group: "CASINO",
    items: [
      { id: "casino", icon: "🎰", label: "Provider & Giochi" },
      { id: "sessions", icon: "📡", label: "Sessioni Live", badge: 5 },
    ],
  },
  {
    group: "PROMOZIONI",
    items: [
      { id: "promos", icon: "🎁", label: "Tutte le Promo", badge: 11 },
      { id: "wagering", icon: "⏳", label: "Wagering", badge: 5 },
      { id: "free-items", icon: "🎡", label: "Spins & Free Bet" },
      { id: "tournaments", icon: "🏆", label: "Tornei", badge: 2 },
      { id: "promo-analytics", icon: "📈", label: "Analytics Promo" },
    ],
  },
  {
    group: "CRYPTO PAYMENTS",
    items: [
      { id: "withdrawals", icon: "💸", label: "Prelievi", badge: 5 },
      { id: "deposits", icon: "↓", label: "Depositi" },
      { id: "treasury", icon: "🏦", label: "Treasury" },
      { id: "aml", icon: "🔒", label: "AML", badge: 1 },
    ],
  },
  {
    group: "GESTIONE",
    items: [
      { id: "users", icon: "👥", label: "Utenti" },
      { id: "agents", icon: "🤝", label: "Agenti" },
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
  casino: "Casino — Provider & Giochi",
  sessions: "Casino — Sessioni Live",
  promos: "Promozioni & Bonus",
  wagering: "Wagering Tracker",
  "free-items": "Free Spins & Free Bet",
  tournaments: "Slot Tournaments & Race",
  "promo-analytics": "Analytics Promozioni",
  withdrawals: "Crypto — Prelievi",
  deposits: "Crypto — Depositi",
  treasury: "Treasury",
  aml: "AML — Anti Money Laundering",
  users: "Gestione Utenti",
  agents: "Agenti & Partner",
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
    // Map sidebar ids to routes
    const routeMap: Record<string, string> = {
      dashboard: "/admin/dashboard",
      bets: "/admin/sportsbook",
      settlement: "/admin/sportsbook",
      risk: "/admin/sportsbook",
      casino: "/admin/casino",
      sessions: "/admin/casino",
      promos: "/admin/promos",
      wagering: "/admin/promos",
      "free-items": "/admin/promos",
      tournaments: "/admin/promos",
      "promo-analytics": "/admin/promos",
      withdrawals: "/admin/crypto",
      deposits: "/admin/crypto",
      treasury: "/admin/treasury",
      aml: "/admin/aml",
      users: "/admin/management",
      agents: "/admin/management",
      config: "/admin/management",
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
