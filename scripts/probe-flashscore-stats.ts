#!/usr/bin/env tsx
/**
 * Probe flashscore feed to answer spec open questions:
 * 1. Does feed expose shots_home/away for finished calcio matches?
 * 2. Does feed expose HT yellow/red cards per team?
 *
 * Usage: tsx scripts/probe-flashscore-stats.ts
 */

import { fetchResults, fetchMatchDetail, type FlashscoreStat } from "@/lib/flashscore";

async function main() {
  console.log("═══ FLASHSCORE STATS PROBE ═══\n");

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const results = [
    ...(await fetchResults("calcio", yesterday)),
    ...(await fetchResults("calcio", twoDaysAgo)),
  ];

  console.log(`Found ${results.length} finished calcio matches across yesterday+day before\n`);

  // Prefer top-league matches where stats are most complete
  const topLeagues = [
    "Serie A",
    "Premier League",
    "La Liga",
    "Bundesliga",
    "Ligue 1",
    "Champions League",
    "Europa League",
  ];

  const preferred = results.filter((r) =>
    topLeagues.some((l) => r.league.toLowerCase().includes(l.toLowerCase()))
  );

  const sample = (preferred.length > 0 ? preferred : results).slice(0, 5);
  console.log(`Probing ${sample.length} sample matches:`);
  sample.forEach((r) =>
    console.log(`  - [${r.league}] ${r.homeTeam} vs ${r.awayTeam} (${r.matchId})`)
  );
  console.log();

  // Aggregate stat names across all probed matches to see vocabulary
  const allStatNames = new Set<string>();
  const perMatchStats: { matchId: string; teams: string; stats: FlashscoreStat[] }[] = [];

  for (const r of sample) {
    console.log(`\n── ${r.homeTeam} vs ${r.awayTeam} (${r.matchId}) ──`);
    const detail = await fetchMatchDetail(r.matchId);
    if (!detail || detail.stats.length === 0) {
      console.log("  (no stats returned)");
      continue;
    }

    perMatchStats.push({
      matchId: r.matchId,
      teams: `${r.homeTeam} vs ${r.awayTeam}`,
      stats: detail.stats,
    });

    for (const s of detail.stats) {
      allStatNames.add(s.name);
      console.log(`  ${s.name.padEnd(60)} | H=${s.home}  A=${s.away}`);
    }

    await new Promise((res) => setTimeout(res, 800));
  }

  // Summarize unique stat names
  console.log("\n═══ UNIQUE STAT NAMES FOUND ═══");
  const sorted = [...allStatNames].sort();
  for (const name of sorted) console.log(`  ${name}`);

  // Question 1 — Shots per team
  console.log("\n═══ Q1: SHOTS PER TEAM ═══");
  const shotRelated = sorted.filter((n) =>
    /shot|tir|attempts/i.test(n)
  );
  if (shotRelated.length === 0) {
    console.log("  ❌ NO shot-related stats found");
  } else {
    console.log(`  ✅ Found ${shotRelated.length} shot-related stats:`);
    shotRelated.forEach((n) => console.log(`     - ${n}`));
  }

  // Question 2 — Cards in 1st Half section
  console.log("\n═══ Q2: HT CARDS PER TEAM ═══");
  const cardRelated = sorted.filter((n) => /card|ammon|espuls|yellow|red|cartell/i.test(n));
  const htCards = cardRelated.filter((n) => /1st Half|1T|primo tempo/i.test(n));
  if (cardRelated.length === 0) {
    console.log("  ❌ NO card-related stats found at all");
  } else {
    console.log(`  Found ${cardRelated.length} card-related stats:`);
    cardRelated.forEach((n) => console.log(`     - ${n}`));
    if (htCards.length === 0) {
      console.log("  ❌ NO HT (1st Half) card stats — only FT cards available");
    } else {
      console.log(`  ✅ ${htCards.length} HT card stats present`);
    }
  }

  // Bonus — corners section/HT
  console.log("\n═══ CORNER STATS ═══");
  const cornerRelated = sorted.filter((n) => /corner|calcio d.angolo/i.test(n));
  if (cornerRelated.length === 0) {
    console.log("  ❌ NO corner stats");
  } else {
    cornerRelated.forEach((n) => console.log(`  - ${n}`));
  }

  // Export for offline inspection if needed
  console.log(
    `\n═══ RAW SAMPLE (first match full dump) ═══\n${JSON.stringify(perMatchStats[0] || {}, null, 2)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
