export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════════════
// CRON: Settle ippica TOTE bet selections
//   - Finds bet_selections with source='ippica_tote' and result IS NULL
//   - Only settles when the underlying race is finished/completed/cancelled
//   - Market rules:
//       Vincente              → runner finished #1
//       Piazzato              → runner finished within top-N (see placePositions)
//       Accoppiata (ordinata) → runners exactly #1 and #2 in the bet's order
//       Accoppiata_p          → runners #1 and #2 in any order
//       Trio                  → three runners are #1, #2, #3 in any order
//       Tris                  → three runners in exact order
//       Quarté                → four runners in exact order
//       Quinté                → five runners in exact order
//       (cancelled race)      → VOID / refund
//   - Credits kiosk wallet + kiosk_transactions on win / void refund
// ═══════════════════════════════════════════════════════════

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type BetResult = "won" | "lost" | "void";

function placePositions(runnersCount: number): number {
  if (runnersCount >= 8) return 3;
  if (runnersCount >= 5) return 2;
  return 1;
}

async function run(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const summary = { scanned: 0, settled: 0, won: 0, lost: 0, void: 0, betsSettled: 0, refunded: 0 };

  const { data: openSelections, error } = await supabase
    .from("bet_selections")
    .select("id, bet_id, ippica_race_id, ippica_tote_pool_id, ippica_tote_combo_id, odds_at_placement")
    .eq("source", "ippica_tote")
    .is("result", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!openSelections || openSelections.length === 0) {
    return NextResponse.json({ summary, message: "No open tote selections" });
  }
  summary.scanned = openSelections.length;

  const raceIds = [...new Set(openSelections.map((s) => s.ippica_race_id).filter(Boolean))] as string[];

  const { data: races } = await supabase
    .from("ippica_races")
    .select("id, status, runners_count")
    .in("id", raceIds)
    .in("status", ["finished", "completed", "cancelled"]);
  if (!races || races.length === 0) {
    return NextResponse.json({ summary, message: "No finished races" });
  }

  const settlableRaceIds = races.map((r) => r.id);

  const [{ data: runners }, { data: pools }, { data: combos }] = await Promise.all([
    supabase
      .from("ippica_runners")
      .select("id, race_id, runner_number, finish_position, is_non_runner")
      .in("race_id", settlableRaceIds),
    supabase
      .from("ippica_tote_pools")
      .select("id, market_code, runner_number, race_id")
      .in("id", openSelections.map((s) => s.ippica_tote_pool_id).filter(Boolean) as string[]),
    supabase
      .from("ippica_tote_combinations")
      .select("id, market_code, runner_numbers, race_id")
      .in("id", openSelections.map((s) => s.ippica_tote_combo_id).filter(Boolean) as string[]),
  ]);

  const raceMap = new Map(races.map((r) => [r.id, r]));
  const poolMap = new Map((pools ?? []).map((p) => [p.id, p]));
  const comboMap = new Map((combos ?? []).map((c) => [c.id, c]));
  const runnersByRace = new Map<string, typeof runners>();
  for (const r of runners ?? []) {
    const list = runnersByRace.get(r.race_id) ?? [];
    list.push(r);
    runnersByRace.set(r.race_id, list);
  }

  const selectionUpdates: { id: string; result: BetResult }[] = [];
  const affectedBetIds = new Set<string>();

  for (const sel of openSelections) {
    const race = raceMap.get(sel.ippica_race_id!);
    if (!race) continue;
    affectedBetIds.add(sel.bet_id);

    if (race.status === "cancelled") {
      selectionUpdates.push({ id: sel.id, result: "void" });
      summary.void++;
      continue;
    }

    const raceRunners = runnersByRace.get(sel.ippica_race_id!) ?? [];
    const active = raceRunners.filter((r) => !r.is_non_runner);
    const runnersCount = active.length || (race.runners_count ?? 0);

    // Build sorted finish order: position → runner_number
    const finishByPos = new Map<number, number>();
    for (const r of active) {
      if (r.finish_position != null && r.finish_position > 0) {
        finishByPos.set(r.finish_position, r.runner_number);
      }
    }

    let result: BetResult = "void";

    if (sel.ippica_tote_pool_id) {
      const pool = poolMap.get(sel.ippica_tote_pool_id);
      if (!pool) { selectionUpdates.push({ id: sel.id, result: "void" }); summary.void++; continue; }
      const runnerFinish = active.find((r) => r.runner_number === pool.runner_number)?.finish_position;
      if (runnerFinish == null) { result = "void"; }
      else if (pool.market_code === "vincente") {
        result = runnerFinish === 1 ? "won" : "lost";
      } else if (pool.market_code === "piazzato") {
        const top = placePositions(runnersCount);
        result = runnerFinish >= 1 && runnerFinish <= top ? "won" : "lost";
      }
    } else if (sel.ippica_tote_combo_id) {
      const combo = comboMap.get(sel.ippica_tote_combo_id);
      if (!combo) { selectionUpdates.push({ id: sel.id, result: "void" }); summary.void++; continue; }

      const positions = combo.runner_numbers.map((n: number) => {
        const fin = active.find((r) => r.runner_number === n)?.finish_position;
        return fin ?? null;
      });
      const anyMissing = positions.some((p: number | null) => p == null);
      // If a leg runner is scratched → void the bet
      if (anyMissing) {
        result = "void";
      } else {
        switch (combo.market_code) {
          case "accoppiata": {
            // Exact order: positions must be [1, 2]
            result = positions[0] === 1 && positions[1] === 2 ? "won" : "lost";
            break;
          }
          case "accoppiata_p": {
            // Any order among top 2
            const set = new Set(positions);
            result = set.has(1) && set.has(2) ? "won" : "lost";
            break;
          }
          case "trio": {
            // Any order among top 3
            const set = new Set(positions);
            result = set.has(1) && set.has(2) && set.has(3) ? "won" : "lost";
            break;
          }
          case "tris": {
            result = positions[0] === 1 && positions[1] === 2 && positions[2] === 3 ? "won" : "lost";
            break;
          }
          case "quartet": {
            result = positions[0] === 1 && positions[1] === 2 && positions[2] === 3 && positions[3] === 4 ? "won" : "lost";
            break;
          }
          case "quinte": {
            result = [1, 2, 3, 4, 5].every((p, i) => positions[i] === p) ? "won" : "lost";
            break;
          }
          default:
            result = "void";
        }
      }
    }

    selectionUpdates.push({ id: sel.id, result });
    if (result === "won") summary.won++;
    else if (result === "lost") summary.lost++;
    else summary.void++;
  }

  for (const upd of selectionUpdates) {
    await supabase
      .from("bet_selections")
      .update({ result: upd.result, settled_at: new Date().toISOString() })
      .eq("id", upd.id);
  }
  summary.settled = selectionUpdates.length;

  // Close parent bets when all their selections are settled
  for (const betId of affectedBetIds) {
    const { data: allSels } = await supabase
      .from("bet_selections")
      .select("result, odds_at_placement")
      .eq("bet_id", betId);
    if (!allSels || allSels.length === 0) continue;
    if (!allSels.every((s) => s.result != null)) continue;

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
      payout = bet.stake;
    } else {
      const voidCount = allSels.filter((s) => s.result === "void").length;
      betStatus = "won";
      if (voidCount === 0) {
        payout = bet.potential_win;
      } else {
        const totalOdds = allSels
          .filter((s) => s.result === "won")
          .reduce((acc, s) => acc * (s.odds_at_placement ?? 1), 1);
        payout = Math.round(bet.stake * totalOdds * 100) / 100;
      }
    }

    await supabase.from("bets").update({ status: betStatus, settled_at: new Date().toISOString() }).eq("id", betId);
    await supabase.from("tickets").update({ status: betStatus }).eq("bet_id", betId);
    summary.betsSettled++;

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

export async function POST(req: Request) { return run(req as NextRequest); }
export async function GET(req: Request) { return run(req as NextRequest); }
