"use client";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (code: string) => void;
}

export function SearchDrawer({ open, onClose, onSelect }: Props) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      const r = await fetch(`/api/tickets/search?${params}`);
      if (r.ok) {
        const j = await r.json();
        setItems(j.items ?? []);
      } else {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose}>
      <div className="absolute right-0 top-0 h-full w-[480px] bg-slate-900 border-l border-slate-700 p-4 overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <div className="font-bold text-white">Ricerca storico ticket</div>
          <button onClick={onClose} className="text-slate-400">X</button>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="TK-XXX..."
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-700 text-white font-mono"
            autoFocus
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 rounded bg-slate-800 border border-slate-700 text-white text-sm">
            <option value="">Tutti</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="void">Void</option>
            <option value="claimed">Claimed</option>
            <option value="expired">Expired</option>
          </select>
          <button onClick={search} disabled={loading} className="px-4 rounded bg-blue-600 text-white text-sm">Cerca</button>
        </div>
        <div className="space-y-1">
          {items.map((it) => (
            <button
              key={it.ticket_code}
              onClick={() => { onSelect(it.ticket_code); onClose(); }}
              className="w-full text-left p-2 rounded hover:bg-slate-800 text-xs flex justify-between"
            >
              <span className="font-mono text-amber-400">{it.ticket_code}</span>
              <span className="text-slate-300">{it.status}</span>
              <span className="font-mono text-slate-400">€{Number(it.stake).toFixed(0)}</span>
              <span className="text-slate-500">{new Date(it.printed_at).toLocaleDateString("it-IT")}</span>
            </button>
          ))}
          {!loading && items.length === 0 && q && <div className="text-slate-500 text-sm text-center py-6">Nessun risultato</div>}
        </div>
      </div>
    </div>
  );
}
