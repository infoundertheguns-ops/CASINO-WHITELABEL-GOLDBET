#!/usr/bin/env tsx
/**
 * Task 1.5 — Integration test for Family A settlers on real prod data.
 *
 * Samples recent Calcio events with backfilled flashscore stats and runs
 * synthetic O/U markets through the real dispatcher to verify the full
 * pipeline end-to-end:
 *
 *   flashscore stats → live_data.stats → buildResult →
 *   MARKET_PATTERNS → SETTLERS (makeTeamOU) → Verdict
 *
 * For each sampled event we generate two synthetic markets per Family A
 * stat (goals/corners/shots/shots-on-target × home/away):
 *   - Over at line = stat - 0.5 → expected "won"
 *   - Under at line = stat + 0.5 → expected "won"
 *
 * Re-runnable as a canary after deploys.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/test-family-a-real.ts \
 *     dotenv_config_path=.env.local [--limit N] [--since ISO]
 */

import { createClient } from "@supabase/supabase-js";
import { __test__buildResult, __test__settle } from "@/lib/settlement";

interface Args {
  limit: number;
  since: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let limit = 10;
  let since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      const parsed = parseInt(args[i + 1] ?? "", 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = parsed;
      i++;
    } else if (args[i] === "--since") {
      since = args[i + 1] ?? since;
      i++;
    }
  }
  return { limit, since };
}

interface StatCase {
  market: string; // market-type prefix (without trailing line)
  stat: number | undefined;
  side: "home" | "away";
  family: string; // for reporting
}

