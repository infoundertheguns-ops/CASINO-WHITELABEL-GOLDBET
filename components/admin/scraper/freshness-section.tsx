"use client";

import type { HealthData, FreshnessBuckets } from "./types";
import { formatNumFull } from "./helpers";

const BUCKET_KEYS: (keyof FreshnessBuckets)[] = [
  "lt_30s", "30s_2m", "2m_5m", "5m_15m", "15m_30m", "30m_1h", "gt_1h",
];
const BUCKET_LABELS = ["<30s", "30s-2m", "2-5m", "5-15m", "15-30m", "30m-1h", ">1h"];
const BUCKET_COLORS = [
  "#10b981", "#22d3ee", "#3b82f6", "#f59e0b", "#f97316", "#ef4444", "#dc2626",
];

function FreshnessBar({ label, buckets }: { label: string; buckets: FreshnessBuckets | null }) {
  if (!buckets) return null;
  const total = BUCKET_KEYS.reduce((s, k) => s + (buckets[k] || 0), 0);
  if (total === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, color: "var(--admin-text2)", fontWeight: 600, marginBottom: 6 }}>
        {label}{" "}
        <span style={{ color: "var(--admin-text4)", fontWeight: 400 }}>
          ({formatNumFull(total)} mercati)
        </span>
      </div>
      <div style={{
        display: "flex",
        height: 28,
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--admin-border)",
      }}>
        {BUCKET_KEYS.map((k, i) => {
          const val = buckets[k] || 0;
          if (val === 0) return null;
          const pct = (val / total) * 100;
          return (
            <div
              key={k}
              title={`${BUCKET_LABELS[i]}: ${formatNumFull(val)} (${pct.toFixed(1)}%)`}
              style={{
                width: `${pct}%`,
                background: BUCKET_COLORS[i],
                minWidth: pct > 0.5 ? 2 : 0,
                transition: "width 0.3s",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function FreshnessSection({ health }: { health: HealthData }) {
  const of = health.metrics.outcome_freshness;
  if (!of) return null;

  const liveKambi = of.live?.kambi || null;
  const preKambi = of.prematch?.kambi || null;
  const liveTwobet = of.live?.["22bet"] || null;
  const preTwobet = of.prematch?.["22bet"] || null;
  const liveBetfair = of.live?.betfair || null;
  const preBetfair = of.prematch?.betfair || null;
  if (!liveKambi && !preKambi && !liveTwobet && !preTwobet && !liveBetfair && !preBetfair) return null;

  return (
    <>
      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20, fontSize: 13 }}>
        {BUCKET_LABELS.map((lbl, i) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: BUCKET_COLORS[i] }} />
            <span style={{ color: "var(--admin-text3)" }}>{lbl}</span>
          </div>
        ))}
      </div>
      <FreshnessBar label="Kambi Live" buckets={liveKambi} />
      <FreshnessBar label="Kambi Prematch" buckets={preKambi} />
      <FreshnessBar label="22bet Live" buckets={liveTwobet} />
      <FreshnessBar label="22bet Prematch" buckets={preTwobet} />
      <FreshnessBar label="Betfair Live" buckets={liveBetfair} />
      <FreshnessBar label="Betfair Prematch" buckets={preBetfair} />
    </>
  );
}
