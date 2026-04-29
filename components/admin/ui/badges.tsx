"use client";

import React from "react";

// E9 — Source / Status / Confidence / Extracted-by badge primitives.
// These mirror the pre-existing ones in components/admin/normalization/primitives.tsx
// but live under the shared admin/ui package so they can be used everywhere.

export const SOURCE_COLORS: Record<string, string> = {
  kambi: "#8b5cf6",
  "22bet": "#f97316",
  betfair: "#eab308",
};

export function SourceBadge({ source, size = "sm" }: { source: string; size?: "sm" | "md" }) {
  const color = SOURCE_COLORS[source] ?? "#64748b";
  const pad = size === "md" ? "3px 10px" : "2px 8px";
  const fs = size === "md" ? 11 : 10;
  return (
    <span style={{
      display: "inline-block",
      padding: pad,
      borderRadius: 999,
      fontSize: fs,
      fontWeight: 700,
      color,
      background: `${color}22`,
      border: `1px solid ${color}55`,
      textTransform: "uppercase",
      letterSpacing: 0.3,
    }}>
      {source}
    </span>
  );
}

export function StatusBadge({
  label,
  color,
  size = "sm",
  tone = "soft",
}: {
  label: string;
  color: string;
  size?: "sm" | "md";
  tone?: "soft" | "solid";
}) {
  const pad = size === "md" ? "3px 10px" : "1px 6px";
  const fs = size === "md" ? 11 : 10;
  const isSolid = tone === "solid";
  return (
    <span style={{
      display: "inline-block",
      padding: pad,
      borderRadius: 4,
      fontSize: fs,
      fontWeight: 700,
      color: isSolid ? "#fff" : color,
      background: isSolid ? color : `${color}22`,
      border: `1px solid ${isSolid ? color : `${color}55`}`,
    }}>
      {label}
    </span>
  );
}

export function ConfidenceCell({ confidence }: { confidence: number | null }) {
  let bg = "transparent";
  if (confidence != null) {
    if (confidence > 85) bg = "#10b98130";
    else if (confidence >= 50) bg = "#eab30830";
    else bg = "#ef444430";
  }
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      background: bg,
      fontVariantNumeric: "tabular-nums",
    }}>
      {confidence ?? "—"}
    </span>
  );
}

const EXTRACTED_BY_MAP: Record<string, string> = {
  regex: "rx",
  dictionary: "dc",
  propagation: "xs",
  fuzzy: "fz",
  llm: "ai",
  manual: "MAN",
  trigram: "tri",
  alias_dict: "al",
  flashscore_native: "fs",
};

export function ExtractedByBadge({ extracted_by }: { extracted_by: string | null }) {
  if (!extracted_by) return <span style={{ color: "var(--admin-text-muted)" }}>—</span>;
  const label = EXTRACTED_BY_MAP[extracted_by] ?? extracted_by;
  return (
    <span style={{
      fontSize: 10,
      fontFamily: "monospace",
      color: "var(--admin-text-muted)",
      textTransform: "uppercase",
    }}>
      {label}
    </span>
  );
}
