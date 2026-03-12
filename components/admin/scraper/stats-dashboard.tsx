"use client";

import { useEffect, useState, useCallback } from "react";
import type { StatsResponse, RedisMetrics, HealthData } from "./types";
import { HealthBanner } from "./health-banner";
import { LeonHeroSection } from "./leon-hero-section";
import { SecondaryScrapers } from "./secondary-scrapers";
import { CoverageKPIs } from "./coverage-kpis";
import { FreshnessSection } from "./freshness-section";
import { RedisPipeline } from "./redis-pipeline";
import { formatNumFull } from "./helpers";

// ═══ COLLAPSIBLE SECTION ═══

function CollapsibleSection({
  title,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background: "var(--admin-card)",
      border: "1px solid var(--admin-border)",
      borderRadius: 12,
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "none",
          border: "none",
          borderBottom: open ? "1px solid var(--admin-border)" : "none",
          cursor: "pointer",
          color: "var(--admin-text)",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 17 }}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {badge}
          <span style={{
            fontSize: 20, color: "var(--admin-text3)",
            transition: "transform 0.2s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
          }}>
            &#9662;
          </span>
        </div>
      </button>
      {open && <div style={{ padding: "20px 24px" }}>{children}</div>}
    </div>
  );
}

// ═══ MAIN DASHBOARD ═══

export default function ScraperStatsDashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [redisMetrics, setRedisMetrics] = useState<RedisMetrics | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Live source toggle state
  const [liveSource, setLiveSource] = useState<"leon" | "goldbet">("leon");
  const [savingSource, setSavingSource] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const [statsResp, redisResp, healthResp, sourceResp] = await Promise.all([
        fetch("/api/scraper/stats"),
        fetch("/api/odds/metrics").catch(() => null),
        fetch("/api/system/health").catch(() => null),
        fetch("/api/config/live-source").catch(() => null),
      ]);
      if (statsResp.ok) setData(await statsResp.json());
      if (redisResp?.ok) setRedisMetrics(await redisResp.json());
      if (healthResp?.ok) setHealthData(await healthResp.json());
      if (sourceResp?.ok) {
        const d = await sourceResp.json();
        if (d.source) setLiveSource(d.source);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleToggleSource = async (newSource: "leon" | "goldbet") => {
    if (newSource === liveSource || savingSource) return;
    setSavingSource(true);
    try {
      const resp = await fetch("/api/config/live-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: newSource }),
      });
      if (resp.ok) setLiveSource(newSource);
    } catch {}
    setSavingSource(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--admin-text3)", fontSize: 18 }}>
        Caricamento...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--admin-text3)", fontSize: 18 }}>
        Errore nel caricamento dei dati
      </div>
    );
  }

  // ─── Disconnected: DB-only ───
  if (!data.connected) {
    const v = data.vincitu_only!;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{
          background: "rgba(239, 68, 68, 0.1)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: 12,
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}>
          <div style={{
            width: 16, height: 16, borderRadius: "50%", background: "#ef4444",
            boxShadow: "0 0 10px #ef4444",
          }} />
          <div>
            <div style={{ color: "#ef4444", fontWeight: 700, fontSize: 18 }}>
              Scraper non connesso
            </div>
            <div style={{ color: "var(--admin-text3)", fontSize: 15 }}>
              Conteggi solo dal DB Vincitu
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {[
            { label: "Live", value: v.live_events, color: "#10b981" },
            { label: "Prematch", value: v.prematch_events, color: "#3b82f6" },
            { label: "Finished", value: v.finished_events, color: "#f59e0b" },
            { label: "Ended", value: v.ended_events, color: "#6b7280" },
          ].map((card) => (
            <div key={card.label} style={{
              background: "var(--admin-card)",
              border: "1px solid var(--admin-border)",
              borderRadius: 12,
              padding: 24,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2, color: "var(--admin-text3)", marginBottom: 10, fontWeight: 600 }}>
                {card.label}
              </div>
              <div style={{ fontSize: 36, fontWeight: 700, color: card.color, fontVariantNumeric: "tabular-nums" }}>
                {formatNumFull(card.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Connected: full dashboard ───
  const leonServer = data.servers?.leon || null;
  const kambiServer = data.servers?.kambi || null;
  const flashscoreServer = data.servers?.flashscore || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* A. Health Banner */}
      {healthData && <HealthBanner health={healthData} />}

      {/* B. Leon Hero Section */}
      <LeonHeroSection
        leonServer={leonServer}
        liveSource={liveSource}
        onToggleSource={handleToggleSource}
        saving={savingSource}
      />

      {/* C. Secondary Scrapers */}
      <SecondaryScrapers
        kambiServer={kambiServer}
        flashscoreServer={flashscoreServer}
      />

      {/* D. Coverage KPIs */}
      <CoverageKPIs leonServer={leonServer} />

      {/* E. Freshness */}
      {healthData && (
        <CollapsibleSection title="Freshness Quote" defaultOpen={false}>
          <FreshnessSection health={healthData} />
        </CollapsibleSection>
      )}

      {/* F. Redis Pipeline */}
      {redisMetrics && redisMetrics.redis.connected && (
        <CollapsibleSection
          title="Redis Pipeline"
          defaultOpen={false}
          badge={
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
              <span style={{ fontSize: 14, color: "var(--admin-text3)" }}>Attivo</span>
            </div>
          }
        >
          <RedisPipeline metrics={redisMetrics} />
        </CollapsibleSection>
      )}

      {/* Refresh indicator */}
      <div style={{ textAlign: "right", fontSize: 13, color: "var(--admin-text4)" }}>
        Auto-refresh ogni 30s &mdash; Ultimo: {lastRefresh.toLocaleTimeString("it-IT")}
      </div>
    </div>
  );
}
