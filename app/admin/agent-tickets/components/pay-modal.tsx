"use client";
import { useEffect } from "react";

interface Props {
  open: boolean;
  amount: number;
  ticketCode: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PayModal({ open, amount, ticketCode, loading, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onConfirm(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-8 max-w-md w-full mx-4">
        <div className="text-xl font-bold mb-2 text-white">Conferma pagamento</div>
        <div className="text-slate-300 mb-6">
          Stai per pagare al cliente:
          <div className="mt-3 text-center">
            <div className="font-mono text-3xl font-black text-emerald-400">€{amount.toFixed(2)}</div>
            <div className="font-mono text-sm text-amber-400 mt-1">{ticketCode}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={loading} className="flex-1 py-3 rounded bg-slate-700 hover:bg-slate-600 text-white">
            Annulla (ESC)
          </button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 py-3 rounded bg-emerald-500 hover:bg-emerald-600 text-white font-bold">
            Conferma (ENTER)
          </button>
        </div>
      </div>
    </div>
  );
}
