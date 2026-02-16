"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AdminNavGroup, AdminNavItem } from "@/lib/types";

interface AdminSidebarProps {
  navigation: AdminNavGroup[];
  activeId: string;
  onNavigate: (id: string) => void;
}

export function AdminSidebar({ navigation, activeId, onNavigate }: AdminSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex flex-col flex-shrink-0 border-r border-admin transition-[width] duration-200 overflow-hidden",
        collapsed ? "w-14" : "w-[220px]"
      )}
      style={{ background: "#0a0914" }}
    >
      {/* Logo */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        className={cn(
          "flex items-center gap-2.5 border-b border-admin cursor-pointer",
          collapsed ? "px-2.5 py-3.5" : "px-4 py-3.5"
        )}
      >
        <span className="text-xl flex-shrink-0">🎲</span>
        {!collapsed && (
          <span className="text-sm font-extrabold text-txt tracking-tight whitespace-nowrap">
            BACK OFFICE
          </span>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        {navigation.map((group) => (
          <div key={group.group}>
            {/* Group Label */}
            {!collapsed && (
              <div className="px-4 pt-3 pb-1 text-[9px] font-bold text-txt-tertiary tracking-widest">
                {group.group}
              </div>
            )}

            {/* Items */}
            {group.items.map((item) => (
              <SidebarItem
                key={item.id}
                item={item}
                isActive={activeId === item.id}
                collapsed={collapsed}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3 border-t border-admin text-[10px] text-txt-tertiary">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>admin · super_admin</span>
          </div>
        </div>
      )}
    </aside>
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
        collapsed ? "px-4 py-2.5" : "px-4 py-2",
        isActive
          ? "text-txt font-bold border-r-2 border-gold"
          : "text-txt-tertiary hover:text-txt-secondary hover:bg-admin-surface",
        isActive && "bg-[#1a1830]"
      )}
      style={{ borderRightColor: isActive ? "#f0b429" : "transparent" }}
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
