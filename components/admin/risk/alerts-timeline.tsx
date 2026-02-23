"use client";

import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";

interface Alert {
  id: string;
  severity: string;
  flag_type: string;
  description: string;
  status: string;
  created_at: string;
  users?: { username: string; email: string };
}

interface AlertsTimelineProps {
  alerts: Alert[];
  onResolve: (id: string, status: string) => void;
}

const sevColor = (s: string) =>
  s === "critical" ? "bg-red-500/20 text-red-400 border-red-500/30" :
  s === "high" ? "bg-orange-500/20 text-orange-400 border-orange-500/30" :
  s === "medium" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
  "bg-green-500/20 text-green-400 border-green-500/30";

const sevDot = (s: string) =>
  s === "critical" ? "bg-red-500" :
  s === "high" ? "bg-orange-500" :
  s === "medium" ? "bg-yellow-500" :
  "bg-green-500";

export function AlertsTimeline({ alerts, onResolve }: AlertsTimelineProps) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
      <div className="px-4 py-3 flex justify-between items-center" style={{ borderBottom: "1px solid var(--admin-border)" }}>
        <span className="text-sm font-bold" style={{ color: "var(--admin-text)" }}>Alert in Tempo Reale</span>
        <span className="text-[10px]" style={{ color: "var(--admin-text4)" }}>{alerts.length} recenti</span>
      </div>
      {alerts.length === 0 ? (
        <div className="p-8 text-center text-gray-500 text-sm">Nessun alert</div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto">
          {alerts.map(a => (
            <div key={a.id} className="px-4 py-3 border-b border-gray-800/50 hover:bg-white/5 flex gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className={cn("w-2.5 h-2.5 rounded-full", sevDot(a.severity))} />
                <div className="w-px flex-1 bg-gray-800 mt-1" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold border", sevColor(a.severity))}>
                    {a.severity?.toUpperCase()}
                  </span>
                  <span className="text-xs font-medium" style={{ color: "var(--admin-text)" }}>{a.users?.username || "—"}</span>
                  <span className="text-[9px] text-gray-600 ml-auto">{timeAgo(a.created_at)}</span>
                </div>
                <p className="text-[10px] text-gray-400 mb-2 line-clamp-2">{a.description}</p>
                {a.status === "open" && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onResolve(a.id, "resolved")}
                      className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-bold hover:bg-emerald-500/30"
                    >
                      Risolvi
                    </button>
                    <button
                      onClick={() => onResolve(a.id, "escalated")}
                      className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[8px] font-bold hover:bg-red-500/30"
                    >
                      Escala
                    </button>
                    <button
                      onClick={() => onResolve(a.id, "dismissed")}
                      className="px-2 py-0.5 rounded bg-gray-500/20 text-gray-400 text-[8px] font-bold hover:bg-gray-500/30"
                    >
                      Ignora
                    </button>
                  </div>
                )}
                {a.status !== "open" && (
                  <span className={cn("text-[8px] font-bold",
                    a.status === "resolved" ? "text-emerald-500" : a.status === "escalated" ? "text-red-400" : "text-gray-500"
                  )}>
                    {a.status.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
