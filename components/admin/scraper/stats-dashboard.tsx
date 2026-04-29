"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { StatsResponse, RedisMetrics, HealthData } from "./types";
import { HealthBanner } from "./health-banner";
import { KambiHeroSection } from "./kambi-hero-section";
import { TwobetHeroSection } from "./twobet-hero-section";
import { BetfairHeroSection } from "./betfair-hero-section";
import { SecondaryScrapers } from "./secondary-scrapers";
import { FreshnessSection } from "./freshness-section";
import { RedisPipeline } from "./redis-pipeline";
import { formatNumFull } from "./helpers";

// ═══ COLLAPSIBLE SECTION (E7: anchor + hash deep-link) ═══

function CollapsibleSection({
  id,
  title,
  defaultOpen = true,
  badge,
  children,
}: {
  id?: string;
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionRef = useRef<HTMLDivElement>(null);

  // E7: if URL hash matches this section's id, force-open and scroll into view.
  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    const applyHash = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [id]);

  return (
    <div id={id} ref={sectionRef} style={{
      background: "var(--admin-card)",
      border: "1px solid var(--admin-border)",
      borderRadius: 12,
      overflow: "hidden",
      scrollMarginTop: 16,
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
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    setRefreshing(true);
    // Review #5 P1-A/B/C: allSettled keeps the dashboard alive when Redis or
    // Health endpoints are flaky, error message surfaces to UI, lastRefresh
    // only updates on a non-empty success.
    const settled = await Promise.allSettled([
      fetch("/api/scraper/stats"),
      fetch("/api/odds/metrics"),
      fetch("/api/system/health"),
    ]);
    const [statsRes, redisRes, healthRes] = settled;
    const errors: string[] = [];

    let primaryOk = false;
    if (statsRes.status === "fulfilled" && statsRes.value.ok) {
      try {
        setData(await statsRes.value.json());
        primaryOk = true;
      } catch (e: any) { errors.push(`stats parse: ${e?.message ?? e}`); }
    } else {
      const reason = statsRes.status === "rejected"
        ? (statsRes.reason?.message ?? String(statsRes.reason))
        : `HTTP ${statsRes.value.status}`;
      errors.push(`stats: ${reason}`);
    }

    if (redisRes.status === "fulfilled" && redisRes.value.ok) {
      try { setRedisMetrics(await redisRes.value.json()); }
      catch (e: any) { errors.push(`redis parse: ${e?.message ?? e}`); }
    } else if (redisRes.status === "rejected") {
      errors.push(`redis: ${redisRes.reason?.message ?? String(redisRes.reason)}`);
    }

    if (healthRes.status === "fulfilled" && healthRes.value.ok) {
      try { setHealthData(await healthRes.value.json()); }
      catch (e: any) { errors.push(`health parse: ${e?.message ?? e}`); }
    } else if (healthRes.status === "rejected") {
      errors.push(`health: ${healthRes.reason?.message ?? String(healthRes.reason)}`);
    }

    setFetchError(errors.length > 0 ? errors.join(" · ") : null);
    if (primaryOk) setLastRefresh(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

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
    const v = data.betssolution_only!;
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
  const kambiServer = data.servers?.kambi || null;
  const twobetServer = data.servers?.["22bet"] || null;
  const betfairServer = data.servers?.betfair || null;
  const flashscoreServer = data.servers?.flashscore || null;
  const betfairScores = healthData?.betfair_scores ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Anchor nav (E7: deep-link to any section + cross-page link to Settlement Health) */}
      <SectionNav
        items={[
          kambiServer ? { href: "#kambi", label: "Kambi", color: "#f0b429" } : null,
          twobetServer ? { href: "#twobet", label: "22bet", color: "#f97316" } : null,
          betfairServer ? { href: "#betfair", label: "Betfair", color: "#fbbf24" } : null,
          flashscoreServer ? { href: "#flashscore", label: "Flashscore", color: "#06b6d4" } : null,
          healthData ? { href: "#freshness", label: "Freshness", color: "#8b5cf6" } : null,
          redisMetrics?.redis?.connected ? { href: "#redis", label: "Redis", color: "#10b981" } : null,
          // Review #5 P2-D: cross-page drill to Settlement Health.
          { href: "/admin/settlement-health", label: "Settlement →", color: "#06b6d4" },
        ].filter(Boolean) as Array<{ href: string; label: string; color: string }>}
      />

      {/* P1-A: surface fetch failures (was silently swallowed). */}
      {fetchError && (
        <div style={{
          padding: "10px 14px",
          background: "rgba(239,68,68,0.1)",
          border: "1px solid rgba(239,68,68,0.4)",
          borderRadius: 8,
          color: "#fca5a5",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ fontWeight: 700 }}>⚠ Errore fetch</span>
          <span style={{ fontFamily: "monospace", fontSize: 11 }}>{fetchError}</span>
        </div>
      )}

      {/* A. Health Banners (Kambi primary + 22bet secondary) */}
      {healthData && (
        <HealthBanner title="Kambi — System Health" scores={healthData.scores} />
      )}
      {healthData?.twobet_scores && (
        <HealthBanner
          title="22bet — System Health"
          scores={healthData.twobet_scores}
          accent="#f97316"
        />
      )}
      {betfairScores && (
        <HealthBanner
          title="Betfair — System Health"
          scores={betfairScores}
          accent="#fbbf24"
        />
      )}

      {/* B. Kambi Hero Section */}
      <CollapsibleSection id="kambi" title="Kambi Scraper">
        <KambiHeroSection server={kambiServer} />
      </CollapsibleSection>

      {/* B2. 22bet Hero Section */}
      {twobetServer && (
        <CollapsibleSection id="twobet" title="22bet Scraper">
          <TwobetHeroSection server={twobetServer} />
        </CollapsibleSection>
      )}

      {/* B3. Betfair Exchange Hero Section (review #5 — was missing) */}
      {betfairServer && (
        <CollapsibleSection id="betfair" title="Betfair Exchange">
          <BetfairHeroSection server={betfairServer} />
        </CollapsibleSection>
      )}

      {/* C. Flashscore (single source of truth — settlement-health links here) */}
      <CollapsibleSection id="flashscore" title="Flashscore Scraper">
        <SecondaryScrapers flashscoreServer={flashscoreServer} />
      </CollapsibleSection>

      {/* D. Freshness */}
      {healthData && (
        <CollapsibleSection id="freshness" title="Freshness Quote" defaultOpen={false}>
          <FreshnessSection health={healthData} />
        </CollapsibleSection>
      )}

      {/* E. Redis Pipeline */}
      {redisMetrics && redisMetrics.redis.connected && (
        <CollapsibleSection
          id="redis"
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

      {/* Refresh indicator (P1-C: lastRefresh shows last SUCCESS, not last attempt). */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, fontSize: 13, color: "var(--admin-text4)" }}>
        <span>
          Auto-refresh ogni 30s &mdash; Ultimo successo: {lastRefresh ? lastRefresh.toLocaleTimeString("it-IT") : "—"}
        </span>
        <button
          onClick={fetchStats}
          disabled={refreshing}
          aria-label="Refresh ora"
          title="Refresh ora"
          style={{
            padding: "4px 10px",
            background: "transparent",
            border: "1px solid var(--admin-border)",
            color: "var(--admin-text3)",
            borderRadius: 6,
            fontSize: 12,
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          {refreshing ? "…" : "↻ Refresh"}
        </button>
      </div>
    </div>
  );
}

// ═══ SECTION NAV (E7: anchor links for quick jump) ═══

function SectionNav({ items }: { items: Array<{ href: string; label: string; color: string }> }) {
  if (items.length === 0) return null;
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      padding: "8px 12px",
      background: "var(--admin-card)",
      border: "1px solid var(--admin-border)",
      borderRadius: 10,
    }}>
      <span style={{ fontSize: 11, color: "var(--admin-text4)", textTransform: "uppercase", letterSpacing: 0.5, alignSelf: "center", marginRight: 8 }}>
        Vai a:
      </span>
      {items.map((it) => (
        <a key={it.href} href={it.href} style={{
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 700,
          color: it.color,
          background: `${it.color}18`,
          border: `1px solid ${it.color}44`,
          borderRadius: 999,
          textDecoration: "none",
        }}>
          {it.label}
        </a>
      ))}
    </div>
  );
}
