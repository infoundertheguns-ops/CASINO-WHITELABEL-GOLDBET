"use client";

import { cn } from "@/lib/utils";
import { SLABadge } from "@/components/admin/risk/sla-badge";

interface PlayerFlagsListProps {
  flags: any[];
  onReload: () => void;
}

export function PlayerFlagsList({ flags, onReload }: PlayerFlagsListProps) {
  const handleResolve = async (id: string, status: string) => {
    await fetch("/api/admin/risk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    onReload();
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--admin-border)" }}>
        <h3 className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>Alert ({flags.length})</h3>
      </div>

      {flags.length === 0 ? (
        <div className="p-4 text-center text-[10px]" style={{ color: "var(--admin-text4)" }}>Nessun alert</div>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--admin-border)" }}>
          {flags.map(f => (
            <div key={f.id} className="px-4 py-3 hover:bg-white/5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold",
                    f.severity === "critical" ? "bg-red-500/20 text-red-400" :
                    f.severity === "high" ? "bg-orange-500/20 text-orange-400" :
                    f.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                    "bg-green-500/20 text-green-400"
                  )}>{f.severity?.toUpperCase()}</span>
                  <span className="text-[9px] font-bold" style={{ color: "var(--admin-text3)" }}>{f.flag_type}</span>
                  <SLABadge deadline={f.sla_deadline} severity={f.severity} />
                </div>
                <span className={cn("text-[8px] font-bold",
                  f.status === "open" ? "text-yellow-400" : f.status === "resolved" ? "text-emerald-400" : "text-gray-500"
                )}>{f.status?.toUpperCase()}</span>
              </div>

              <p className="text-[10px] mb-1" style={{ color: "var(--admin-text3)" }}>{f.description}</p>

              <div className="flex items-center justify-between">
                <span className="text-[9px]" style={{ color: "var(--admin-text4)" }}>
                  {new Date(f.created_at).toLocaleString("it-IT")}
                </span>
                {f.status === "open" && (
                  <div className="flex gap-1">
                    <button onClick={() => handleResolve(f.id, "resolved")}
                      className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-bold">Risolvi</button>
                    <button onClick={() => handleResolve(f.id, "dismissed")}
                      className="px-2 py-0.5 rounded bg-gray-500/20 text-gray-400 text-[8px] font-bold">Ignora</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
