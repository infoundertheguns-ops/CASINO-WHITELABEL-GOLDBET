import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyLeg, type BetLeg, type ScoreResult, type Verdict } from "./classify";
import { aggregatePayout, type Leg as PayoutLeg } from "@/lib/settlement/half-stake-payout";

interface CandidateLeg {
  id: string;
  bet_id: string;
  event_id: string | null;
  market_id: string | null;
  outcome_id: string | null;
  odds_at_placement: number | string;
  market_name: string | null;
  outcome_key: string | null;
  line: number | null;
  score_home: number | null;
  score_away: number | null;
  period_scores: Record<string, { home?: number; away?: number }> | null;
  sport_slug: string | null;
  period: string | null;
}

const SELECT_LEG_FIELDS = [
  "id", "bet_id", "event_id", "market_id", "outcome_id", "odds_at_placement",
  "markets_v2!bet_selections_market_id_fkey(market_name)",
  "outcomes_v2!bet_selections_outcome_id_fkey(outcome_key, line)",
  "events_v2!bet_selections_event_id_fkey(score_home, score_away, period_scores, sport_slug, period)",
].join(", ");

interface RawScoreRow {
  score_home: number | null;
  score_away: number | null;
  period_scores: Record<string, { home?: number; away?: number }> | null;
  sport_slug: string | null;
  period: string | null;
}

function buildScores(row: RawScoreRow): ScoreResult | null {
  if (row.score_home == null) return null;
  if (row.score_away == null) return null;
  let ht_home: number | null = null;
  let ht_away: number | null = null;
  const ps = row.period_scores;
  if (ps && typeof ps === "object") {
    const first = ps["1H"] || ps["1Q"] || ps["P1"] || ps["S1"];
    if (first && first.home != null && first.away != null) {
      ht_home = first.home;
      ht_away = first.away;
    }
  }
  const scores: ScoreResult = { home: row.score_home, away: row.score_away, ht_home, ht_away };
  const extra = scores as unknown as Record<string, unknown>;
  if (ps) extra.halfScores = ps;
  if (row.sport_slug) extra.sport = row.sport_slug;
  if (row.period) extra.period = row.period;
  return scores;
}

interface FetchedLeg {
  id: string;
  bet_id: string;
  event_id: string | null;
  market_id: string | null;
  outcome_id: string | null;
  odds_at_placement: number | string;
  markets_v2: { market_name?: string } | null;
  outcomes_v2: { outcome_key?: string; line?: number | null } | null;
  events_v2: RawScoreRow | null;
}

export interface SettlementSummary {
  scanned: number;
  settled: number;
  skipped: number;
  errors: string[];
  bets_touched: number;
  bets_finalized: number;
}

