"use client";
import { useEffect, useState } from "react";
import { RecentPaidList } from "./recent-paid-list";

interface Stats {
  tickets_paid: number;
  total_paid: number;
  tickets_count_today: number;
  total_printed_today: number;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  onOpenSearch: () => void;
  onSelect: (code: string) => void;
  onReprint: (code: string) => void;
  refreshKey: number;
}

export function ShiftSidebar({ open, onToggle, onOpenSearch, onSelect, onReprint, refreshKey }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sR, rR] = await Promise.all([
          fetch("/api/tickets/shift").then(r => r.ok ? r.json() : null),
          fetch("/api/tickets/recent").then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        if (sR) {
          setStats({
            tickets_paid: sR.tickets_paid ?? 0,
            total_paid: Number(sR.total_paid ?? 0),
            tickets_count_today: sR.tickets_count_today ?? 0,
            total_printed_today: Number(sR.total_printed_today ?? 0),
          });
        }
        if (rR) setRecent(rR.items ?? []);
      } catch {
        // silenzioso: la sidebar è secondaria
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!open) {
    return (
      <button onClick={onToggle} className="fixed right-2 top-24 bg-slate-800 rounded-l px-2 py-4 text-slate-300" title="F2 - Apri">
        ‹
      </button>
    );
  }

  return (
    <aside className="w-[320px] shrink-0 bg-[var(--admin-card)] border border-[var(--admin-border)] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-[var(--admin-text)]">TURNO OGGI</div>
        <button onClick={onToggle} className="text-slate-500 hover:text-[var(--admin-text)] text-xs" title="F2 - Chiudi">chiudi</button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-700 p-2 rounded">
            <div className="text-slate-300">Pagati</div>
            <div className="font-mono font-bold text-lg text-emerald-400">{stats.tickets_paid}</div>
          </div>
          <div className="bg-slate-700 p-2 rounded">
            <div className="text-slate-300">Uscite €</div>
            <div className="font-mono font-bold text-lg text-emerald-400">€{stats.total_paid.toFixed(2)}</div>
          </div>
          <div className="bg-slate-700 p-2 rounded">
            <div className="text-slate-300">Stampati</div>
            <div className="font-mono font-bold text-lg text-white">{stats.tickets_count_today}</div>
          </div>
          <div className="bg-slate-700 p-2 rounded">
            <div className="text-slate-300">Entrate €</div>
            <div className="font-mono font-bold text-lg text-white">€{stats.total_printed_today.toFixed(2)}</div>
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-bold text-[var(--admin-text)] mb-2">ULTIMI PAGATI</div>
        <RecentPaidList items={recent} onReprint={onReprint} onSelect={onSelect} />
      </div>

      <button onClick={onOpenSearch} className="w-full py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm font-bold" style={{ color: "#ffffff" }}>
        Cerca storico (F3)
      </button>
    </aside>
  );
}
