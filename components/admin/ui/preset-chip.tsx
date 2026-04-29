"use client";

import React from "react";

// E9 — PresetChip — pill-style filter toggle, used e.g. in Fixtures for date presets.

export function PresetChip({
  label, active, onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? "#2563eb" : "var(--admin-border, #1e3a5f)"}`,
        background: active ? "rgba(37,99,235,0.15)" : "transparent",
        color: active ? "#93c5fd" : "var(--admin-text-muted, #94a3b8)",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
