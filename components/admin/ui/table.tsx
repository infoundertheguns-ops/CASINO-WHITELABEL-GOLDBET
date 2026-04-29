"use client";

import React from "react";

// E9 — Shared Table primitive with consistent styling.
// Not a data-grid — just canonical Th/Td/Tbody wrapper.

export function AdminTable({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)", ...style }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        {children}
      </table>
    </div>
  );
}

export function AdminThead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>{children}</tr>
    </thead>
  );
}

export function AdminTh({
  children, align = "left", style, width,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  style?: React.CSSProperties;
  width?: number | string;
}) {
  return (
    <th style={{
      padding: "8px 10px",
      textAlign: align,
      fontSize: 10,
      textTransform: "uppercase",
      color: "var(--admin-text-muted)",
      fontWeight: 700,
      letterSpacing: 0.5,
      width,
      ...style,
    }}>
      {children}
    </th>
  );
}

export function AdminTd({ children, align, style }: { children: React.ReactNode; align?: "left" | "right" | "center"; style?: React.CSSProperties }) {
  return (
    <td style={{
      padding: "6px 10px",
      color: "var(--admin-text)",
      textAlign: align,
      ...style,
    }}>
      {children}
    </td>
  );
}

export function AdminTr({ children, dirty, onClick, style }: {
  children: React.ReactNode;
  dirty?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <tr
      onClick={onClick}
      style={{
        borderTop: "1px solid var(--admin-border)",
        background: dirty ? "rgba(249,115,22,0.04)" : undefined,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </tr>
  );
}

export function AdminEmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>
        {children}
      </td>
    </tr>
  );
}
