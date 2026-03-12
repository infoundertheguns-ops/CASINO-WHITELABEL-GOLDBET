"use client";

import type { HealthData } from "./types";
import { levelColor, levelBg, pillScoreColor } from "./helpers";

export function HealthBanner({ health }: { health: HealthData }) {
  const { overall, level, subsystems } = health.scores;
  const color = levelColor(level);

  return (
    <div
      style={{
        background: levelBg(level),
        border: `1px solid ${color}33`,
        borderRadius: 12,
        padding: "24px 28px",
      }}
    >
      {/* Top row: semaphore + score */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 14px ${color}`,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, color: "var(--admin-text)", fontSize: 22 }}>
          System Health
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: 32,
            color,
            fontVariantNumeric: "tabular-nums",
            marginLeft: "auto",
          }}
        >
          {overall}/100
        </span>
      </div>

      {/* Subsystem pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {Object.entries(subsystems).map(([key, sub]) => {
          const c = pillScoreColor(sub.score);
          return (
            <div
              key={key}
              title={sub.details || ""}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: `${c}15`,
                border: `1px solid ${c}30`,
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 14,
              }}
            >
              <span style={{ color: "var(--admin-text3)", fontWeight: 500 }}>
                {sub.label}
              </span>
              <span style={{ color: c, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 16 }}>
                {sub.score}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
