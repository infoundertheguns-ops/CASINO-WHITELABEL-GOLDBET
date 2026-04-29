"use client";

import type { HealthScores } from "./types";
import { levelColor, levelBg, pillScoreColor } from "./helpers";

interface HealthBannerProps {
  scores: HealthScores;
  title?: string;
  accent?: string; // override for the left border + dot (e.g. 22bet orange)
}

// Review #5 P2-F: subsystem pills drill-through to the matching dashboard
// section. Keys come from the scraper-vps health endpoint; this mapping is
// best-effort — unknown keys render as plain (non-link) pills.
function subsystemAnchor(key: string): string | null {
  const k = key.toLowerCase();
  if (k.includes("kambi")) return "#kambi";
  if (k.includes("22bet") || k.includes("twobet")) return "#twobet";
  if (k.includes("betfair")) return "#betfair";
  if (k.includes("flashscore")) return "#flashscore";
  if (k.includes("redis") || k.includes("cache")) return "#redis";
  if (k.includes("fresh") || k.includes("latency") || k.includes("staleness")) return "#freshness";
  return null;
}

export function HealthBanner({ scores, title = "System Health", accent }: HealthBannerProps) {
  const { overall, level, subsystems } = scores;
  const semaphoreColor = accent || levelColor(level);
  const borderBg = levelBg(level);

  return (
    <div
      style={{
        background: borderBg,
        border: `1px solid ${semaphoreColor}33`,
        borderLeft: `4px solid ${semaphoreColor}`,
        borderRadius: 12,
        padding: "24px 28px",
      }}
    >
      {/* Top row: semaphore + title + score */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: semaphoreColor,
            boxShadow: `0 0 14px ${semaphoreColor}`,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, color: "var(--admin-text)", fontSize: 22 }}>
          {title}
        </span>
        <span
          style={{
            fontWeight: 700,
            fontSize: 32,
            color: semaphoreColor,
            fontVariantNumeric: "tabular-nums",
            marginLeft: "auto",
          }}
        >
          {overall}/100
        </span>
      </div>

      {/* Subsystem pills — drill-through to matching anchor when known. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {Object.entries(subsystems).map(([key, sub]) => {
          const c = pillScoreColor(sub.score);
          const anchor = subsystemAnchor(key);
          const baseStyle: React.CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: `${c}15`,
            border: `1px solid ${c}30`,
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 14,
            textDecoration: "none",
          };
          const inner = (
            <>
              <span style={{ color: "var(--admin-text3)", fontWeight: 500 }}>
                {sub.label}
              </span>
              <span style={{ color: c, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 16 }}>
                {sub.score}
              </span>
              {anchor && (
                <span style={{ color: c, fontSize: 11, opacity: 0.7 }}>↓</span>
              )}
            </>
          );
          if (anchor) {
            return (
              <a key={key} href={anchor} title={sub.details || `Vai a ${sub.label}`} style={{ ...baseStyle, cursor: "pointer" }}>
                {inner}
              </a>
            );
          }
          return (
            <div key={key} title={sub.details || ""} style={baseStyle}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
