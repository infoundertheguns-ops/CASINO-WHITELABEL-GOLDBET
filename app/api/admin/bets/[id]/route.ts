import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";
import type {
  BetDetailResponse, BetEventLogEntry, BetSelectionDetail,
  BetStatus, BetType,
} from "@/lib/types/bets-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const cookieStore = cookies();
    let sbToken: string | undefined;
    for (const c of cookieStore.getAll()) {
      if (c.name.startsWith("sb-") && c.name.includes("-auth-token")) {
        try { const p = JSON.parse(c.value); if (p?.access_token) { sbToken = p.access_token; break; } }
        catch { if (c.value.startsWith("eyJ")) { sbToken = c.value; break; } }
      }
    }
    if (!sbToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sb = createAdminClient();
    const { data: userData } = await sb.auth.getUser(sbToken);
    const userId = userData?.user?.id;
    if (!userId) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    let scope;
    try { scope = await resolveBetsScope(sb, userId); }
    catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

    const { data: betRow, error } = await sb
      .from("bets")
      .select(`
        *,
        user:users(id, username, kyc_status, country, agent_id),
        kiosk:kiosks(id, code, name, agent_id, agent:agents(id, code, name, level))
      `)
      .eq("id", params.id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!betRow) return NextResponse.json({ error: "Bet not found" }, { status: 404 });

    // Permission check: agent can see bets from their kiosks OR their players
    if (scope !== "all") {
      const betKioskAgentId = (betRow as any).kiosk?.agent_id;
      const betUserAgentId = (betRow as any).user?.agent_id;
      if (betKioskAgentId !== scope.agent_id && betUserAgentId !== scope.agent_id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Selections (sport)
    // NOTE: events_v2 has home/away columns (flat sport_name/league_name).
    const { data: selRows, error: selErr } = await sb
      .from("bet_selections")
      .select(`
        id, source, odds_at_placement, result, settled_at,
        event:events_v2(home, away, league_name, sport_name),
        market:markets_v2(market_name),
        outcome:outcomes_v2(outcome_key, odds),
        race:ippica_races(title, scheduled_at, meeting:ippica_meetings(name)),
        race_market:ippica_markets(market_type),
        race_odds:ippica_odds(odds, runner_number)
      `)
      .eq("bet_id", params.id);

    const selections: BetSelectionDetail[] = (selRows ?? []).map((s: any) => {
      if (s.source === "sport") {
        const evName = s.event
          ? `${s.event.home ?? "?"} vs ${s.event.away ?? "?"}`
          : "—";
        return {
          id: s.id, source: "sport",
          event: {
            name: evName,
            league: s.event?.league_name ?? null,
            sport: s.event?.sport_name ?? null,
          },
          market: { type: s.market?.market_name ?? "—", label: null },
          outcome: { name: s.outcome?.outcome_key ?? "—" },
          odds_at_placement: Number(s.odds_at_placement ?? 0),
          current_odds: s.outcome?.odds != null ? Number(s.outcome.odds) : null,
          result: s.result ?? null,
          settled_at: s.settled_at,
        };
      }
      // Ippica/ippica_tote — title shown in event.name slot
      return {
        id: s.id, source: s.source,
        event: { name: s.race?.title ?? "Race", league: s.race?.meeting?.name ?? null, sport: "Ippica" },
        market: { type: s.race_market?.market_type ?? "—", label: null },
        outcome: { name: s.race_odds?.runner_number != null ? `#${s.race_odds.runner_number}` : "—" },
        odds_at_placement: Number(s.odds_at_placement ?? 0),
        current_odds: s.race_odds?.odds != null ? Number(s.race_odds.odds) : null,
        result: s.result ?? null,
        settled_at: s.settled_at,
        race_meeting: s.race?.meeting?.name ?? null,
        race_date: s.race?.scheduled_at ?? null,
        horse_number: s.race_odds?.runner_number ?? null,
      };
    });

    // Children combos (system bets)
    const { data: childRows } = await sb
      .from("bets")
      .select("id, stake, total_odds, potential_win, actual_win, status, selections_count")
      .eq("parent_bet_id", params.id);

    const children_combos = (childRows ?? []).map((c: any) => ({
      id: c.id,
      stake: Number(c.stake ?? 0),
      total_odds: c.total_odds != null ? Number(c.total_odds) : null,
      potential_win: c.potential_win != null ? Number(c.potential_win) : null,
      actual_win: c.actual_win != null ? Number(c.actual_win) : null,
      status: c.status as BetStatus,
      selections_count: c.selections_count ?? 0,
    }));

    // Event log derivation
    const event_log: BetEventLogEntry[] = [];
    event_log.push({
      ts: betRow.created_at,
      event: "placed",
      actor: "player",
      data: {
        requested_stake: betRow.requested_stake ?? betRow.stake,
        ip_address: betRow.placed_ip ?? betRow.ip_address ?? null,
      },
    });
    if (betRow.reviewed_at || betRow.acceptance_mode) {
      event_log.push({
        ts: betRow.reviewed_at ?? betRow.created_at,
        event: "accepted",
        actor: betRow.accepted_by === "admin" ? "admin" : "system",
        data: {
          accepted_stake: betRow.accepted_stake ?? betRow.stake,
          mode: betRow.acceptance_mode ?? "auto",
          note: betRow.acceptance_note ?? null,
        },
      });
    }
    if (betRow.settled_at) {
      event_log.push({
        ts: betRow.settled_at,
        event: "settled",
        actor: "system",
        data: { status: betRow.status, actual_win: betRow.actual_win ?? 0 },
      });
    }

    const k = (betRow as any).kiosk;
    const ag = k?.agent;
    const response: BetDetailResponse = {
      bet: {
        id: betRow.id,
        code: betRow.id.split("-")[0],
        bet_type: betRow.bet_type as BetType,
        stake: Number(betRow.stake ?? 0),
        requested_stake: betRow.requested_stake != null ? Number(betRow.requested_stake) : null,
        accepted_stake: betRow.accepted_stake != null ? Number(betRow.accepted_stake) : null,
        total_odds: betRow.total_odds != null ? Number(betRow.total_odds) : null,
        potential_win: betRow.potential_win != null ? Number(betRow.potential_win) : null,
        actual_win: betRow.actual_win != null ? Number(betRow.actual_win) : null,
        status: betRow.status as BetStatus,
        is_live: !!betRow.is_live,
        is_free_bet: !!betRow.is_free_bet,
        selections_count: betRow.selections_count ?? 0,
        combo_type: betRow.combo_type ?? null,
        combo_count: betRow.combo_count ?? null,
        combos_won: betRow.combos_won ?? null,
        parent_bet_id: betRow.parent_bet_id ?? null,
        created_at: betRow.created_at,
        settled_at: betRow.settled_at,
        reviewed_at: betRow.reviewed_at,
        time_to_kickoff_minutes: betRow.time_to_kickoff_minutes ?? null,
      },
      user: {
        id: (betRow as any).user?.id ?? betRow.user_id,
        username: (betRow as any).user?.username ?? null,
        kyc_status: (betRow as any).user?.kyc_status ?? null,
        country: (betRow as any).user?.country ?? null,
      },
      kiosk: k ? { id: k.id, code: k.code, name: k.name, agent_id: k.agent_id ?? null } : null,
      agent: ag ? { id: ag.id, code: ag.code, name: ag.name, level: ag.level ?? null } : null,
      selections,
      children_combos,
      risk: {
        score: betRow.risk_score ?? 0,
        flags: Array.isArray(betRow.risk_flags) ? betRow.risk_flags : [],
        acceptance_mode: betRow.acceptance_mode ?? null,
        acceptance_note: betRow.acceptance_note ?? null,
        accepted_by: betRow.accepted_by ?? null,
        placed_ip: betRow.placed_ip ?? betRow.ip_address ?? null,
        placed_fingerprint: betRow.placed_fingerprint ?? null,
      },
      event_log,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
