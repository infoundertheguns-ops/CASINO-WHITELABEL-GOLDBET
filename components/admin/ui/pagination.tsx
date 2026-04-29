"use client";

import React from "react";

// E9 — Shared pagination control.

export function Pagination({
  page,
  totalPages,
  onPage,
  totalRows,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  totalRows?: number;
}) {
  const clamp = (p: number) => Math.max(1, Math.min(totalPages, p));
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", color: "var(--admin-text-muted)", fontSize: 12 }}>
      <span>
        {totalRows != null ? `${totalRows.toLocaleString("it-IT")} righe · ` : ""}
        Pagina {page} di {totalPages}
      </span>
      <Btn disabled={page <= 1} onClick={() => onPage(1)}>«</Btn>
      <Btn disabled={page <= 1} onClick={() => onPage(clamp(page - 1))}>‹</Btn>
      <Btn disabled={page >= totalPages} onClick={() => onPage(clamp(page + 1))}>›</Btn>
      <Btn disabled={page >= totalPages} onClick={() => onPage(totalPages)}>»</Btn>
    </div>
  );
}

function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 10px",
        borderRadius: 5,
        border: "none",
        background: disabled ? "transparent" : "#334155",
        color: disabled ? "var(--admin-text-muted)" : "#fff",
        fontSize: 11,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
