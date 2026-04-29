"use client";

interface Item {
  ticket_code: string;
  win_amount: number;
  claimed_at: string;
}

interface Props {
  items: Item[];
  onReprint: (code: string) => void;
  onSelect: (code: string) => void;
}

export function RecentPaidList({ items, onReprint, onSelect }: Props) {
  if (items.length === 0) {
    return <div className="text-xs text-slate-500 italic py-2">Nessun ticket pagato nel turno</div>;
  }
  return (
    <div className="space-y-1 max-h-80 overflow-y-auto">
      {items.map((it) => (
        <div key={it.ticket_code} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-white/5">
          <button onClick={() => onSelect(it.ticket_code)} className="font-mono text-amber-400 hover:text-amber-300">
            {it.ticket_code}
          </button>
          <span className="text-emerald-400 font-mono font-bold">€{Number(it.win_amount).toFixed(2)}</span>
          <button onClick={() => onReprint(it.ticket_code)} className="text-slate-400 hover:text-white" title="Ristampa">Stampa</button>
        </div>
      ))}
    </div>
  );
}
