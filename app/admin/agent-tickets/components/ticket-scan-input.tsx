"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { normalizeTicketCode } from "../lib/ticket-code";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  loading: boolean;
}

export interface ScanInputHandle { focus: () => void }

export const TicketScanInput = forwardRef<ScanInputHandle, Props>(function TicketScanInput(
  { value, onChange, onSubmit, onReset, loading }, ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-card)] p-5">
      <div className="text-xs uppercase tracking-wide font-bold mb-2" style={{ color: "var(--admin-text)" }}>
        Scansiona o digita il codice ticket
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(normalizeTicketCode(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
            if (e.key === "Escape") { e.preventDefault(); onReset(); }
          }}
          placeholder="TK-XXXXXX"
          className="flex-1 h-14 rounded-lg border border-[var(--admin-border)] bg-[#0a0914] px-4 text-slate-100 font-mono text-xl tracking-[0.2em] text-center font-bold uppercase focus:outline-none focus:border-blue-500"
          autoFocus
        />
        <button
          onClick={onSubmit}
          disabled={loading}
          className="h-14 px-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-50"
        >
          Verifica
        </button>
      </div>
    </div>
  );
});
