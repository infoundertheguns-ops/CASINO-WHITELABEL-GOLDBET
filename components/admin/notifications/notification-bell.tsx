"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { NotificationDropdown } from "./notification-dropdown";

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications?limit=15");
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unread_count || 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchNotifications();

    // Realtime subscription
    const channel = supabase
      .channel("admin-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "admin_notifications" }, (payload) => {
        const notif = payload.new as any;
        setNotifications(prev => [notif, ...prev].slice(0, 15));
        setUnreadCount(prev => prev + 1);

        // Browser notification for critical
        if (notif.severity === "critical" && "Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification(notif.title, { body: notif.message, icon: "/icons/shield.png" });
          } else if (Notification.permission !== "denied") {
            Notification.requestPermission();
          }
        }

        // Sound for critical/warning
        if (notif.severity === "critical" || notif.severity === "warning") {
          try {
            const audio = new Audio("data:audio/wav;base64,UklGRtQEAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YbAEAACAgICAgH9/fn9/gIGBgH9+fX5/gYKCgX99fHx/goSEgn98ent+goWFg395eXp9goaHhH97eHl9goeIhYB6d3d7goeJh4F6dnZ6goiLiIJ6dHR5gYmMioN6dHN4gImNi4R6c3F2gImPjYV7cnB0fomQj4d7cm5zfYmRkIh8cW1xfImRkop9cWtveoiSlIx+cWpteYiTlY6AcWlrd4eTl5CBcWhqdYaUmJKDcmdoc4SUmpSEc2dmcYOUm5aGdGZkb4GTnJiJdWZibICTnZqLdmVhan6SnpyNeGVfaHuRn56QeWZeZXmQn6CSe2ZcY3ePoKKVfWdbYXSNoKSXf2haXnGLoKaagmlaXG+JoKedhWpZWmyHn6mfh2tZWGmFnqqiim1YVmaCnauljW9YVGN/nKynkHFZUmB9m62qk3RZUF16ma2sl3ZaT1p2l62vmnlbTVdzla2xnXxcTFRwk62zoYBeTFFskK21pINgS05ojay2qIZiS0xliqu4q4pkS0lhh6m5ro5nS0ddg6i6sZJqS0VZgKa6tJZtTURWfKO6tplxT0RUeKC5t5x0UURRdJy3uaB4VERPcZm2uqN8VkRNbZa0uqZ/WUVLaZKyu6mDXEVJZo6wu6uHX0ZIY4uuvK6LY0hGX4eru7COZklFXIOpu7KSaUtFWYCmurSWbU1EVnyjuraZcU9EVHigubecdFFEUXSct7mgeFRET3GZtrqjfFZETW2WtLqmf1lFS2mSsrupg1xFSWaOsLurh19GSGOLrryui2NIRl+Hq7uwjmZJRVyDqbuykmlLRVl/prq0lm1NRFZ8o7q2mXFPRFR4oLm3nHRRRFF0nLe5oHhURE9xmba6o3xWRE1tlrS6pn9ZRUtpkrK7qYNcRUlmjrC7q4dfRkhji668rotjSEZfh6u7sI5mSUVcg6m7spJpS0VZf6a6tJZtTURWfKO6tplxT0RUeKC5t5x0UURRdJy3uaB4VERPcZm2uqN8VkRNbZa0uqZ/WUVLaZKyu6mDXEVJZo6wu6uHX0ZIY4uuvK6LY0hGX4eru7COZklFXIOpu7KSaUtFWYCmurSVbU5FV3yiuLSYcVFGVnietrSbdVRHVHWas7SdeVdJU3KXsbSffFtKUm+TrrOhf15MUmyPq7Ojg2JOUmqMqLKkhmVQUmiJpbCliWhTUmaFoq+mi2xVUmSCn62mjm9YU2OAnKunkHJaVGJ9mamnknVdVWF6lqemlHhgVmB4k6WmlXpiWF92kKOlln1lWV90jqGll39oW19yi56kmIJqXV9wiJyjmYRtX2BvhpqhmYZvYWBuhJegmodyY2FtgZWemol0ZWJsgJOdmYp2Z2NsfpCbmYt5aWRrfI6ZmIx7a2Vre4yXmI18bWdreYqVl45+b2hseIiUlo5/cWpsd4aSlY6Bc2ttd4WQlI6CdW1udoOOko6Dd29udoKMkY2EeHBvdoGLj42EenJwdoCJjoyFe3Rydn+HjIuFfHVzdn6Gi4uFfXd0d32FiYmFfnh2eH2EiIiFf3p3eH2ChoeEf3t4eX2ChYaEgHx6en2BhIWDgH17e32Ag4OCgH59fX6AgYKBgH9+fn+AgIGAgH9/f38=");
            audio.volume = 0.3;
            audio.play().catch(() => {});
          } catch {}
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchNotifications, supabase]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleMarkRead = async (ids?: string[]) => {
    setLoading(true);
    try {
      await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : { mark_all_read: true }),
      });
      fetchNotifications();
    } finally { setLoading(false); }
  };

  return (
    <div ref={bellRef} className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifications(); }}
        className="relative p-2 rounded-lg hover:bg-white/5 transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: "var(--admin-text3)" }}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[8px] font-bold px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <NotificationDropdown
          notifications={notifications}
          loading={loading}
          onMarkRead={handleMarkRead}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
