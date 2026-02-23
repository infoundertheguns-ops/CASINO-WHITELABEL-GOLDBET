"use client";

interface AdminTopBarProps {
  title: string;
  notificationCount?: number;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
}

export function AdminTopBar({ title, notificationCount = 0, theme = "dark", onToggleTheme }: AdminTopBarProps) {
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
      className="border-b px-5 py-2.5 flex items-center justify-between flex-shrink-0"
      style={{ background: "var(--admin-surface)", borderColor: "var(--admin-border)" }}
    >
      <h1 className="text-base font-extrabold tracking-tight" style={{ color: "var(--admin-text)" }}>{title}</h1>
      <div className="flex items-center gap-4 text-xs">
        <span style={{ color: "var(--admin-text4)" }}>
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

        <button className="relative">
          <span className="text-base">🔔</span>
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1.5 bg-red-500 text-white rounded-full px-1 text-[8px] font-extrabold min-w-[14px] text-center">
              {notificationCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
