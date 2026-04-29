"use client";

import React from "react";

// E9 — Shared admin Kpi primitive (generic version of the normalization one).
// Use <KpiRow> to wrap multiple cards in a responsive grid.

export interface KpiProps {
  label: React.ReactNode;
  value: React.ReactNode;
  accent?: string;
  sub?: string;
  /** When set, renders the Kpi as a link. */
  href?: string;
  /** When set, renders a click handler and shows pointer cursor. */
  onClick?: () => void;
  /** Smaller variant. */
  small?: boolean;
}

export function Kpi({ label, value, accent, sub, href, onClick, small }: KpiProps) {
  const content = (
    <>
      <div style={{ fontSize: 10, color: "var(--admin-text-muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{
        fontSize: small ? 14 : 22,
        fontWeight: 800,
        color: accent || "var(--admin-text)",
        fontVariantNumeric: "tabular-nums",
        marginTop: 2,
        fontFamily: small ? "monospace" : undefined,
      }}>
        {typeof value === "number" ? value.toLocaleString("it-IT") : value}
      </div>
      {sub && <div style={{ fontSize: 10, color: "var(--admin-text-muted)", marginTop: 2 }}>{sub}</div>}
      {href && <div style={{ fontSize: 10, color: accent || "#8b5cf6", marginTop: 2, fontWeight: 700 }}>apri →</div>}
    </>
  );

  const style: React.CSSProperties = {
    padding: small ? "8px 12px" : "12px 16px",
    border: "1px solid var(--admin-border)",
    borderRadius: 10,
    background: "var(--admin-card)",
    borderLeft: `3px solid ${accent || "#334155"}`,
    cursor: href || onClick ? "pointer" : "default",
    textDecoration: "none",
    color: "inherit",
    display: "block",
  };

  if (href) return <a href={href} style={style}>{content}</a>;
  if (onClick) return <button onClick={onClick} style={{ ...style, border: "1px solid var(--admin-border)", textAlign: "left", width: "100%" }}>{content}</button>;
  return <div style={style}>{content}</div>;
}

export function KpiRow({ children, minWidth = 160 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
      gap: 10,
    }}>
      {children}
    </div>
  );
}
