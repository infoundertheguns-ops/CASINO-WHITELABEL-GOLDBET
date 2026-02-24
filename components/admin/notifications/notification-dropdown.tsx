"use client";

import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface NotificationDropdownProps {
  notifications: any[];
  loading: boolean;
  onMarkRead: (ids?: string[]) => void;
  onClose: () => void;
}

export function NotificationDropdown({ notifications, loading, onMarkRead, onClose }: NotificationDropdownProps) {
  const router = useRouter();

  const handleClick = (notif: any) => {
    if (!notif.is_read) onMarkRead([notif.id]);
    if (notif.link) {
      router.push(notif.link);
      onClose();
    }
  };

  const severityIcon = (s: string) =>
    s === "critical" ? "🔴" : s === "warning" ? "🟡" : "🔵";

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "ora";
    if (mins < 60) return `${mins}m fa`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h fa`;
    return `${Math.floor(hours / 24)}g fa`;
  };

  return (
    <div className="absolute right-0 top-full mt-2 w-80 max-h-[400px] rounded-xl shadow-2xl overflow-hidden z-50"
      style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--admin-border)" }}>
        <span className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>Notifiche</span>
        <button
          onClick={() => onMarkRead()}
          disabled={loading}
          className="text-[9px] font-bold text-brand hover:underline"
        >
          Segna tutto letto
        </button>
      </div>

      {/* List */}
      <div className="overflow-y-auto max-h-[340px]">
        {notifications.length === 0 ? (
          <div className="p-6 text-center text-[10px]" style={{ color: "var(--admin-text4)" }}>
            Nessuna notifica
          </div>
        ) : (
          notifications.map(n => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={cn(
                "w-full text-left px-4 py-3 border-b hover:bg-white/5 transition-colors",
                !n.is_read && "bg-brand/5"
              )}
              style={{ borderColor: "var(--admin-border)" }}
            >
              <div className="flex items-start gap-2">
                <span className="text-xs mt-0.5">{severityIcon(n.severity)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold truncate" style={{ color: "var(--admin-text)" }}>
                      {n.title}
                    </span>
                    <span className="text-[8px] ml-2 whitespace-nowrap" style={{ color: "var(--admin-text4)" }}>
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  {n.message && (
                    <p className="text-[9px] mt-0.5 line-clamp-2" style={{ color: "var(--admin-text3)" }}>
                      {n.message}
                    </p>
                  )}
                  <span className={cn("text-[7px] font-bold px-1 py-0.5 rounded mt-1 inline-block",
                    n.type === "risk_alert" ? "bg-red-500/10 text-red-400" :
                    n.type === "bet_review" ? "bg-yellow-500/10 text-yellow-400" :
                    n.type === "liability_warning" ? "bg-orange-500/10 text-orange-400" :
                    n.type === "odds_suggestion" ? "bg-purple-500/10 text-purple-400" :
                    "bg-gray-500/10 text-gray-400"
                  )}>{n.type?.replace(/_/g, " ").toUpperCase()}</span>
                </div>
                {!n.is_read && (
                  <span className="w-2 h-2 rounded-full bg-brand mt-1 flex-shrink-0" />
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
