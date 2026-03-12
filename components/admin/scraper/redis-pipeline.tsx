"use client";

import type { RedisMetrics } from "./types";
import { formatBytes } from "./helpers";
import { Sparkline } from "./sparkline";

export function RedisPipeline({ metrics }: { metrics: RedisMetrics }) {
  const { redis, odds, throughput_history } = metrics;

  const sparkCps = throughput_history.map((h) => h.cps);
  const sparkQueue = throughput_history.map((h) => h.queue);

  const cards = [
    { label: "Quote/sec", value: String(odds.changes_per_second), color: "#8b5cf6", spark: sparkCps },
    { label: "Latenza Redis", value: `${redis.latency_ms}ms`, color: redis.latency_ms <= 5 ? "#10b981" : "#f59e0b" },
    { label: "Client SSE", value: String(odds.sse_clients), color: "#3b82f6" },
    { label: "Coda Supabase", value: String(odds.write_queue_depth), color: odds.write_queue_depth > 100 ? "#ef4444" : "#10b981", spark: sparkQueue },
    { label: "Memoria Redis", value: formatBytes(redis.memory_used), color: "#6366f1" },
    { label: "Eventi in cache", value: String(odds.active_events), color: "#06b6d4" },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: 16,
    }}>
      {cards.map((card) => (
        <div
          key={card.label}
          style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: 8,
            padding: "16px 20px",
          }}
        >
          <div style={{
            fontSize: 13, textTransform: "uppercase", letterSpacing: 1,
            color: "var(--admin-text3)", marginBottom: 8, fontWeight: 600,
          }}>
            {card.label}
          </div>
          <div style={{
            fontSize: 28, fontWeight: 700, color: card.color,
            fontVariantNumeric: "tabular-nums", lineHeight: 1.1,
          }}>
            {card.value}
          </div>
          {card.spark && card.spark.length >= 2 && (
            <div style={{ marginTop: 8 }}>
              <Sparkline data={card.spark} color={card.color} width={110} height={28} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
