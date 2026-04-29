"use client";

import { useState } from "react";

interface ResolveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (action: string, notes: string) => Promise<void>;
  alertCount: number;
  mode: "single" | "bulk";
}

export function ResolveModal({ isOpen, onClose, onConfirm, alertCount, mode }: ResolveModalProps) {
  const [action, setAction] = useState("resolved");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const actions = [
    { value: "resolved", label: "Risolvi", desc: "Segna come risolto" },
    { value: "dismissed", label: "Ignora", desc: "Falso positivo / non rilevante" },
    { value: "escalated", label: "Escalation", desc: "Richiede attenzione superiore" },
    { value: "block_users", label: "Blocca Utenti", desc: "Blocca account associati" },
    { value: "reduce_limits", label: "Riduci Limiti", desc: "Imposta limite €50 max bet" },
  ];

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(action, notes);
      setNotes("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl p-6" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
        <h3 className="text-sm font-bold mb-4" style={{ color: "var(--admin-text)" }}>
          {mode === "bulk" ? `Azione su ${alertCount} alert` : "Risolvi Alert"}
        </h3>

        <div className="space-y-2 mb-4">
          {actions.map(a => (
            <label key={a.value} className="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-white/5">
              <input
                type="radio"
                name="action"
                value={a.value}
                checked={action === a.value}
                onChange={() => setAction(a.value)}
                className="mt-0.5 accent-brand"
              />
              <div>
                <div className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>{a.label}</div>
                <div className="text-[10px]" style={{ color: "var(--admin-text4)" }}>{a.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Note (opzionale)..."
          rows={3}
          className="w-full rounded-lg px-3 py-2 text-xs resize-none"
          style={{ background: "var(--admin-bg)", color: "var(--admin-text)", border: "1px solid var(--admin-border)" }}
        />

        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold"
            style={{ color: "var(--admin-text4)" }}
          >
            Annulla
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-brand text-white disabled:opacity-50"
          >
            {loading ? "..." : "Conferma"}
          </button>
        </div>
      </div>
    </div>
  );
}
