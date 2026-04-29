"use client";

import React, { useEffect } from "react";

// E9 — Shared Toast primitive for success/error feedback.

export interface ToastProps {
  kind: "ok" | "err" | "info";
  text: string;
  onDismiss?: () => void;
  /** Auto-dismiss after N ms (default 4000). Pass 0 to disable. */
  autoDismissMs?: number;
}

export function Toast({ kind, text, onDismiss, autoDismissMs = 4000 }: ToastProps) {
  useEffect(() => {
    if (!autoDismissMs || !onDismiss) return;
    const t = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  const color = kind === "ok" ? "#10b981" : kind === "err" ? "#ef4444" : "#3b82f6";
  return (
    <div style={{
      padding: 10,
      background: `${color}15`,
      border: `1px solid ${color}55`,
      borderRadius: 8,
      color,
      fontSize: 13,
      display: "flex",
      alignItems: "center",
      gap: 10,
    }}>
      <span style={{ flex: 1 }}>
        {kind === "ok" ? "✓ " : kind === "err" ? "✕ " : "ℹ "}
        {text}
      </span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", color, cursor: "pointer", fontSize: 14, fontWeight: 700 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
