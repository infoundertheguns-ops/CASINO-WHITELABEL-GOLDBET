"use client";

import React from "react";

// E9 — Shared Modal primitive. Backdrop click closes by default (can disable).

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 900,
  closeOnBackdrop = true,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: number;
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: `min(${maxWidth}px, 100%)`,
          maxHeight: "90vh",
          overflow: "auto",
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12,
          padding: 20,
          color: "var(--admin-text, #e2e8f0)",
        }}
      >
        {title && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            <button
              onClick={onClose}
              style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text-muted)", cursor: "pointer", fontSize: 16 }}
            >
              ✕
            </button>
          </div>
        )}
        <div>{children}</div>
        {footer && <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}
