#!/usr/bin/env tsx
/**
 * Direct Settlement Test — Insert bets via DB, bypass risk engine
 * Places one bet per unique market type per sport directly into DB
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TEST_USER = "rec_player_1";

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  DIRECT SETTLEMENT MARKET TEST");
  console.log("═══════════════════════════════════════\n");

  // Get test user
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("username", TEST_USER)
    .single();
  if (!user) throw new Error("User not found");
  console.log(`User: ${TEST_USER} (${user.id})\n`);

  // Sports to test
  const sports = ["Calcio", "Tennis", "Basket", "Volley", "Hockey Ghiaccio", "Pallamano"];

  let totalPlaced = 0;
  const allTypes = new Set<string>();

  for (const sportName of sports) {
    // Find the best live event for this sport (most market types)
    const { data: events } = await supabase
      .from("events")
      .select("id, home_team, away_team, sport_id, sports!inner(name)")
      .eq("is_live", true)
      .eq("status", "live")
      .eq("sports.name", sportName)
      .limit(200);

    if (!events || events.length === 0) {
      console.log(`[${sportName}] No live events\n`);
      continue;
    }

    // Pick event with most active markets
    let bestEventId = "";
    let bestCount = 0;
    let bestMatch = "";

    for (const ev of events.slice(0, 20)) { // Check top 20
      const { count } = await supabase
        .from("markets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", ev.id)
        .eq("is_active", true);
      if (count && count > bestCount) {
        bestCount = count;
        bestEventId = ev.id;
        bestMatch = `${ev.home_team} vs ${ev.away_team}`;
      }
    }

    if (!bestEventId) {
      console.log(`[${sportName}] No markets found\n`);
      continue;
    }

    console.log(`[${sportName}] ${bestMatch} (${bestCount} markets)`);

    // Get all unique market types with one outcome each
    const { data: markets } = await supabase
      .from("markets")
      .select("id, market_type, line")
      .eq("event_id", bestEventId)
      .eq("is_active", true);

    if (!markets) continue;

    // Deduplicate by market_type
    const seenTypes = new Set<string>();
    const uniqueMarkets = markets.filter((m) => {
      if (seenTypes.has(m.market_type)) return false;
      seenTypes.add(m.market_type);
      return true;
    });

    let sportPlaced = 0;

    for (const mkt of uniqueMarkets) {
      // Get first active outcome
      const { data: outcomes } = await supabase
        .from("outcomes")
        .select("id, name, odds")
        .eq("market_id", mkt.id)
        .eq("is_active", true)
        .gt("odds", 1.01)
        .lt("odds", 50)
        .order("odds", { ascending: true })
        .limit(1);

      if (!outcomes || outcomes.length === 0) continue;

      const outcome = outcomes[0];
      const stake = 2;

      // Insert bet directly
      const { data: bet, error: betErr } = await supabase
        .from("bets")
        .insert({
          user_id: user.id,
          bet_type: "singola",
          stake,
          potential_win: parseFloat((stake * outcome.odds).toFixed(2)),
          total_odds: outcome.odds,
          status: "open",
          selections_count: 1,
          risk_score: 0,
        })
        .select("id")
        .single();

      if (betErr || !bet) {
        console.log(`  ✗ ${mkt.market_type}: ${betErr?.message}`);
        continue;
      }

      // Insert bet_selection
      const { error: selErr } = await supabase
        .from("bet_selections")
        .insert({
          bet_id: bet.id,
          event_id: bestEventId,
          market_id: mkt.id,
          outcome_id: outcome.id,
          odds_at_placement: outcome.odds,
        });

      if (selErr) {
        console.log(`  ✗ ${mkt.market_type}: sel ${selErr.message}`);
        // Cleanup orphaned bet
        await supabase.from("bets").delete().eq("id", bet.id);
        continue;
      }

      sportPlaced++;
      totalPlaced++;
      allTypes.add(mkt.market_type);
      process.stdout.write(".");
    }

    console.log(`\n  → ${sportPlaced} bets placed on ${uniqueMarkets.length} market types\n`);
  }

  console.log("═══════════════════════════════════════");
  console.log(`TOTAL: ${totalPlaced} bets on ${allTypes.size} unique market types`);
  console.log("═══════════════════════════════════════\n");

  // List all types
  const sorted = Array.from(allTypes).sort();
  for (const t of sorted) {
    console.log(`  • ${t}`);
  }
}

main().catch(console.error);
