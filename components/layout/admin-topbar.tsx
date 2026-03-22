"use client";

import { NotificationBell } from "@/components/admin/notifications/notification-bell";

interface AdminTopBarProps {
  title: string;
  notificationCount?: number;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onMenuClick?: () => void;
}

export function AdminTopBar({ title, theme = "dark", onToggleTheme, onMenuClick }: AdminTopBarProps) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="border-b px-3 md:px-5 py-2.5 flex items-center justify-between flex-shrink-0 gap-2"
      style={{ background: "var(--admin-surface)", borderColor: "var(--admin-border)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Hamburger - mobile only */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="md:hidden flex flex-col gap-1 p-1 flex-shrink-0"
            aria-label="Menu"
          >
            <span className="block w-5 h-0.5 rounded" style={{ background: "var(--admin-text)" }} />
            <span className="block w-5 h-0.5 rounded" style={{ background: "var(--admin-text)" }} />
            <span className="block w-5 h-0.5 rounded" style={{ background: "var(--admin-text)" }} />
          </button>
        )}
        <h1
          className="text-sm md:text-base font-extrabold tracking-tight truncate"
          style={{ color: "var(--admin-text)" }}
        >
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2 md:gap-4 text-xs flex-shrink-0">
        <span className="hidden sm:inline" style={{ color: "var(--admin-text4)" }}>
          {dateStr} · {timeStr}
        </span>

        {/* Theme Toggle */}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
            style={{ background: theme === "dark" ? "#342f60" : "#d1d5db" }}
            title={theme === "dark" ? "Passa a Light" : "Passa a Dark"}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full transition-transform flex items-center justify-center text-[10px]"
              style={{
                transform: theme === "dark" ? "translateX(1px)" : "translateX(19px)",
                background: theme === "dark" ? "#0a0914" : "#ffffff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
            >
              {theme === "dark" ? "🌙" : "☀️"}
            </div>
          </button>
        )}

        <NotificationBell />

        {/* Logout */}
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="px-2 py-1 rounded text-[11px] font-semibold transition-colors"
          style={{ color: "var(--admin-text4)", border: "1px solid var(--admin-border)" }}
          onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#ef4444"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--admin-text4)"; e.currentTarget.style.borderColor = "var(--admin-border)"; }}
          title="Esci"
        >
          Esci ↪
        </button>
      </div>
    </div>
  );
}
