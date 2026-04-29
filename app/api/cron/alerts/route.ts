export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  checkAndTransition,
  checkBinaryTransition,
  alertWarning,
  alertRecovery,
  getAlertState,
} from "@/lib/telegram";

// ═══════════════════════════════════════════════════
// CRON: Alert Check (every 2 min via crontab)
// Checks all subsystems, sends alerts only on state transitions.
// ═══════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const alerts: string[] = [];

  try {
    // ── Fetch health from internal endpoint ──
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const healthResp = await fetch(`${baseUrl}/api/system/health`, {
      cache: "no-store",
    });

    if (!healthResp.ok) {
      alerts.push("Health endpoint unreachable");
      return NextResponse.json({ alerts, error: "health_fetch_failed" });
    }

    const health = await healthResp.json();
    const scores = health.scores;
    const metrics = health.metrics;

    if (!scores || !metrics) {
      return NextResponse.json({ alerts, error: "health_data_missing" });
    }

    // ── Check 1: Odds-API Live ──
    const scraperLiveScore = scores.subsystems?.oddsapi_live?.score ?? scores.subsystems?.kambi_live?.score ?? 100;
    const sent1 = await checkAndTransition(
      "scraper_live",
      scraperLiveScore,
      50,  // critical threshold
      70,  // warning threshold
      80,  // healthy threshold
      "SCRAPER LIVE"
    );
    if (sent1) alerts.push(`scraper_live: ${scraperLiveScore}`);

    // ── Check 2: Odds-API Prematch ──
    const scraperPrematchScore = scores.subsystems?.oddsapi_prematch?.score ?? scores.subsystems?.kambi_prematch?.score ?? 100;
    const sent2 = await checkAndTransition(
      "scraper_prematch",
      scraperPrematchScore,
      50,
      70,
      80,
      "SCRAPER PREMATCH"
    );
    if (sent2) alerts.push(`scraper_prematch: ${scraperPrematchScore}`);

    // ── Check 3: Health Complessivo ──
    const overall = scores.overall ?? 100;
    const sent3 = await checkAndTransition(
      "system_health",
      overall,
      50,  // critical
      70,  // warning
      80,  // healthy
      "SISTEMA"
    );
    if (sent3) alerts.push(`system_health: ${overall}`);

    // ── Check 4: Redis Pipeline ──
    const redisScore = scores.subsystems?.redis_pipeline?.score ?? 100;
    const sent4 = await checkAndTransition(
      "redis_down",
      redisScore,
      50,
      70,
      80,
      "REDIS PIPELINE"
    );
    if (sent4) alerts.push(`redis_pipeline: ${redisScore}`);

    // ── Check 5: Odds-API Ingester ──
    const oddsApiPrematch = metrics.events?.oddsapi_prematch ?? metrics.events?.kambi_prematch ?? 0;
    const oddsApiLive = metrics.events?.oddsapi_live ?? metrics.events?.kambi_live ?? 0;
    const oddsApiTotal = oddsApiPrematch + oddsApiLive;
    const sent5 = await checkBinaryTransition(
      "odds_api_ingester",
      oddsApiTotal > 0,
      "ODDS-API INGESTER",
      `Nessun evento Odds-API in DB (prematch: ${oddsApiPrematch}, live: ${oddsApiLive})`,
      `Odds-API dati tornati: ${oddsApiTotal} eventi`
    );
    if (sent5) alerts.push(`odds_api_ingester: ${oddsApiTotal > 0 ? "up" : "down"}`);

    // ── Check 6: Flashscore Scraper ──
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { count: fsRecentCount } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .not("flashscore_id", "is", null)
      .gte("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

    const fsCount = fsRecentCount ?? 0;
    const sent6 = await checkBinaryTransition(
      "flashscore_scraper",
      fsCount > 0,
      "FLASHSCORE SCRAPER",
      "Nessun evento Flashscore aggiornato negli ultimi 30 min",
      `Flashscore attivo: ${fsCount} eventi aggiornati`
    );
    if (sent6) alerts.push(`flashscore_scraper: ${fsCount > 0 ? "up" : "down"}`);

    // ── Check 7: Settlement Backlog ──
    const backlog = metrics.quality?.finished_backlog ?? 0;
    const prevBacklog = getAlertState("settlement_backlog");
    const backlogHigh = backlog > 200;
    const wasHigh = prevBacklog && (prevBacklog.level === "warning" || prevBacklog.level === "critical");

    if (backlogHigh && !wasHigh) {
      const sent7 = await alertWarning(
        "SETTLEMENT BACKLOG",
        `${backlog} eventi finished in attesa di settlement`,
        "settlement_backlog"
      );
      if (sent7) alerts.push(`settlement_backlog: ${backlog}`);
    } else if (!backlogHigh && wasHigh) {
      const sent7 = await alertRecovery(
        "SETTLEMENT BACKLOG RISOLTO",
        `Backlog ridotto a ${backlog} eventi`,
        "settlement_backlog"
      );
      if (sent7) alerts.push(`settlement_backlog: recovered`);
    }

    // ── Check 8: Settlement Health ──
    try {
      const shResp = await fetch(`${baseUrl}/api/admin/settlement-health`, { cache: "no-store" });
      if (shResp.ok) {
        const sh = await shResp.json();
        const shScore = sh.health_score ?? 100;
        const sent8sh = await checkAndTransition(
          "settlement_health",
          shScore,
          50,   // critical
          70,   // warning
          80,   // healthy
          "SETTLEMENT HEALTH"
        );
        if (sent8sh) alerts.push(`settlement_health: ${shScore}`);
      }
    } catch (err) {
      console.error("[cron/alerts] settlement health check error:", err);
    }

    // ── Check 9: Market Coverage (gap-based from DB) ──
    const coverageScores: Record<string, number> = {};
    try {
      const { data: coverageData } = await supabase.rpc("get_market_coverage").single() as { data: any };
      if (coverageData?.summary) {
        for (const row of coverageData.summary) {
          // Only check rows with source data and ≥10 events
          if (row.events_with_source < 10 || row.gap_pct == null) continue;

          // gap_pct is "missing %" — convert to coverage score (100 - gap)
          const score = Math.max(0, Math.round(100 - row.gap_pct));
          const key = `${row.sport_slug}_${row.status}`;
          coverageScores[key] = score;

          const sent8 = await checkAndTransition(
            `market_coverage:${key}`,
            score,
            40,   // critical
            60,   // warning
            80,   // healthy
            `MARKET COVERAGE ${row.sport_name.toUpperCase()} ${row.status.toUpperCase()}`
          );
          if (sent8) alerts.push(`market_coverage:${key}: ${score}%`);
        }
      }
    } catch (err) {
      console.error("[cron/alerts] market coverage check error:", err);
    }

    return NextResponse.json({
      ok: true,
      overall,
      scraper_live: scraperLiveScore,
      scraper_prematch: scraperPrematchScore,
      redis: redisScore,
      odds_api_events: oddsApiTotal,
      flashscore_recent: fsCount,
      settlement_backlog: backlog,
      market_coverage: coverageScores,
      alerts_sent: alerts,
    });

  } catch (err) {
    console.error("[cron/alerts] Error:", err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      alerts_sent: alerts,
    }, { status: 500 });
  }
}
