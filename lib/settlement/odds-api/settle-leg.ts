// Plan D Phase 2 — shadow settlement orchestrator.
//
// For a bet leg already settled via the existing FS path, replays it through
// the new odds-api engine and writes ONLY to settlement_log_shadow.
// Never mutates bet_selections.result.

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyLeg, describeLeg, type BetLeg, type ScoreResult, type Verdict } from "./classify";

interface SettledLegRow {
  id: string;            // bet_selections.id
  event_id: string;      // bet_selections.event_id (legacy)
  result: string | null; // bet_selections.result ('won'|'lost'|'void')
  settled_at: string | null;
  market_type: string;
  market_line: number | null;
  outcome_name: string;
  event_external_id: string | null;
}

interface ShadowRow {
  leg_id: string;
  real_verdict: string | null;
  shadow_verdict: Verdict | null;
  real_settled_at: string | null;
  source_used: "odds-api" | "flashscore" | "fallback" | "skipped" | "no_event_v2" | "unsupported_market";
  skip_reason: string | null;
  leg_snapshot: Record<string, unknown>;
}

// Map a legacy event (events.external_id like 'odds-api:<id>') to events_v2 score data.
// Returns null when event cannot be mapped or has no scores yet.
async function fetchV2Scores(
  sb: SupabaseClient,
  externalId: string | null
): Promise<ScoreResult | null> {
  if (!externalId || !externalId.startsWith("odds-api:")) return null;
  const oddsApiId = externalId.substring("odds-api:".length);
  if (!oddsApiId) return null;

  const { data, error } = await sb
    .from("events_v2")
    .select("score_home, score_away, period_scores, status")
    .eq("odds_api_id", oddsApiId)
    .maybeSingle();

  if (error || !data) return null;
  if (data.status !== "settled" && data.status !== "live") return null;
  if (data.score_home == null || data.score_away == null) return null;

  // Extract HT from period_scores JSONB if present.
  // Schema: { "1H": { home, away }, "2H": {...}, ... } (varies by sport)
  let ht_home: number | null = null;
  let ht_away: number | null = null;
  const ps = data.period_scores as Record<string, { home?: number; away?: number }> | null;
  if (ps && typeof ps === "object") {
    const first = ps["1H"] || ps["1Q"] || ps["P1"] || ps["S1"];
    if (first && typeof first.home === "number" && typeof first.away === "number") {
      ht_home = first.home;
      ht_away = first.away;
    }
  }

  return {
    home: data.score_home,
    away: data.score_away,
    ht_home,
    ht_away,
  };
}

// Process a single settled leg, return shadow row to insert. Caller batches the insert.
export async function buildShadowRow(
  sb: SupabaseClient,
  leg: SettledLegRow
): Promise<ShadowRow> {
  const snapshot: Record<string, unknown> = {
    market: leg.market_type,
    line: leg.market_line,
    outcome: leg.outcome_name,
    real_verdict: leg.result,
    leg_summary: describeLeg({
      market_type: leg.market_type,
      outcome_name: leg.outcome_name,
      line: leg.market_line,
    }),
  };

  // 1. Fetch v2 scores
  const scores = await fetchV2Scores(sb, leg.event_external_id);
  if (!scores) {
    return {
      leg_id: leg.id,
      real_verdict: leg.result,
      shadow_verdict: null,
      real_settled_at: leg.settled_at,
      source_used: "no_event_v2",
      skip_reason: leg.event_external_id?.startsWith("odds-api:")
        ? "events_v2 row missing or scores null"
        : "event not from odds-api source",
      leg_snapshot: snapshot,
    };
  }

  // 2. Classify
  const betLeg: BetLeg = {
    market_type: leg.market_type,
    outcome_name: leg.outcome_name,
    line: leg.market_line,
  };
  const { verdict, reason } = classifyLeg(betLeg, scores);

  if (verdict == null) {
    return {
      leg_id: leg.id,
      real_verdict: leg.result,
      shadow_verdict: null,
      real_settled_at: leg.settled_at,
      source_used: "unsupported_market",
      skip_reason: reason ?? "classifier returned null",
      leg_snapshot: { ...snapshot, scores },
    };
  }

  return {
    leg_id: leg.id,
    real_verdict: leg.result,
    shadow_verdict: verdict,
    real_settled_at: leg.settled_at,
    source_used: "odds-api",
    skip_reason: null,
    leg_snapshot: { ...snapshot, scores },
  };
}

// Fetch settled legs in window + write shadow rows. Returns aggregate metrics.
export async function runShadowPass(
  sb: SupabaseClient,
  hoursWindow: number = 24
): Promise<{
  fetched: number;
  classified: number;
  skipped: number;
  inserted: number;
  errors: string[];
}> {
  const since = new Date(Date.now() - hoursWindow * 3600 * 1000).toISOString();

  // Pull legs settled in window that don't already have a recent shadow row.
  const { data: legs, error: legsErr } = await sb
    .from("bet_selections")
    .select(`
      id, event_id, result, settled_at,
      markets!inner(market_type, line),
      outcomes!inner(name),
      events!inner(external_id)
    `)
    .gte("settled_at", since)
    .not("result", "is", null)
    .eq("source", "sport")
    .limit(500);

  if (legsErr) {
    return { fetched: 0, classified: 0, skipped: 0, inserted: 0, errors: [legsErr.message] };
  }
  if (!legs || legs.length === 0) {
    return { fetched: 0, classified: 0, skipped: 0, inserted: 0, errors: [] };
  }

  // Skip legs with shadow row written in last 1 hour (idempotency window)
  const legIds = legs.map((l) => l.id);
  const { data: existing } = await sb
    .from("settlement_log_shadow")
    .select("leg_id")
    .in("leg_id", legIds)
    .gte("shadow_settled_at", new Date(Date.now() - 3600 * 1000).toISOString());
  const skipSet = new Set((existing ?? []).map((r) => r.leg_id));

  const errors: string[] = [];
  const rows: ShadowRow[] = [];
  let classified = 0;
  let skipped = 0;

  for (const l of legs) {
    if (skipSet.has(l.id)) continue;
    try {
      const m = Array.isArray(l.markets) ? l.markets[0] : l.markets;
      const o = Array.isArray(l.outcomes) ? l.outcomes[0] : l.outcomes;
      const e = Array.isArray(l.events) ? l.events[0] : l.events;
      const row = await buildShadowRow(sb, {
        id: l.id,
        event_id: l.event_id,
        result: l.result,
        settled_at: l.settled_at,
        market_type: (m as { market_type: string }).market_type,
        market_line: (m as { line: number | null }).line ?? null,
        outcome_name: (o as { name: string }).name,
        event_external_id: (e as { external_id: string | null }).external_id ?? null,
      });
      rows.push(row);
      if (row.shadow_verdict != null) classified++;
      else skipped++;
    } catch (err: unknown) {
      errors.push(`${l.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (rows.length === 0) {
    return { fetched: legs.length, classified, skipped, inserted: 0, errors };
  }

  const { error: insertErr } = await sb.from("settlement_log_shadow").insert(rows);
  if (insertErr) {
    errors.push(`insert: ${insertErr.message}`);
    return { fetched: legs.length, classified, skipped, inserted: 0, errors };
  }

  return { fetched: legs.length, classified, skipped, inserted: rows.length, errors };
}
