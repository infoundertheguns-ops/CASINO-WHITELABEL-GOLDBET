export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════
// CRON: Settle ippica (horse racing) bet selections
//   - Finds bet_selections with source='ippica' and result IS NULL
//   - Only settles when the race is finished/completed
//   - Rules per market_type:
//       winner / vincente         → finish_position == 1
//       place / piazzato          → top-N (3 for >=8 runners, 2 for 5-7, 1 for <5)
//       place (2) / place (3) / place (4) → fixed top-N regardless of runners count
//       head to head / testa...   → selected runner beats the other
//       even and odd / pari...    → parity of winner's runner_number
//       dispersion/lengths/short muzzle → VOID (unsupported, not settleable)
//       (cancelled race)          → VOID / refund
//   - Updates parent bet when all its selections are settled
//   - Credits kiosk wallet + kiosk_transactions on win / void refund
// ═══════════════════════════════════════════════════

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type BetResult = "won" | "lost" | "void";

// Returns how many positions pay for a generic Place market (no explicit N in the name).
function placePositions(runnersCount: number): number {
  if (runnersCount >= 8) return 3;
  if (runnersCount >= 5) return 2;
  return 1;
}

type MarketKind =
  | "winner"
  | "place"       // generic — N derived from runners count
  | "place2"      // explicit Place (2)
  | "place3"      // explicit Place (3)
  | "place4"      // explicit Place (4)
  | "h2h"
  | "pari_dispari"
  | "unsupported" // known but not settleable (Dispersion, Lengths, Short Muzzle, …)
  | "unknown";

function normalizeMarketType(t: string | null | undefined): MarketKind {
  const s = (t ?? "").toLowerCase();
  if (s === "winner" || s.includes("vincente")) return "winner";
  // Detect explicit Place (N) — e.g. "Place (4)", "Place (4) Y/N", "place4"
  if (s.startsWith("place") || s.includes("piazzato")) {
    const m = s.match(/\((\d+)\)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n === 2) return "place2";
      if (n === 3) return "place3";
      if (n === 4) return "place4";
    }
    return "place";
  }
  if (s === "head to head" || s.includes("testa")) return "h2h";
  if (s === "even and odd" || s.includes("pari")) return "pari_dispari";
  // Explicitly unsupported market types — void with a clear reason
  if (s.includes("dispersion") || s.includes("lengths") || s.includes("short muzzle") || s.includes("short_muzzle")) return "unsupported";
  return "unknown";
}

