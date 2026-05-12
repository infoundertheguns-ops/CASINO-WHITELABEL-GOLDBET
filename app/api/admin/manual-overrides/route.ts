export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// GET /api/admin/manual-overrides?action=active-suspended|active-overrides|audit|expired-recent|kpis
//
// POST-DROP-CASCADE refactor (2026-05-12):
//   Live state lives in `manual_overrides` table (scope='outcome', FK -> outcomes_v2).
//   Audit log stays in `outcome_manual_actions`; its `outcome_id` FK to legacy outcomes
//   is gone, so we enrich via a manual second query against outcomes_v2 batched by id.
//   Row shape preserved for page.tsx compat (home_team, away_team, market_type, sport, etc.).

const NESTED_OUTCOME_SELECT = `
  id, outcome_key, line, odds, is_active, is_suspended,
  markets_v2!inner (
    id, market_name, event_id,
    events_v2!inner ( id, home, away, starts_at, status, sport_name )
  )
`;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action") || "kpis";
  const limit = Math.min(500, Math.max(10, Number(sp.get("limit") ?? 100)));
  const sb = createAdminClient();
  const nowIso = new Date().toISOString();

  try {
    if (action === "kpis") {
      const [suspended, overrides, last24h] = await Promise.all([
        sb.from("manual_overrides")
          .select("id", { count: "exact", head: true })
          .eq("scope", "outcome")
          .eq("manual_suspended", true)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
        sb.from("manual_overrides")
          .select("id", { count: "exact", head: true })
          .eq("scope", "outcome")
          .not("manual_odds", "is", null)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
        sb.from("outcome_manual_actions")
          .select("id", { count: "exact", head: true })
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
        .from("manual_overrides")
        .select(`
          id, scope, outcome_id_v2, market_id_v2,
          manual_suspended, manual_odds, reason, expires_at, created_at, updated_at, created_by,
          outcomes_v2!inner ( ${NESTED_OUTCOME_SELECT} )
        `)
        .eq("scope", "outcome")
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("updated_at", { ascending: false })
        .limit(limit);

      q = isOverride ? q.not("manual_odds", "is", null) : q.eq("manual_suspended", true);

      const { data, error } = await q;
      if (error) throw error;
      return NextResponse.json({ rows: flattenOverrideRows(data ?? []) });
    }

    if (action === "expired-recent") {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error } = await sb
        .from("outcome_manual_actions")
        .select(`id, outcome_id, action_type, old_value, new_value, reason, source, created_at, created_by`)
        .eq("action_type", "expire")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const enriched = await enrichAuditRows(sb, data ?? []);
      return NextResponse.json({ rows: flattenAuditRows(enriched) });
    }

    if (action === "audit") {
      const filterAction = sp.get("action_type");
      const filterSource = sp.get("source");
      const since = sp.get("since");

      let q = sb
        .from("outcome_manual_actions")
        .select(`id, outcome_id, action_type, old_value, new_value, reason, source, created_at, created_by`)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (filterAction) q = q.eq("action_type", filterAction);
      if (filterSource) q = q.eq("source", filterSource);
      if (since) q = q.gte("created_at", since);

      const { data, error } = await q;
      if (error) throw error;
      const enriched = await enrichAuditRows(sb, data ?? []);
      return NextResponse.json({ rows: flattenAuditRows(enriched) });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

// PostgREST nested results can come back either as a single object or a 1-element array
// depending on cardinality. Normalize.
function pickOne(v: any) {
  return Array.isArray(v) ? v[0] : v;
}

function extractOutcomeContext(outcome: any) {
  const o = pickOne(outcome);
  const m = pickOne(o?.markets_v2);
  const e = pickOne(m?.events_v2);
  return {
    outcome_id: o?.id,
    outcome_name: o?.outcome_key,
    live_odds: o?.odds,
    is_active: o?.is_active,
    is_suspended: o?.is_suspended,
    market_id: m?.id,
    market_type: m?.market_name,
    market_line: o?.line,
    event_id: m?.event_id ?? e?.id,
    home_team: e?.home,
    away_team: e?.away,
    event_starts_at: e?.starts_at,
    event_status: e?.status,
    sport: e?.sport_name,
  };
}

/**
 * Manual-overrides rows already include the nested outcomes_v2 tree (FK exists).
 */
function flattenOverrideRows(rows: any[]) {
  return rows.map((r) => {
    const ctx = extractOutcomeContext(r.outcomes_v2);
    return {
      ...ctx,
      manual_suspended: r.manual_suspended,
      manual_odds: r.manual_odds,
      manual_reason: r.reason,
      manual_expires_at: r.expires_at,
      manual_set_at: r.updated_at ?? r.created_at,
      manual_set_by: r.created_by,
      source: "odds-api", // events_v2 has no `source` column; hardcode for UI compat
    };
  });
}

/**
 * Enrich outcome_manual_actions with outcomes_v2 context via a batched second query.
 * Old FK is gone post-DROP CASCADE; ~196k orphan rows referencing legacy outcomes
 * will not appear in the lookup map and render with null context (UI shows "—").
 */
async function enrichAuditRows(sb: ReturnType<typeof createAdminClient>, rows: any[]) {
  if (rows.length === 0) return rows;
  const ids = Array.from(new Set(rows.map((r) => r.outcome_id).filter(Boolean)));
  if (ids.length === 0) return rows;
  const { data, error } = await sb
    .from("outcomes_v2")
    .select(NESTED_OUTCOME_SELECT)
    .in("id", ids);
  if (error) throw error;
  const map = new Map<string, any>();
  for (const o of data ?? []) map.set(o.id, o);
  return rows.map((r) => ({ ...r, outcomes_v2: map.get(r.outcome_id) ?? null }));
}

function flattenAuditRows(rows: any[]) {
  return rows.map((r) => {
    const ctx = extractOutcomeContext(r.outcomes_v2);
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
      outcome_name: ctx.outcome_name,
      market_type: ctx.market_type,
      market_line: ctx.market_line,
      home_team: ctx.home_team,
      away_team: ctx.away_team,
      event_starts_at: ctx.event_starts_at,
      event_source: "odds-api",
      sport: ctx.sport,
    };
  });
}
