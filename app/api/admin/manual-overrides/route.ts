export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET /api/admin/manual-overrides?action=active-suspended|active-overrides|audit|expired-recent|kpis
//
// active-suspended:   outcomes with manual_suspended=true
// active-overrides:   outcomes with manual_odds IS NOT NULL
// expired-recent:     outcome_manual_actions where action_type='expire' last 7 days
// audit:              outcome_manual_actions joined with outcome+event context
// kpis:               aggregate counters

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "kpis";
  const limit = Math.min(500, Math.max(10, Number(sp.get("limit") ?? 100)));
  const sb = createAdminClient();

  try {
    if (action === "kpis") {
      const [suspended, overrides, last24h] = await Promise.all([
        sb.from("outcomes").select("id", { count: "exact", head: true }).eq("manual_suspended", true),
        sb.from("outcomes").select("id", { count: "exact", head: true }).not("manual_odds", "is", null),
        sb.from("outcome_manual_actions").select("id", { count: "exact", head: true })
          .gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      ]);
      return NextResponse.json({
        active_suspended: suspended.count ?? 0,
        active_overrides: overrides.count ?? 0,
        actions_last_24h: last24h.count ?? 0,
      });
    }

    if (action === "active-suspended" || action === "active-overrides") {
      const isOverride = action === "active-overrides";
      let q = sb
        .from("outcomes")
        .select(`
          id, name, odds, is_active, is_suspended,
          manual_suspended, manual_odds, manual_reason,
          manual_expires_at, manual_set_at, manual_set_by,
          markets!inner(id, market_type, line, event_id,
            events!inner(id, home_team, away_team, starts_at, source, status, sport_id,
              sports!inner(name)
            )
          )
        `)
        .order("manual_set_at", { ascending: false })
        .limit(limit);

      q = isOverride ? q.not("manual_odds", "is", null) : q.eq("manual_suspended", true);

      const { data, error } = await q;
      if (error) throw error;
      return NextResponse.json({ rows: flattenOutcomeRows(data ?? []) });
    }

    if (action === "expired-recent") {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error } = await sb
        .from("outcome_manual_actions")
        .select(`
          id, outcome_id, action_type, old_value, new_value, reason, source, created_at, created_by,
          outcomes!inner(id, name,
            markets!inner(market_type, line, event_id,
              events!inner(home_team, away_team, starts_at, source,
                sports!inner(name)
              )
            )
          )
        `)
        .eq("action_type", "expire")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return NextResponse.json({ rows: flattenAuditRows(data ?? []) });
    }

    if (action === "audit") {
      const filterAction = sp.get("action_type");
      const filterSource = sp.get("source");
      const since = sp.get("since");

      let q = sb
        .from("outcome_manual_actions")
        .select(`
          id, outcome_id, action_type, old_value, new_value, reason, source, created_at, created_by,
          outcomes!inner(id, name,
            markets!inner(market_type, line, event_id,
              events!inner(home_team, away_team, starts_at, source,
                sports!inner(name)
              )
            )
          )
        `)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (filterAction) q = q.eq("action_type", filterAction);
      if (filterSource) q = q.eq("source", filterSource);
      if (since) q = q.gte("created_at", since);

      const { data, error } = await q;
      if (error) throw error;
      return NextResponse.json({ rows: flattenAuditRows(data ?? []) });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

/**
 * Supabase nested select returns a tree. Flatten for easy UI consumption.
 */
function flattenOutcomeRows(rows: any[]) {
  return rows.map((r) => {
    const m = Array.isArray(r.markets) ? r.markets[0] : r.markets;
    const e = m?.events && (Array.isArray(m.events) ? m.events[0] : m.events);
    const s = e?.sports && (Array.isArray(e.sports) ? e.sports[0] : e.sports);
    return {
      outcome_id: r.id,
      outcome_name: r.name,
      live_odds: r.odds,
      is_active: r.is_active,
      is_suspended: r.is_suspended,
      manual_suspended: r.manual_suspended,
      manual_odds: r.manual_odds,
      manual_reason: r.manual_reason,
      manual_expires_at: r.manual_expires_at,
      manual_set_at: r.manual_set_at,
      manual_set_by: r.manual_set_by,
      market_id: m?.id,
      market_type: m?.market_type,
      market_line: m?.line,
      event_id: m?.event_id ?? e?.id,
      home_team: e?.home_team,
      away_team: e?.away_team,
      event_starts_at: e?.starts_at,
      source: e?.source,
      event_status: e?.status,
      sport: s?.name,
    };
  });
}

function flattenAuditRows(rows: any[]) {
  return rows.map((r) => {
    const o = Array.isArray(r.outcomes) ? r.outcomes[0] : r.outcomes;
    const m = o?.markets && (Array.isArray(o.markets) ? o.markets[0] : o.markets);
    const e = m?.events && (Array.isArray(m.events) ? m.events[0] : m.events);
    const s = e?.sports && (Array.isArray(e.sports) ? e.sports[0] : e.sports);
    return {
      audit_id: r.id,
      outcome_id: r.outcome_id,
      action_type: r.action_type,
      old_value: r.old_value,
      new_value: r.new_value,
      reason: r.reason,
      source: r.source,
      created_at: r.created_at,
      created_by: r.created_by,
      outcome_name: o?.name,
      market_type: m?.market_type,
      market_line: m?.line,
      home_team: e?.home_team,
      away_team: e?.away_team,
      event_starts_at: e?.starts_at,
      event_source: e?.source,
      sport: s?.name,
    };
  });
}
