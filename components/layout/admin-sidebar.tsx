"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type { AdminNavGroup, AdminNavItem } from "@/lib/types";

interface AdminSidebarProps {
  navigation: AdminNavGroup[];
  activeId: string;
  onNavigate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  userRole?: "super_admin" | "agent" | "loading";
  agentCode?: string;
}

export function AdminSidebar({
  navigation,
  activeId,
  onNavigate,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  userRole,
  agentCode,
}: AdminSidebarProps) {
  // Close mobile drawer on route change
  useEffect(() => {
    onCloseMobile();
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when mobile drawer open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [mobileOpen]);

  const handleNavigate = (id: string) => {
    onNavigate(id);
    onCloseMobile();
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div
        onClick={onToggleCollapse}
        className={cn(
          "flex items-center gap-2.5 border-b cursor-pointer",
          collapsed && !mobileOpen ? "px-2.5 py-3.5" : "px-4 py-3.5"
        )}
        style={{ borderColor: "var(--admin-border)" }}
      >
        <span className="text-xl flex-shrink-0">🎲</span>
        {(!collapsed || mobileOpen) && (
          <span
            className="text-sm font-extrabold tracking-tight whitespace-nowrap"
            style={{ color: "var(--admin-text)" }}
          >
            BACK OFFICE
          </span>
        )}
        {/* Close button on mobile */}
        {mobileOpen && (
          <button
            onClick={(e) => { e.stopPropagation(); onCloseMobile(); }}
            className="ml-auto text-lg"
            style={{ color: "var(--admin-text4)" }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        {navigation.map((group) => (
          <div key={group.group}>
            {(!collapsed || mobileOpen) && (
              <div
                className="px-4 pt-3 pb-1 text-[9px] font-bold tracking-widest"
                style={{ color: "var(--admin-text4)" }}
              >
                {group.group}
              </div>
            )}
            {group.items.map((item) => (
              <SidebarItem
                key={item.id}
                item={item}
                isActive={activeId === item.id}
                collapsed={collapsed && !mobileOpen}
                onClick={() => handleNavigate(item.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      {(!collapsed || mobileOpen) && (
        <div
          className="px-4 py-3 border-t text-[10px]"
          style={{ borderColor: "var(--admin-border)", color: "var(--admin-text4)" }}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>
              {userRole === "agent"
                ? `${agentCode ? agentCode.toLowerCase() : "agente"} · agent`
                : userRole === "loading"
                ? "—"
                : "admin · super_admin"}
            </span>
          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col flex-shrink-0 border-r transition-[width] duration-200 overflow-hidden"
        style={{
          width: collapsed ? 56 : 220,
          background: "var(--admin-sidebar)",
          borderColor: "var(--admin-border)",
        }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 flex flex-col w-64 transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{
          background: "var(--admin-sidebar)",
          borderRight: "1px solid var(--admin-border)",
        }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}

function SidebarItem({
  item,
  isActive,
  collapsed,
  onClick,
}: {
  item: AdminNavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 transition-all duration-150 text-left",
        collapsed ? "px-4 py-2.5" : "px-4 py-2"
      )}
      style={{
        color: isActive ? "var(--admin-text)" : "var(--admin-text4)",
        fontWeight: isActive ? 700 : 400,
        background: isActive ? "var(--admin-sidebar-active)" : "transparent",
        borderRight: isActive ? "2px solid #f0b429" : "2px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--admin-card-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <span className="text-[15px] flex-shrink-0 w-5 text-center">{item.icon}</span>
      {!collapsed && (
        <>
          <span className="flex-1 text-xs whitespace-nowrap">{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span
              className={cn(
                "text-white px-1.5 py-px rounded-full text-[9px] font-extrabold flex-shrink-0",
                item.badge >= 3 ? "bg-red-500" : "bg-orange-500"
              )}
            >
              {item.badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}
