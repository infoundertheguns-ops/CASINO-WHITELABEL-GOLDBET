"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminTopBar } from "@/components/layout/admin-topbar";
import { useAuth } from "@/lib/hooks/use-auth";
import { useAdminTheme } from "@/lib/hooks/use-admin-theme";
import { buildAgentNavigation } from "@/lib/agent-permissions";
import type { AgentPermissions } from "@/lib/types/agent";
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
    ],
  },
  {
    group: "SISTEMA",
    items: [
      { id: "agents", icon: "🏢", label: "Agenti" },
      { id: "agent-tickets", icon: "🎫", label: "Ticket" },
      { id: "financial", icon: "💹", label: "Financial" },
      { id: "scraper", icon: "🔄", label: "Scraper Monitor" },
      { id: "settlement-health", icon: "💚", label: "Settlement Health" },
      { id: "market-coverage", icon: "📈", label: "Market Coverage" },
      { id: "market-translations", icon: "🌐", label: "Traduzioni Mercati" },
      { id: "fixtures", icon: "📅", label: "Fixtures" },
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
  agents: "Gestione Agenti",
  "agent-tickets": "Ticket",
  financial: "Financial Report",
  scraper: "Scraper Monitor",
  "settlement-health": "Settlement Health",
  "market-coverage": "Market Coverage",
  "market-translations": "Traduzioni Mercati",
  fixtures: "Fixtures",
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

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userRole, setUserRole] = useState<"super_admin" | "agent" | "loading">("loading");
  const [agentPermissions, setAgentPermissions] = useState<AgentPermissions | null>(null);
  const [agentName, setAgentName] = useState("");

  const activeId = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[1] === "market-coverage") return "market-coverage";
    if (parts[1] === "market-translations") return "market-translations";
    if (parts[1] === "settlement-health") return "settlement-health";
    if (parts[1] === "agents") return "agents";
    if (parts[1] === "agent-tickets") return "agent-tickets";
    if (parts[1] === "financial") return "financial";
    if (parts[1] === "risk") return "risk";
    return parts[parts.length - 1] || "dashboard";
  }, [pathname]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Detect user role (super_admin vs agent)
  useEffect(() => {
    async function detectRole() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) { setUserRole("super_admin"); return; }
        const data = await res.json();
        const userId = data.user?.id;
        if (!userId) { setUserRole("super_admin"); return; }

        // Check admin_users
        const adminRes = await fetch(`/api/admin/agents?_check_role=${userId}`);
        const adminData = await adminRes.json();

        // Find if current user is an agent
        const agents = adminData.agents || [];
        const myAgent = agents.find((a: any) => a.user_id === userId);

        if (myAgent) {
          setUserRole("agent");
          setAgentPermissions(myAgent.permissions);
          setAgentName(myAgent.name);
        } else {
          setUserRole("super_admin");
        }
      } catch {
        setUserRole("super_admin");
      }
    }
    if (pathname !== "/admin/login") detectRole();
  }, [pathname]);

  // Build navigation based on role
  const effectiveNavigation = useMemo(() => {
    if (userRole === "agent" && agentPermissions) {
      return buildAgentNavigation(agentPermissions) as AdminNavGroup[];
    }
    return NAVIGATION;
  }, [userRole, agentPermissions]);

  const handleNavigate = (id: string) => {
    const routeMap: Record<string, string> = {
      // Agent routes
      "agent-dashboard": "/admin/dashboard",
      "agent-players": "/admin/agents",
      "agent-subagents": "/admin/agents",
      "agent-credit": "/admin/agents",
      "agent-bets": "/admin/sportsbook",
      "agent-reports": "/admin/financial",
      "agent-commissions": "/admin/financial",
      "agent-risk": "/admin/risk",
      // Super admin routes
      dashboard: "/admin/dashboard",
      bets: "/admin/sportsbook",
      settlement: "/admin/sportsbook",
      risk: "/admin/risk",
      liability: "/admin/risk",
      agents: "/admin/agents",
      "agent-tickets": "/admin/agent-tickets",
      financial: "/admin/financial",
      scraper: "/admin/scraper",
      "settlement-health": "/admin/settlement-health",
      "market-coverage": "/admin/market-coverage",
      "market-translations": "/admin/market-translations",
      fixtures: "/admin/fixtures",
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

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Login page: render without sidebar/topbar
  if (pathname === "/admin/login") {
    return (
      <div className={`admin-theme ${isLight ? "admin-light" : ""} min-h-screen font-sans`}
        style={{ background: "var(--admin-bg)", color: "var(--admin-text)" }}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={`admin-theme ${isLight ? "admin-light" : ""} flex min-h-screen font-sans`}
      style={{ background: "var(--admin-bg)", color: "var(--admin-text)" }}
    >
      <AdminSidebar
        navigation={effectiveNavigation}
        activeId={activeId}
        onNavigate={handleNavigate}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopBar
          title={userRole === "agent" ? `${agentName || "Agente"}` : (TITLES[activeId] || "Back Office")}
          notificationCount={notifCount}
          theme={theme}
          onToggleTheme={toggle}
          onMenuClick={() => setMobileOpen(!mobileOpen)}
        />

        <main className="flex-1 overflow-auto p-3 md:p-5">{children}</main>
      </div>
    </div>
  );
}
