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

    // ── Check 1: Scraper Live ──
    const scraperLiveScore = scores.subsystems?.scraper_live?.score ?? 100;
    const sent1 = await checkAndTransition(
      "scraper_live",
      scraperLiveScore,
      50,  // critical threshold
      70,  // warning threshold
      80,  // healthy threshold
      "SCRAPER LIVE"
    );
    if (sent1) alerts.push(`scraper_live: ${scraperLiveScore}`);

    // ── Check 2: Scraper Prematch ──
    const scraperPrematchScore = scores.subsystems?.scraper_prematch?.score ?? 100;
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

    // ── Check 5: Kambi Scraper ──
    const kambiPrematch = metrics.events?.kambi_prematch ?? 0;
    const kambiLive = metrics.events?.kambi_live ?? 0;
    const kambiTotal = kambiPrematch + kambiLive;
    const sent5 = await checkBinaryTransition(
      "kambi_scraper",
      kambiTotal > 0,
      "KAMBI SCRAPER",
      `Nessun evento Kambi in DB (prematch: ${kambiPrematch}, live: ${kambiLive})`,
      `Kambi dati tornati: ${kambiTotal} eventi`
    );
    if (sent5) alerts.push(`kambi_scraper: ${kambiTotal > 0 ? "up" : "down"}`);

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
    const backlogHigh = backlog > 20;
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

    // ── Check 8: Market Coverage ──
    const coverageScores: Record<string, number> = {};
    try {
      const { data: coverageData } = await supabase.rpc("get_market_coverage").single() as { data: any };
      if (coverageData?.summary) {
        // Build goldbet avg from scraper snapshots
        const g = globalThis as any;
        const snapshotsBySource: Record<string, any[]> = g.__scraperSnapshotsBySource || {};
        const scraperAvg: Record<string, { live: number; prematch: number }> = {};

        for (const [, snapshots] of Object.entries(snapshotsBySource)) {
          if (!snapshots || snapshots.length === 0) continue;
          const latest = snapshots[snapshots.length - 1];
          if (!latest?.by_sport) continue;
          for (const [sportName, sportData] of Object.entries(latest.by_sport as Record<string, any>)) {
            const gb = (sportData as any).goldbet;
            if (!gb) continue;
            const liveAvg = gb.live?.events > 0 ? gb.live.markets / gb.live.events : 0;
            const prematchAvg = gb.prematch?.events > 0 ? gb.prematch.markets / gb.prematch.events : 0;
            scraperAvg[sportName] = {
              live: Math.max(scraperAvg[sportName]?.live || 0, liveAvg),
              prematch: Math.max(scraperAvg[sportName]?.prematch || 0, prematchAvg),
            };
          }
        }

        // Per-sport coverage check (only goldbet with ≥10 events)
        for (const row of coverageData.summary) {
          if (row.source !== "goldbet" || row.total_events < 10) continue;
          const gbAvg = scraperAvg[row.sport_name];
          if (!gbAvg) continue;
          const goldbetAvg = row.status === "live" ? gbAvg.live : gbAvg.prematch;
          if (goldbetAvg <= 0) continue;

          const score = Math.round((row.avg_markets / goldbetAvg) * 100);
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
      kambi_events: kambiTotal,
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
