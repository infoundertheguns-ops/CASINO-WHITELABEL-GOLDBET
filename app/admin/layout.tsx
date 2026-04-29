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
      { id: "risk", icon: "🛡️", label: "Risk & Trading", badge: 5 },
    ],
  },
  {
    group: "SISTEMA",
    items: [
      { id: "agents", icon: "🏢", label: "Agenti" },
      { id: "kiosks", icon: "🖥️", label: "Kiosk" },
      { id: "agent-tickets", icon: "🎫", label: "Ticket" },
      { id: "kiosk-vouchers", icon: "💸", label: "Voucher Cashout" },
      { id: "financial", icon: "💹", label: "Financial" },
      { id: "home-content", icon: "🏠", label: "Home CMS" },
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
  risk: "Risk & Trading Desk",
  liability: "Liability Management",
  agents: "Gestione Agenti",
  kiosks: "Gestione Kiosk",
  "agent-kiosks": "I Miei Kiosk",
  "agent-tickets": "Ticket",
  "kiosk-vouchers": "Voucher Cashout Kiosk",
  financial: "Financial Report",
  "canonical-markets": "Catalogo Canonical Markets",
  "home-content": "Home CMS",
  fixtures: "Fixtures",
  "agent-bets": "Scommesse",
  "agent-wallet": "Wallet",
  "agent-network": "Rete Agenti",
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
  const [agentCode, setAgentCode] = useState("");

  const activeId = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[1] === "home-content") return "home-content";
    if (parts[1] === "market-coverage") return "market-coverage";
    if (parts[1] === "consensus") return "consensus";
    if (parts[1] === "shade-monitor") return "shade-monitor";
    if (parts[1] === "manual-overrides") return "manual-overrides";
    if (parts[1] === "market-catalog") return "market-catalog";
    if (parts[1] === "canonicalization") return "canonicalization";
    if (parts[1] === "market-normalization") return "market-normalization";
    if (parts[1] === "outcome-normalization") return "outcome-normalization";
    if (parts[1] === "event-normalization") return "event-normalization";
    if (parts[1] === "canonical-markets") return "canonical-markets";
    if (parts[1] === "settlement-health") return "settlement-health";
    if (parts[1] === "kiosks") return "kiosks";
    if (parts[1] === "agent-kiosks") return "agent-kiosks";
    if (parts[1] === "agents") return "agents";
    if (parts[1] === "agent-tickets") return "agent-tickets";
    if (parts[1] === "kiosk-vouchers") return "kiosk-vouchers";
    if (parts[1] === "financial") return "financial";
    if (parts[1] === "risk") return "risk";
    if (parts[1] === "agent-bets") return "bets";
    if (parts[1] === "agent-wallet") return "agent-wallet";
    if (parts[1] === "agent-network") return "agent-network";
    if (parts[1] === "settlements") return "agent-settlements";
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
          setAgentCode(myAgent.code || "");
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
      "agent-dashboard": "/admin/agent-dashboard",
      "agent-players": "/admin/agent-players",
      "agent-bets": "/admin/bets",
      "agent-wallet": "/admin/agent-wallet",
      "agent-network": "/admin/agent-network",
      "agent-credit": "/admin/agent-players",
      "agent-tickets": "/admin/agent-tickets",
      "agent-kiosks": "/admin/agent-kiosks",
      "agent-reports": "/admin/agent-commissions",
      "agent-commissions": "/admin/agent-commissions",
      "agent-settlements": "/admin/settlements",
      "agent-risk": "/admin/risk",
      // Super admin routes
      dashboard: "/admin/dashboard",
      bets: "/admin/bets",
      settlement: "/admin/sportsbook",
      risk: "/admin/risk",
      liability: "/admin/risk",
      agents: "/admin/agents",
      kiosks: "/admin/kiosks",
      "kiosk-vouchers": "/admin/kiosk-vouchers",
      "home-content": "/admin/home-content",
      financial: "/admin/financial",
      "settlement-health": "/admin/settlement-health",
      "market-coverage": "/admin/market-coverage",
      consensus: "/admin/consensus",
      "shade-monitor": "/admin/shade-monitor",
      "manual-overrides": "/admin/manual-overrides",
      "market-catalog": "/admin/market-catalog",
      canonicalization: "/admin/canonicalization",
      "market-normalization": "/admin/market-normalization",
      "outcome-normalization": "/admin/outcome-normalization",
      "event-normalization": "/admin/event-normalization",
      "canonical-markets": "/admin/canonical-markets",
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
        userRole={userRole}
        agentCode={agentCode}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopBar
          title={userRole === "agent" ? `${agentName || "Agente"}` : (TITLES[activeId] || "Back Office")}
          notificationCount={notifCount}
          theme={theme}
          onToggleTheme={toggle}
          onMenuClick={() => setMobileOpen(!mobileOpen)}
        />

        <main className="flex-1 overflow-auto p-3 md:p-5 admin-content">{children}</main>
      </div>
    </div>
  );
}
