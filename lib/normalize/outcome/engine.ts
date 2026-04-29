// lib/normalize/outcome/engine.ts — E1.F1
//
// Outcome normalization engine.
// Parallel to lib/normalize/engine.ts (market-level) but operates on
// outcome_normalization rows: maps (source, source_market_type, source_outcome_name)
// → (canonical_key, canonical_outcome_key).
//
// Stages (in order):
//   1. Market lookup    — fill missing canonical_key from market_normalization
//                         (join by source + source_market_type).
//   2. Dictionary       — outcome_dictionary (canonical_key, lower(outcome_pattern))
//                         → canonical_outcome_key. Confidence 95.
//   3. Propagation      — same (canonical_key, lower(source_outcome_name)) already
//                         mapped in ANOTHER source → copy. Confidence 85.
//   4. (future) LLM     — long-tail via Claude Haiku. Not in F1 scope.
//
// Idempotent: upsert onConflict(source, source_market_type, source_outcome_name).
// Does not override rows with verified=true or canonical_outcome_key already set
// (unless we compute an improved match — not in F1).
// Coexists safely with scraper-vps cron (both use same idempotent logic).

import type {
  OutcomeDictEntry,
  OutcomeEngineSummary,
  OutcomeRow,
  OutcomeSource,
  OutcomeStageResult,
} from "./types";

export interface RunOutcomeEngineArgs {
  client: any;
  chunkSize?: number;
}

export async function runOutcomeEngine(args: RunOutcomeEngineArgs): Promise<OutcomeEngineSummary> {
  const client = args.client;
  const chunkSize = Math.min(2000, Math.max(50, args.chunkSize ?? 500));
  const start = Date.now();

  // Load outcome_dictionary once (typically <5k rows).
  const { data: dictData } = await client
    .from("outcome_dictionary")
    .select("canonical_key, source_outcome_pattern, canonical_outcome_key");
  const dict: OutcomeDictEntry[] = (dictData ?? []) as OutcomeDictEntry[];
  // Index for O(1) lookup: key = canonical_key + "\x1f" + pattern (lowercased already in DB)
  const dictIndex = new Map<string, string>();
  for (const d of dict) {
    dictIndex.set(`${d.canonical_key}\x1f${d.source_outcome_pattern.toLowerCase()}`, d.canonical_outcome_key);
  }

  // Load all verified rows (for propagation) — keyed by canonical_key + outcome_name.
  const { data: verifiedData } = await client
    .from("outcome_normalization")
    .select("canonical_key, source_outcome_name, canonical_outcome_key, source")
    .eq("verified", true)
    .not("canonical_outcome_key", "is", null);
  const propIndex = new Map<string, { canonical_outcome_key: string; from_source: string }>();
  for (const v of (verifiedData ?? []) as any[]) {
    if (!v.canonical_key || !v.source_outcome_name || !v.canonical_outcome_key) continue;
    const key = `${v.canonical_key}\x1f${String(v.source_outcome_name).toLowerCase()}`;
    if (!propIndex.has(key)) propIndex.set(key, { canonical_outcome_key: v.canonical_outcome_key, from_source: v.source });
  }

  // Load market_normalization lookup (source, source_market_type → canonical_key).
  const { data: marketData } = await client
    .from("market_normalization")
    .select("source, source_market_type, canonical_key")
    .not("canonical_key", "is", null);
  const marketIndex = new Map<string, string>();
  for (const m of (marketData ?? []) as any[]) {
    marketIndex.set(`${m.source}\x1f${m.source_market_type}`, m.canonical_key);
  }

  // Fetch a chunk of un-fully-mapped outcome rows.
  // Target: rows where canonical_outcome_key IS NULL (need mapping) OR verified=false.
  // We process canonical_outcome_key IS NULL first (higher value).
  const { data: unmapped } = await client
    .from("outcome_normalization")
    .select("id, source, source_market_type, source_outcome_name, canonical_key, canonical_outcome_key, verified")
    .is("canonical_outcome_key", null)
    .limit(chunkSize);

  const rows: OutcomeRow[] = ((unmapped ?? []) as any[]).map((r) => ({
    ...r,
    extracted_by: null,
    confidence: null,
    notes: null,
  }));

  const matched = { dictionary: 0, propagation: 0 };
  let marketLookupApplied = 0;
  let unmatchedCount = 0;

  for (const row of rows) {
    // Stage 1: market lookup — derive canonical_key if missing.
    let ck = row.canonical_key;
    if (!ck) {
      ck = marketIndex.get(`${row.source}\x1f${row.source_market_type}`) ?? null;
      if (ck) marketLookupApplied++;
    }
    if (!ck) {
      // Can't map outcome without a canonical_key.
      unmatchedCount++;
      continue;
    }

    let result: OutcomeStageResult | null = null;
    const outcomeLower = row.source_outcome_name.toLowerCase().trim();

    // Stage 2: dictionary lookup.
    const dictMatch = dictIndex.get(`${ck}\x1f${outcomeLower}`);
    if (dictMatch) {
      result = {
        canonical_key: ck,
        canonical_outcome_key: dictMatch,
        confidence: 95,
        extracted_by: "dictionary",
      };
      matched.dictionary++;
    }

    // Stage 3: propagation from another verified source.
    if (!result) {
      const propMatch = propIndex.get(`${ck}\x1f${outcomeLower}`);
      if (propMatch && propMatch.from_source !== row.source) {
        result = {
          canonical_key: ck,
          canonical_outcome_key: propMatch.canonical_outcome_key,
          confidence: 85,
          extracted_by: "propagation",
        };
        matched.propagation++;
      }
    }

    if (!result) {
      unmatchedCount++;
      continue;
    }

    // Upsert — preserve verified (set false only on new inserts via DB default).
    await client.from("outcome_normalization").update({
      canonical_key: result.canonical_key,
      canonical_outcome_key: result.canonical_outcome_key,
      extracted_by: result.extracted_by,
      confidence: result.confidence,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
  }

  // Remaining: count unmapped still in DB.
  const { count: remainingCount } = await client
    .from("outcome_normalization")
    .select("*", { count: "exact", head: true })
    .is("canonical_outcome_key", null);

  return {
    processed: rows.length,
    matched,
    market_lookup_applied: marketLookupApplied,
    unmatched: unmatchedCount,
    remaining: remainingCount ?? 0,
    took_ms: Date.now() - start,
  };
}
