"use client";

import { Badge } from "@/components/ui/badge";

interface AdminTopBarProps {
  title: string;
  notificationCount?: number;
}

export function AdminTopBar({ title, notificationCount = 0 }: AdminTopBarProps) {
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
    <div className="bg-admin-surface border-b border-admin px-5 py-2.5 flex items-center justify-between flex-shrink-0">
      <h1 className="text-base font-extrabold text-txt tracking-tight">{title}</h1>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-txt-tertiary">
          {dateStr} · {timeStr}
        </span>
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