async function main() {
  const { limit, since } = parseArgs();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log("═══ FAMILY A REAL-DATA INTEGRATION TEST ═══");
  console.log(`Since: ${since}`);
  console.log(`Target sample: ${limit} events\n`);

  // Pull a wider pool to survive the client-side stats filter.
  const { data: events, error } = await supabase
    .from("events")
    .select(
      "id, home_team, away_team, score_home, score_away, live_data, flashscore_id, updated_at, sports!inner(name)"
    )
    .eq("status", "ended")
    .eq("sports.name", "Calcio")
    .not("flashscore_id", "is", null)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(400);

  if (error) {
    console.error("Query error:", error);
    process.exit(1);
  }

  const candidates = (events || []).filter((e) => {
    const stats = (e.live_data as Record<string, unknown> | null)?.stats;
    if (!Array.isArray(stats) || stats.length === 0) return false;
    return stats.some((s: Record<string, unknown>) =>
      /Partita:\s*Calci d'angolo/i.test((s.name as string) || "")
    );
  });

  console.log(
    `Candidates: ${candidates.length} calcio events with corner stats in last 7d\n`
  );

  const sample = candidates.slice(0, limit);
  if (sample.length === 0) {
    console.log(
      "⚠️  No eligible events. Run `scripts/backfill-fs-stats.ts` first?"
    );
    return;
  }

  let totalAssertions = 0;
  let passed = 0;
  let skippedNoStatValue = 0;
  let buildResultNull = 0;

  const failures: string[] = [];
  const familyStats = new Map<string, { pass: number; fail: number }>();

  for (const e of sample) {
    const sr = __test__buildResult(e, undefined, "calcio");
    if (!sr) {
      buildResultNull++;
      console.log(
        `SKIP ${e.home_team} vs ${e.away_team}: buildResult returned null`
      );
      continue;
    }

    console.log(`── ${e.home_team} vs ${e.away_team} (score ${sr.home}-${sr.away}) ──`);
    console.log(
      `   corners=${sr.corners_home ?? "-"}/${sr.corners_away ?? "-"}  ` +
        `shots=${sr.shots_total_home ?? "-"}/${sr.shots_total_away ?? "-"}  ` +
        `shots_on_target=${sr.shots_on_target_home ?? "-"}/${sr.shots_on_target_away ?? "-"}`
    );

    const cases: StatCase[] = [
      { market: "O/U Gol Casa", stat: sr.home, side: "home", family: "goals" },
      { market: "O/U Gol Ospite", stat: sr.away, side: "away", family: "goals" },
      { market: "O/U Corner Casa", stat: sr.corners_home, side: "home", family: "corners" },
      { market: "O/U Corner Ospite", stat: sr.corners_away, side: "away", family: "corners" },
      { market: "O/U Tiri Casa", stat: sr.shots_total_home, side: "home", family: "shots" },
      { market: "O/U Tiri Ospite", stat: sr.shots_total_away, side: "away", family: "shots" },
      { market: "O/U Tiri Porta Casa", stat: sr.shots_on_target_home, side: "home", family: "shots_on_target" },
      { market: "O/U Tiri Porta Ospite", stat: sr.shots_on_target_away, side: "away", family: "shots_on_target" },
    ];

    for (const c of cases) {
      if (c.stat == null) {
        skippedNoStatValue++;
        continue;
      }

      // Build assertion pairs. Note: market-patterns match [\d.]+ (no
      // leading minus), so negative lines are not a real-world possibility
      // in the production data. When stat=0, we can't use `stat - 0.5`
      // (= -0.5) for the Over assertion. Instead assert Over 0.5 → lost
      // and Under 0.5 → won — still exercises the full pipeline and
      // verifies push vs loss boundaries correctly.
      const assertions: { market: string; outcome: "Over" | "Under"; line: number; expected: "won" | "lost" | "push" }[] = [];
      if (c.stat === 0) {
        assertions.push(
          { market: `${c.market} 0.5`, outcome: "Over", line: 0.5, expected: "lost" },
          { market: `${c.market} 0.5`, outcome: "Under", line: 0.5, expected: "won" }
        );
      } else {
        const overLine = c.stat - 0.5;
        const underLine = c.stat + 0.5;
        assertions.push(
          { market: `${c.market} ${overLine}`, outcome: "Over", line: overLine, expected: "won" },
          { market: `${c.market} ${underLine}`, outcome: "Under", line: underLine, expected: "won" }
        );
      }

      const fam = familyStats.get(c.family) || { pass: 0, fail: 0 };
      for (const a of assertions) {
        const verdict = __test__settle(e, a.market, a.outcome, a.line, "calcio");
        totalAssertions++;
        if (verdict === a.expected) {
          passed++;
          fam.pass++;
        } else {
          fam.fail++;
          const msg = `FAIL [${e.home_team} vs ${e.away_team}] "${a.market}" ${a.outcome} (stat=${c.stat}) → expected "${a.expected}", got ${JSON.stringify(verdict)}`;
          console.log(`   ${msg}`);
          failures.push(msg);
        }
      }
      familyStats.set(c.family, fam);
    }
  }

  console.log(`\n═══ RESULT ═══`);
  console.log(`Events sampled:            ${sample.length}`);
  console.log(`buildResult null:          ${buildResultNull}`);
  console.log(`Synthetic assertions:      ${totalAssertions}`);
  console.log(`Passed:                    ${passed}`);
  console.log(`Skipped (no stat value):   ${skippedNoStatValue}`);
  const passRate =
    totalAssertions > 0 ? ((passed / totalAssertions) * 100).toFixed(1) : "0";
  console.log(`Pass rate:                 ${passRate}%`);

  console.log(`\nPer-family breakdown:`);
  for (const [fam, s] of familyStats.entries()) {
    const total = s.pass + s.fail;
    const rate = total > 0 ? ((s.pass / total) * 100).toFixed(1) : "0";
    console.log(`  ${fam.padEnd(20)} ${s.pass}/${total} (${rate}%)`);
  }

  if (failures.length > 0) {
    console.log(`\n⚠️  ${failures.length} assertion(s) failed — see above`);
    process.exit(1);
  }
  console.log(`\n✅ Family A integration test passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