export async function runSettlementPass(sb: SupabaseClient, hoursWindow: number = 24): Promise<SettlementSummary> {
  const since = new Date(Date.now() - hoursWindow * 3600 * 1000).toISOString();
  const errors: string[] = [];

  const { data: events, error: eventsErr } = await sb
    .from("events_v2")
    .select("id")
    .eq("status", "settled")
    .gte("last_settled_at", since)
    .limit(5000);

  if (eventsErr) {
    return { scanned: 0, settled: 0, skipped: 0, errors: [eventsErr.message], bets_touched: 0, bets_finalized: 0 };
  }
  const eventIds = (events ?? []).map((e: { id: string }) => e.id);
  if (eventIds.length === 0) {
    return { scanned: 0, settled: 0, skipped: 0, errors: [], bets_touched: 0, bets_finalized: 0 };
  }

  const candidates: CandidateLeg[] = [];
  const chunkSize = 200;
  const sliceCount = Math.ceil(eventIds.length / chunkSize);
  const slices = Array.from({ length: sliceCount }, (_, k) => eventIds.slice(k * chunkSize, (k + 1) * chunkSize));

  const T_BS = "bet_selections";
  const T_BETS = "bets";

  const fetchSlice = async (slice: string[], sliceIdx: number) => {
    const tbl = sb.from(T_BS);
    const sel = tbl.select(SELECT_LEG_FIELDS);
    const f1 = sel.is("result", null).eq("source", "sport");
    const f2 = f1.in("event_id", slice).limit(2000);
    const r = await f2;
    if (r.error) errors.push("fetch chunk " + sliceIdx + ": " + r.error.message);
    if (!r.data) return;
    r.data.forEach((l: any) => {
      const m = (Array.isArray(l.markets_v2) ? l.markets_v2[0] : l.markets_v2);
      const o = (Array.isArray(l.outcomes_v2) ? l.outcomes_v2[0] : l.outcomes_v2);
      const e = (Array.isArray(l.events_v2) ? l.events_v2[0] : l.events_v2);
      candidates.push({
        id: l.id,
        bet_id: l.bet_id,
        event_id: l.event_id ?? null,
        market_id: l.market_id ?? null,
        outcome_id: l.outcome_id ?? null,
        odds_at_placement: l.odds_at_placement,
        market_name: (m && m.market_name) ?? null,
        outcome_key: (o && o.outcome_key) ?? null,
        line: (o && o.line) ?? null,
        score_home: e?.score_home ?? null,
        score_away: e?.score_away ?? null,
        period_scores: e?.period_scores ?? null,
        sport_slug: e?.sport_slug ?? null,
        period: e?.period ?? null,
      });
    });
  };

  await Promise.all(slices.map((s, k) => fetchSlice(s, k)));

  let settled = 0;
  let skipped = 0;
  const touchedBetIds = new Set<string>();

  const processLeg = async (leg: CandidateLeg) => {
    if (!leg.market_name || !leg.outcome_key) { skipped++; return; }
    const scores = buildScores({
      score_home: leg.score_home,
      score_away: leg.score_away,
      period_scores: leg.period_scores,
      sport_slug: leg.sport_slug,
      period: leg.period,
    });
    if (!scores) { skipped++; return; }
    const betLeg: BetLeg = { market_type: leg.market_name, outcome_name: leg.outcome_key, line: leg.line };
    let verdict: Verdict | null = null;
    try {
      const result = classifyLeg(betLeg, scores);
      verdict = result.verdict;
    } catch (err) {
      return;
    }
    if (verdict == null) { skipped++; return; }
    const u = sb.from(T_BS).update({ result: verdict, settled_at: new Date().toISOString() });
    const u2 = u.eq("id", leg.id).is("result", null);
    const ru = await u2;
    if (ru.error) errors.push("update " + leg.id + ": " + ru.error.message);
    if (ru.error) return;
    settled++;
    touchedBetIds.add(leg.bet_id);
  };

  const initial: Promise<void> = Promise.resolve();
  const _ = await candidates.reduce(async (prev, c) => { await prev; await processLeg(c); }, initial);

  let bets_finalized = 0;

  const fetchBet = async (betId: string) => await sb.from(T_BETS).select("id, stake, status").eq("id", betId).maybeSingle();

  const fetchBetLegs = async (betId: string) => await sb.from(T_BS).select("result, odds_at_placement").eq("bet_id", betId);

  const updateBet = async (betId: string, status: string, payout: number) => await sb.from(T_BETS).update({ status, actual_win: payout, settled_at: new Date().toISOString() }).eq("id", betId).eq("status", "open");

  const X = async (id: string) => {
    const rb = await fetchBet(id);
    if (rb.error) return;
    if (!rb.data) return;
    if (rb.data.status !== "open") return;
    const rl = await fetchBetLegs(id);
    if (rl.error || !rl.data) return;
    const pl = rl.data.map((l: any) => ({ result: l.result, odds_at_placement: l.odds_at_placement })) as PayoutLeg[];
    const stake = parseFloat(String(rb.data.stake));
    const agg = aggregatePayout(pl, stake);
    if (!agg) return;
    const ru = await updateBet(id, agg.status, agg.payout);
    if (ru.error) errors.push("upd bet " + id + ": " + ru.error.message);
    if (!ru.error) bets_finalized++;
  };

  const touched = Array.from(touchedBetIds);
  await touched.reduce(async (prev, id) => { await prev; await X(id); }, Promise.resolve());

  return { scanned: candidates.length, settled, skipped, errors, bets_touched: touchedBetIds.size, bets_finalized };
}