async function run(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const summary = { scanned: 0, settled: 0, won: 0, lost: 0, void: 0, betsSettled: 0, refunded: 0, stuckAbandoned: 0, errors: [] as string[] };

  // 0. Abandon races stuck in running/closed/scheduled past scheduled_at + 6h.
  //    MST `getLast()` only returns recent results; races missing from the feed
  //    would otherwise stay 'running' forever. Treating them as abandoned voids
  //    any pending bets in step 3 below.
  //
  //    NOTE: supabase-js `.in('id', [...1000 uuids])` builds a GET-style URL that
  //    exceeds PostgREST's 8KB URL limit and fails silently. Batch 200 ids at a time.
  {
    const stuckThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: stuck } = await supabase
      .from("ippica_races")
      .select("id")
      .in("status", ["running", "closed", "scheduled", "open"])
      .lt("scheduled_at", stuckThreshold)
      .limit(5000);

    if (stuck && stuck.length > 0) {
      const ids = stuck.map((r: { id: string }) => r.id);
      const BATCH = 200;
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const { error } = await supabase
          .from("ippica_races")
          .update({ status: "abandoned", updated_at: new Date().toISOString() })
          .in("id", chunk);
        if (error) {
          summary.errors.push(`abandon batch ${i}: ${error.message}`);
          break;
        }
        summary.stuckAbandoned += chunk.length;
      }
    }
  }

  // 1. Load open ippica selections
  const { data: openSelections, error: selErr } = await supabase
    .from("bet_selections")
    .select("id, bet_id, ippica_race_id, ippica_market_id, ippica_odds_id, odds_at_placement")
    .eq("source", "ippica")
    .is("result", null);

  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!openSelections || openSelections.length === 0) {
    return NextResponse.json({ summary, message: "No open ippica selections" });
  }

  summary.scanned = openSelections.length;

  // 2. Group by race for efficient lookup
  const raceIds = [...new Set(openSelections.map((s) => s.ippica_race_id).filter(Boolean))] as string[];

  const { data: races } = await supabase
    .from("ippica_races")
    .select("id, status, runners_count")
    .in("id", raceIds)
    .in("status", ["finished", "completed", "cancelled", "abandoned"]);

  if (!races || races.length === 0) {
    return NextResponse.json({ summary, message: "No finished/cancelled races to settle" });
  }

  const settlableRaceIds = races.map((r) => r.id);

  const [{ data: runners }, { data: oddsRows }, { data: markets }] = await Promise.all([
    supabase
      .from("ippica_runners")
      .select("id, race_id, runner_number, name, finish_position, is_non_runner")
      .in("race_id", settlableRaceIds),
    supabase
      .from("ippica_odds")
      .select("id, market_id, runner_number, selection_name")
      .in("market_id",
        // Fetch ALL odds for settlable race markets — needed for H2H to look up the
        // opposing odds row, not just the user's selection.
        (await supabase
          .from("ippica_markets")
          .select("id")
          .in("race_id", settlableRaceIds)
        ).data?.map((m: any) => m.id) ?? []
      ),
    supabase
      .from("ippica_markets")
      .select("id, race_id, market_type, market_label")
      .in("race_id", settlableRaceIds),
  ]);

  const raceMap = new Map(races.map((r) => [r.id, r]));
  const oddsMap = new Map((oddsRows ?? []).map((o) => [o.id, o]));
  const marketMap = new Map((markets ?? []).map((m) => [m.id, m]));
  const runnersByRace = new Map<string, typeof runners>();
  for (const r of runners ?? []) {
    const list = runnersByRace.get(r.race_id) ?? [];
    list.push(r);
    runnersByRace.set(r.race_id, list);
  }

  // 3. Settle each selection
  const selectionUpdates: { id: string; result: BetResult }[] = [];
  const affectedBetIds = new Set<string>();

  for (const sel of openSelections) {
    const race = raceMap.get(sel.ippica_race_id!);
    if (!race) continue; // race not finished yet → leave open

    affectedBetIds.add(sel.bet_id);

    // Cancelled or abandoned race → void all
    if (race.status === "cancelled" || race.status === "abandoned") {
      selectionUpdates.push({ id: sel.id, result: "void" });
      summary.void++;
      continue;
    }

    const raceRunners = runnersByRace.get(sel.ippica_race_id!) ?? [];
    const market = sel.ippica_market_id ? marketMap.get(sel.ippica_market_id) : null;
    const odds = sel.ippica_odds_id ? oddsMap.get(sel.ippica_odds_id) : null;
    if (!market || !odds) {
      selectionUpdates.push({ id: sel.id, result: "void" });
      summary.void++;
      continue;
    }

    const kind = normalizeMarketType(market.market_type);
    const activeRunners = raceRunners.filter((r) => !r.is_non_runner);
    const runnersCount = activeRunners.length || (race.runners_count ?? 0);

    const winner = activeRunners.find((r) => r.finish_position === 1);

    let result: BetResult = "void";

    switch (kind) {
      case "winner": {
        if (!winner) { result = "void"; break; }
        result = odds.runner_number === winner.runner_number ? "won" : "lost";
        break;
      }
      case "place":
      case "place2":
      case "place3":
      case "place4": {
        // For explicit Place (N) types the number of paid positions is fixed regardless
        // of how many runners are in the race. For the generic "place" market type the
        // number is derived from the runners count per standard ippica rules.
        const positions =
          kind === "place4" ? 4
          : kind === "place3" ? 3
          : kind === "place2" ? 2
          : placePositions(runnersCount);
        const runner = activeRunners.find((r) => r.runner_number === odds.runner_number);
        if (!runner || runner.finish_position == null) { result = "void"; break; }
        result = runner.finish_position >= 1 && runner.finish_position <= positions ? "won" : "lost";
        break;
      }
      case "unsupported": {
        // Known market types that cannot be settled automatically → void
        result = "void";
        break;
      }
      case "h2h": {
        // H2H odds have runner_number=NULL and selection_name="1"/"2".
        // Names live in market.market_label as "Name A VS Name B".
        const otherOddsRow = (oddsRows ?? []).find(
          (o) => o.market_id === market.id && o.id !== odds.id
        );
        if (!otherOddsRow) { result = "void"; break; }

        // Resolve runner by parsing market_label and matching to race runners by name
        const label = (market.market_label ?? "").trim();
        const parts = label.split(/\s+vs\s+/i).map((s: string) => s.trim()).filter(Boolean);
        const allRunners = raceRunners; // include scratched for name lookup
        const findRunner = (name: string | undefined) => {
          if (!name) return null;
          const n = name.toLowerCase();
          return allRunners.find((r) => (r.name ?? "").toLowerCase() === n) ?? null;
        };
        // selection_name "1" maps to parts[0], "2" to parts[1]
        const selIdx = (odds.selection_name ?? "").trim() === "2" ? 1 : 0;
        const otherIdx = selIdx === 0 ? 1 : 0;
        let selRunner = findRunner(parts[selIdx]);
        let otherRunner = findRunner(parts[otherIdx]);
        // Fallback to runner_number if present
        if (!selRunner && odds.runner_number != null) {
          selRunner = allRunners.find((r) => r.runner_number === odds.runner_number) ?? null;
        }
        if (!otherRunner && otherOddsRow.runner_number != null) {
          otherRunner = allRunners.find((r) => r.runner_number === otherOddsRow.runner_number) ?? null;
        }
        if (!selRunner || !otherRunner) { result = "void"; break; }
        if (selRunner.is_non_runner || otherRunner.is_non_runner) { result = "void"; break; }
        const sP = selRunner.finish_position ?? Infinity;
        const oP = otherRunner.finish_position ?? Infinity;
        if (sP === Infinity && oP === Infinity) { result = "void"; break; }
        result = sP < oP ? "won" : "lost";
        break;
      }
      case "pari_dispari": {
        if (!winner) { result = "void"; break; }
        const parity = winner.runner_number % 2 === 0 ? "pari" : "dispari";
        const selName = (odds.selection_name ?? "").toLowerCase();
        const selectedPari = selName === "2" || selName.includes("pari") || selName.includes("even");
        result = (selectedPari && parity === "pari") || (!selectedPari && parity === "dispari") ? "won" : "lost";
        break;
      }
      default:
        result = "void";
    }

    selectionUpdates.push({ id: sel.id, result });
    if (result === "won") summary.won++;
    else if (result === "lost") summary.lost++;
    else summary.void++;
  }

  // 4. Persist selection results
  for (const upd of selectionUpdates) {
    await supabase
      .from("bet_selections")
      .update({ result: upd.result, settled_at: new Date().toISOString() })
      .eq("id", upd.id);
  }
  summary.settled = selectionUpdates.length;

  // 5. For each affected bet, check if all selections are settled and update parent
  for (const betId of affectedBetIds) {
    const { data: allSels } = await supabase
      .from("bet_selections")
      .select("result")
      .eq("bet_id", betId);
    if (!allSels || allSels.length === 0) continue;

    const allSettled = allSels.every((s) => s.result != null);
    if (!allSettled) continue;

    const { data: bet } = await supabase
      .from("bets")
      .select("id, kiosk_id, stake, potential_win, status")
      .eq("id", betId)
      .single();
    if (!bet || bet.status !== "open") continue;

    const hasLost = allSels.some((s) => s.result === "lost");
    const allVoid = allSels.every((s) => s.result === "void");
    let betStatus: "won" | "lost" | "void";
    let payout = 0;

    if (hasLost) {
      betStatus = "lost";
    } else if (allVoid) {
      betStatus = "void";
      payout = bet.stake; // full refund
    } else {
      // At least one won, none lost — rest might be void. Void legs are treated
      // as 1.0 odds in the combined payout, so we keep potential_win as-is only
      // if nothing was void; otherwise recompute.
      const voidCount = allSels.filter((s) => s.result === "void").length;
      if (voidCount === 0) {
        betStatus = "won";
        payout = bet.potential_win;
      } else {
        // Recompute total odds excluding void legs
        const { data: sels } = await supabase
          .from("bet_selections")
          .select("odds_at_placement, result")
          .eq("bet_id", betId);
        const totalOdds = (sels ?? [])
          .filter((s) => s.result === "won")
          .reduce((acc, s) => acc * (s.odds_at_placement ?? 1), 1);
        betStatus = "won";
        payout = Math.round(bet.stake * totalOdds * 100) / 100;
      }
    }

    await supabase
      .from("bets")
      .update({ status: betStatus, settled_at: new Date().toISOString() })
      .eq("id", betId);

    await supabase
      .from("tickets")
      .update({ status: betStatus })
      .eq("bet_id", betId);

    summary.betsSettled++;

    // Credit wallet on win/void
    if (payout > 0 && bet.kiosk_id) {
      const { data: wallet } = await supabase
        .from("kiosk_wallets")
        .select("balance")
        .eq("kiosk_id", bet.kiosk_id)
        .maybeSingle();

      const newBalance = Math.round(((wallet?.balance ?? 0) + payout) * 100) / 100;
      await supabase
        .from("kiosk_wallets")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("kiosk_id", bet.kiosk_id);

      await supabase.from("kiosk_transactions").insert({
        kiosk_id: bet.kiosk_id,
        type: betStatus === "void" ? "bet_void_refund" : "bet_win",
        amount: payout,
        balance_after: newBalance,
        reference_id: bet.id,
      });

      if (betStatus === "void") summary.refunded++;
    }
  }

  return NextResponse.json({ ok: true, summary });
}

export async function POST(req: Request) { return run(req as any); }
export async function GET(req: Request) { return run(req as any); }

