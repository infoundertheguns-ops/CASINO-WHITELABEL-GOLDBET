"use client";

import { useState } from "react";

interface AssignmentDropdownProps {
  currentAssignee?: string;
  onAssign: (adminId: string | null) => Promise<void>;
  admins: { id: string; display_name: string }[];
}

export function AssignmentDropdown({ currentAssignee, onAssign, admins }: AssignmentDropdownProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const current = admins.find(a => a.id === currentAssignee);

  const handleSelect = async (adminId: string | null) => {
    setLoading(true);
    try {
      await onAssign(adminId);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="text-[9px] px-1.5 py-0.5 rounded font-bold truncate max-w-[80px]"
        style={{
          background: current ? "var(--admin-brand-bg, rgba(99,102,241,0.2))" : "var(--admin-bg)",
          color: current ? "rgb(129,140,248)" : "var(--admin-text4)",
          border: "1px solid var(--admin-border)",
        }}
      >
        {loading ? "..." : current?.display_name || "Assegna"}
      </button>

      {open && (
        <div
          className="absolute z-20 right-0 top-full mt-1 w-40 rounded-lg py-1 shadow-lg"
          style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}
        >
          <button
            onClick={() => handleSelect(null)}
            className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-white/5"
            style={{ color: "var(--admin-text4)" }}
          >
            Non assegnato
          </button>
          {admins.map(a => (
            <button
              key={a.id}
              onClick={() => handleSelect(a.id)}
              className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-white/5"
              style={{ color: a.id === currentAssignee ? "rgb(129,140,248)" : "var(--admin-text)" }}
            >
              {a.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
