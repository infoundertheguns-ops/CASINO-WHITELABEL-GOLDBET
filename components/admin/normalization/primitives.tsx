"use client";

// E1.F3-lite (2026-04-24) — normalization primitives.
// E9 (2026-04-24) — migrated to re-export from components/admin/ui/.
// Kept as a thin compatibility layer so existing imports from
// "@/components/admin/normalization/primitives" keep working.
// New code should import directly from "@/components/admin/ui".

import React from "react";
import {
  Kpi as SharedKpi,
  KpiRow as SharedKpiRow,
  SourceBadge as SharedSourceBadge,
  StatusBadge,
  ConfidenceCell,
  ExtractedByBadge as SharedExtractedByBadge,
  SOURCE_COLORS as SHARED_SOURCE_COLORS,
} from "@/components/admin/ui";

// ─── Re-exports with normalization-specific names ─────────

export const SOURCE_COLORS = SHARED_SOURCE_COLORS;

export function NormalizationKpiCard(props: React.ComponentProps<typeof SharedKpi>) {
  return <SharedKpi {...props} />;
}

export function NormalizationKpiRow({ children }: { children: React.ReactNode }) {
  return <SharedKpiRow>{children}</SharedKpiRow>;
}

export function SourceBadge(props: React.ComponentProps<typeof SharedSourceBadge>) {
  return <SharedSourceBadge {...props} />;
}

// StatusPill was the old name — alias to StatusBadge.
export function StatusPill({ label, color, size = "sm" }: { label: string; color: string; size?: "sm" | "md" }) {
  return <StatusBadge label={label} color={color} size={size} />;
}

export function ConfBadge({ confidence }: { confidence: number | null }) {
  return <ConfidenceCell confidence={confidence} />;
}

export function ExtractedByBadge(props: React.ComponentProps<typeof SharedExtractedByBadge>) {
  return <SharedExtractedByBadge {...props} />;
}

// ─── EngineRunBar (specific to normalization, not generic enough for /ui) ──

export interface EngineRunBarProps {
  running: boolean;
  onRun: () => void;
  summary?: any;
  label?: string;
  renderSummary?: (summary: any) => React.ReactNode;
  extraControls?: React.ReactNode;
}

export function EngineRunBar({ running, onRun, summary, label = "Run engine", renderSummary, extraControls }: EngineRunBarProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={onRun}
          disabled={running}
          style={{
            padding: "6px 14px",
            background: "#8b5cf6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 12,
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.6 : 1,
          }}
        >
          {running ? `${label} in corso…` : `▶ ${label}`}
        </button>
        {extraControls}
      </div>
      {summary && (
        <div style={{
          padding: 10,
          background: "rgba(139,92,246,0.08)",
          border: "1px solid #8b5cf6",
          borderRadius: 8,
          color: "var(--admin-text)",
          fontSize: 12,
        }}>
          {renderSummary ? renderSummary(summary) : <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 11 }}>{JSON.stringify(summary, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}
