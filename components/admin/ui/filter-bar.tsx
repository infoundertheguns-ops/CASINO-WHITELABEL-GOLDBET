"use client";

import React from "react";

// E9 — FilterBar standardizes the visual appearance of filter toolbars.
// Wraps children in the consistent card-like container seen on most admin pages.

export function FilterBar({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      display: "flex",
      gap: 12,
      alignItems: "center",
      padding: 12,
      border: "1px solid var(--admin-border)",
      borderRadius: 10,
      background: "var(--admin-card)",
      flexWrap: "wrap",
      ...style,
    }}>
      {children}
    </div>
  );
}

export function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      color: "var(--admin-text-muted)",
      letterSpacing: 0.5,
    }}>
      {children}
    </span>
  );
}

export function AdminSelect({
  value, onChange, options, label, ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  label?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label && <FilterLabel>{label}</FilterLabel>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 10px",
          border: "1px solid var(--admin-border)",
          borderRadius: 6,
          background: "var(--admin-bg)",
          color: "var(--admin-text)",
          fontSize: 12,
          minWidth: 140,
          ...rest.style,
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function AdminSearchInput({
  value, onChange, placeholder, style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        flex: 1,
        minWidth: 200,
        padding: "8px 12px",
        border: "1px solid var(--admin-border)",
        borderRadius: 6,
        background: "var(--admin-bg)",
        color: "var(--admin-text)",
        fontSize: 13,
        ...style,
      }}
    />
  );
}

export function AdminCheckboxLabel({
  checked, onChange, children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      color: "var(--admin-text-muted)",
      fontSize: 12,
      cursor: "pointer",
    }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
