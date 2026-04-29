export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getScopedPlayerIds } from "@/lib/agent-permissions";
import { sendTelegramAlert } from "@/lib/telegram";

// ═══════════════════════════════════════════════════
// CRON: Auto-calculate GGR and commissions per agent
// - Runs after each settlement period elapses
// - Inserts records into agent_settlements with status 'pending'
// - Sends Telegram notification per settlement generated
// ═══════════════════════════════════════════════════

interface Agent {
  id: string;
  name: string;
  code: string;
  settlement_period: "weekly" | "monthly";
  commission_rate: number;
  status: string;
  created_at: string;
}

interface Period {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

/**
 * Given an agent and the last settlement end date, compute all fully-elapsed periods.
 *
 * Weekly: Mon-Sun. Only include if Sunday < now.
 * Monthly: 1st-last day. Only include if last day < now.
 *
 * If no previous settlement, start from agent's created_at.
 */
function getMissingPeriods(agent: Agent, lastSettlementEnd: string | null): Period[] {
  const periods: Period[] = [];
  const now = new Date();

  // Determine start date
  const fromDate = lastSettlementEnd
    ? new Date(lastSettlementEnd + "T00:00:00Z")
    : new Date(agent.created_at);

  if (agent.settlement_period === "weekly") {
    // Align fromDate to the start of the NEXT Monday after lastSettlementEnd
    // (if lastSettlementEnd was a Sunday, start the following Monday)
    const cursor = new Date(fromDate);
    // Advance to the Monday of the week after fromDate
    const dayOfWeek = cursor.getUTCDay(); // 0=Sun, 1=Mon...6=Sat
    // Days to add to reach the next Monday
    const daysToNextMonday = dayOfWeek === 1
      ? (lastSettlementEnd ? 7 : 0) // already Monday: if from last settlement, start next week; if from created_at, can start this week
      : (8 - dayOfWeek) % 7 || 7;

    if (lastSettlementEnd) {
      // After a settlement end, move to the next Monday
      cursor.setUTCDate(cursor.getUTCDate() + daysToNextMonday);
    } else {
      // From created_at: align to the Monday of that week (or same day if Monday)
      const d = cursor.getUTCDay();
      const daysToMonday = d === 0 ? 1 : d === 1 ? 0 : -(d - 1);
      cursor.setUTCDate(cursor.getUTCDate() + daysToMonday);
    }

    // Generate Mon-Sun weeks
    while (true) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(cursor);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6); // Sunday

      // Only include if the Sunday has fully elapsed (< now at midnight)
      const weekEndMidnight = new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000);
      if (weekEndMidnight > now) break;

      periods.push({
        start: toDateString(weekStart),
        end: toDateString(weekEnd),
      });

      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  } else {
    // Monthly: 1st to last day of each month
    let year = fromDate.getUTCFullYear();
    let month = fromDate.getUTCMonth(); // 0-indexed

    if (lastSettlementEnd) {
      // Advance to the next month after lastSettlementEnd
      month += 1;
      if (month > 11) { month = 0; year++; }
    } else {
      // Start from the month of created_at
      // Use 1st of that month
    }

    while (true) {
      const periodStart = new Date(Date.UTC(year, month, 1));
      // Last day of month
      const periodEnd = new Date(Date.UTC(year, month + 1, 0));

      // Only include if the last day has fully elapsed
      const periodEndMidnight = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);
      if (periodEndMidnight > now) break;

      periods.push({
        start: toDateString(periodStart),
        end: toDateString(periodEnd),
      });

      month += 1;
      if (month > 11) { month = 0; year++; }
    }
  }

  return periods;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key");
  if (!key || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let generated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Fetch all active agents
  const { data: agents, error: agentsErr } = await supabase
    .from("agents")
    .select("id, name, code, settlement_period, commission_rate, status, created_at")
    .eq("status", "active");

  if (agentsErr) {
    return NextResponse.json({ error: agentsErr.message }, { status: 500 });
  }

  const activeAgents: Agent[] = agents || [];

  for (const agent of activeAgents) {
    try {
      // ── 1. Find last settlement ──
      const { data: lastSettlements } = await supabase
        .from("agent_settlements")
        .select("period_end")
        .eq("agent_id", agent.id)
        .order("period_end", { ascending: false })
        .limit(1);

      const lastSettlementEnd =
        lastSettlements && lastSettlements.length > 0
          ? lastSettlements[0].period_end
          : null;

      // ── 2. Compute missing periods ──
      const periods = getMissingPeriods(agent, lastSettlementEnd);

      if (periods.length === 0) {
        skipped++;
        continue;
      }

      // ── 3. Get scoped player IDs ──
      const playerIds = await getScopedPlayerIds(supabase, agent.id);

      // ── 4. Process each missing period ──
      for (const period of periods) {
        try {
          // Check for existing settlement (dedup safety)
          const { data: existing } = await supabase
            .from("agent_settlements")
            .select("id")
            .eq("agent_id", agent.id)
            .eq("period_start", period.start)
            .eq("period_end", period.end)
            .maybeSingle();

          if (existing) {
            skipped++;
            continue;
          }

          // Sum bets in period (exclude void/rejected)
          let turnover = 0;
          let winnings = 0;

          if (playerIds.length > 0) {
            const periodStartTs = period.start + "T00:00:00Z";
            const periodEndTs = period.end + "T23:59:59Z";

            const { data: betStats } = await supabase
              .from("bets")
              .select("stake, actual_win")
              .in("user_id", playerIds)
              .not("status", "in", '("void","rejected")')
              .gte("created_at", periodStartTs)
              .lte("created_at", periodEndTs);

            if (betStats && betStats.length > 0) {
              for (const bet of betStats) {
                turnover += Number(bet.stake) || 0;
                winnings += Number(bet.actual_win) || 0;
              }
            }
          }

          const ggr = turnover - winnings;
          const commission = ggr > 0 ? (ggr * agent.commission_rate) / 100 : 0;

          // ── 5. Insert into agent_settlements ──
          const { error: insertErr } = await supabase
            .from("agent_settlements")
            .insert({
              agent_id: agent.id,
              period_start: period.start,
              period_end: period.end,
              total_turnover: turnover,
              total_winnings: winnings,
              ggr,
              commission_pct: agent.commission_rate,
              commission_amount: commission,
              status: "pending",
            });

          if (insertErr) {
            // Unique constraint violation = already exists, count as skipped
            if (insertErr.code === "23505") {
              skipped++;
            } else {
              errors.push(`${agent.code} ${period.start}→${period.end}: ${insertErr.message}`);
            }
            continue;
          }

          generated++;

          // ── 6. Send Telegram notification ──
          await sendTelegramAlert(
            "info",
            "Settlement Generato",
            `Agente: ${agent.name} (${agent.code})\nPeriodo: ${period.start} → ${period.end}\nTurnover: €${turnover.toFixed(2)}\nGGR: €${ggr.toFixed(2)}\nCommissione (${agent.commission_rate}%): €${commission.toFixed(2)}`,
            `settlement_${agent.id}`
          );
        } catch (periodErr) {
          const msg = periodErr instanceof Error ? periodErr.message : String(periodErr);
          errors.push(`${agent.code} ${period.start}→${period.end}: ${msg}`);
        }
      }
    } catch (agentErr) {
      const msg = agentErr instanceof Error ? agentErr.message : String(agentErr);
      errors.push(`agent ${agent.code}: ${msg}`);
    }
  }

  return NextResponse.json({
    generated,
    skipped,
    errors: errors.length > 0 ? errors.slice(0, 20) : [],
    total_agents: activeAgents.length,
  });
}
