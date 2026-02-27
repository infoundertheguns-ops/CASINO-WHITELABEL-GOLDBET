#!/usr/bin/env tsx
/**
 * Test All Market Types — Settlement Coverage Test
 * Places one bet per unique market type across multiple sports
 * to verify settlement works on all market patterns.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Test user to use
const TEST_USER = "rec_player_1";
const TEST_EMAIL = "rec_player_1@test.vincitu.local";
const TEST_PASSWORD = "TestPass123!rec1";

// Target events per sport (will be filled dynamically)
interface TargetEvent {
  eventId: string;
  sport: string;
  match: string;
}

async function getTargetEvents(): Promise<TargetEvent[]> {
  const onlySports = process.argv.find(a => a.startsWith("--sports="))?.split("=")[1]?.split(",");
  const sports = onlySports || ["Calcio", "Tennis", "Basket", "Volley", "Hockey Ghiaccio", "Pallamano"];
  const targets: TargetEvent[] = [];

  for (const sport of sports) {
    const { data } = await supabase
      .from("events")
      .select("id, home_team, away_team, sport_id, sports!inner(name)")
      .eq("is_live", true)
      .eq("status", "live")
      .eq("sports.name", sport)
      .limit(100);

    if (!data || data.length === 0) continue;

    // Pick event with most active markets
    let bestEvent = null;
    let bestCount = 0;

    for (const ev of data) {
      const { count } = await supabase
        .from("markets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", ev.id)
        .eq("is_active", true);

      if (count && count > bestCount) {
        bestCount = count;
        bestEvent = ev;
      }
    }

    if (bestEvent) {
      targets.push({
        eventId: bestEvent.id,
        sport,
        match: `${bestEvent.home_team} vs ${bestEvent.away_team}`,
      });
    }
  }

  return targets;
}

interface MarketWithOutcome {
  marketId: string;
  marketType: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  line: number | null;
}

async function getMarketsForEvent(eventId: string): Promise<MarketWithOutcome[]> {
  // Get all active markets with one outcome each
  const { data: markets } = await supabase
    .from("markets")
    .select("id, market_type, line")
    .eq("event_id", eventId)
    .eq("is_active", true);

  if (!markets) return [];

  // Deduplicate by market_type (keep first)
  const seenTypes = new Set<string>();
  const uniqueMarkets = markets.filter((m) => {
    if (seenTypes.has(m.market_type)) return false;
    seenTypes.add(m.market_type);
    return true;
  });

  const result: MarketWithOutcome[] = [];

  for (const mkt of uniqueMarkets) {
    // Get first active outcome with valid odds
    const { data: outcomes } = await supabase
      .from("outcomes")
      .select("id, name, odds")
      .eq("market_id", mkt.id)
      .eq("is_active", true)
      .gt("odds", 1.01)
      .lt("odds", 50)
      .limit(1);

    if (outcomes && outcomes.length > 0) {
      result.push({
        marketId: mkt.id,
        marketType: mkt.market_type,
        outcomeId: outcomes[0].id,
        outcomeName: outcomes[0].name,
        odds: outcomes[0].odds,
        line: mkt.line,
      });
    }
  }

  return result;
}

async function loginUser(): Promise<string> {
  // Get user from DB
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("username", TEST_USER)
    .single();

  if (!user) throw new Error(`User ${TEST_USER} not found`);

  // Login via Supabase Auth
  const email = TEST_EMAIL;
  const { data: auth, error } = await supabase.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });

  if (error || !auth.session) {
    throw new Error(`Login failed: ${error?.message}`);
  }

  return auth.session.access_token;
}

async function placeBet(
  token: string,
  eventId: string,
  market: MarketWithOutcome,
  stake: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${APP_URL}/api/player/place-bet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        bet_type: "singola",
        stake,
        selections: [
          {
            eventId,
            marketId: market.marketId,
            outcomeId: market.outcomeId,
            odds: market.odds,
          },
        ],
      }),
    });

    const json = await res.json();
    if (!res.ok || json.error) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  SETTLEMENT MARKET COVERAGE TEST");
  console.log("═══════════════════════════════════════\n");

  // 1. Login
  console.log("[1] Login...");
  const token = await loginUser();
  console.log(`    OK — ${TEST_USER}\n`);

  // 2. Find target events
  console.log("[2] Finding target events per sport...");
  const targets = await getTargetEvents();
  for (const t of targets) {
    console.log(`    ${t.sport}: ${t.match}`);
  }
  console.log();

  // 3. For each event, get all unique market types and place a bet
  let totalPlaced = 0;
  let totalErrors = 0;
  const marketTypesCovered = new Set<string>();
  const sportStats: Record<string, { placed: number; errors: number; types: string[] }> = {};

  for (const target of targets) {
    console.log(`[${target.sport}] ${target.match}`);
    const markets = await getMarketsForEvent(target.eventId);
    console.log(`    Found ${markets.length} unique market types`);

    sportStats[target.sport] = { placed: 0, errors: 0, types: [] };

    for (const mkt of markets) {
      const stake = 2; // Minimum stake
      const res = await placeBet(token, target.eventId, mkt, stake);

      if (res.success) {
        totalPlaced++;
        sportStats[target.sport].placed++;
        sportStats[target.sport].types.push(mkt.marketType);
        marketTypesCovered.add(mkt.marketType);
        process.stdout.write(".");
      } else {
        totalErrors++;
        sportStats[target.sport].errors++;
        console.log(`\n    ✗ ${mkt.marketType} (${mkt.outcomeName}@${mkt.odds}): ${res.error}`);
      }
    }
    console.log();
  }

  // 4. Summary
  console.log("\n═══════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════");
  console.log(`Total bets placed: ${totalPlaced}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Unique market types: ${marketTypesCovered.size}`);
  console.log();

  for (const [sport, stats] of Object.entries(sportStats)) {
    console.log(`${sport}: ${stats.placed} placed, ${stats.errors} errors`);
    if (stats.types.length > 0) {
      console.log(`  Types: ${stats.types.join(", ")}`);
    }
  }

  console.log("\n═══ Market types covered ═══");
  const sorted = Array.from(marketTypesCovered).sort();
  for (const t of sorted) {
    console.log(`  • ${t}`);
  }
}

main().catch(console.error);
