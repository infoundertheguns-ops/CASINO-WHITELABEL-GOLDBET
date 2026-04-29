import type { CanonicalMarket, EngineSummary, NormalizationRow, Source, StageResult } from "./types";
import { parseMarketType } from "./regex-patterns";
import { lookupDictionary } from "./dictionary";
import { propagate } from "./propagation";
import { lookupLLM } from "./llm";

export interface RunEngineArgs {
  client: any;
  chunkSize?: number;
  useLlm?: boolean;
  llmApiKey?: string;
  llmBudgetBatches?: number;
  llmBatchSize?: number;
  llmMinConfidence?: number;
}

export async function runEngine(args: RunEngineArgs): Promise<EngineSummary> {
  const client = args.client;
  const chunkSize = args.chunkSize ?? 500;
  const start = Date.now();

  // Legacy: twobet_market_groups DB table, retained for historical normalization rows.
  const { data: canonicals } = await client.from("canonical_markets").select("*");
  const { data: twobetGroups } = await client.from("twobet_market_groups").select("twobet_g, name_it");
  const { data: verifiedRows } = await client
    .from("market_normalization")
    .select("source, source_market_type, canonical_key, canonical_line, canonical_name_it, verified, extracted_by, confidence, notes")
    .eq("verified", true);

  const catalog: CanonicalMarket[] = (canonicals ?? []) as CanonicalMarket[];
  const verified: NormalizationRow[] = (verifiedRows ?? []) as NormalizationRow[];
  const groups = (twobetGroups ?? []) as Array<{ twobet_g: number; name_it: string }>;

  const { data: unmapped } = await client.rpc("list_unmapped_market_types", { p_limit: chunkSize });
  const rows: Array<{ source: string; market_type: string }> = (unmapped ?? []) as any;

  const matched: EngineSummary["matched"] = { regex: 0, dictionary: 0, propagation: 0 };
  const stage3Unmatched: Array<{ source: Source; market_type: string }> = [];
  let unmatchedCount = 0;

  for (const row of rows) {
    const source = row.source as Source;
    const smt = row.market_type;

    let result: StageResult | null = null;
    const parsed = parseMarketType(smt);
    if (parsed) {
      const canon = catalog.find((c) => c.base_key === parsed.base_key && c.period === parsed.period);
      if (canon) {
        result = {
          canonical_key: canon.canonical_key,
          canonical_line: parsed.line,
          canonical_name_it: canon.canonical_name_it,
          confidence: 95,
          extracted_by: "regex",
        };
        matched.regex++;
      }
    }

    if (!result) {
      result = lookupDictionary({
        source,
        source_market_type: smt,
        canonicals: catalog,
        twobetGroups: groups,
      });
      if (result) matched.dictionary++;
    }

    if (!result) {
      result = propagate({ source, source_market_type: smt, verifiedRows: verified });
      if (result) matched.propagation++;
    }

    if (!result) {
      stage3Unmatched.push({ source, market_type: smt });
      continue;
    }

    // Wave 34 fix: omit `verified` from upsert payload so INSERT uses DB default
    // (false) while UPDATE preserves existing verified status (doesn't reset
    // operator-confirmed mappings back to unverified every cron cycle).
    // For new inserts, companion auto-verify cron (scraper-vps */15min) promotes
    // confidence>=90 regex entries to verified=true.
    await client.from("market_normalization").upsert(
      {
        source,
        source_market_type: smt,
        canonical_key: result.canonical_key,
        canonical_line: result.canonical_line,
        canonical_name_it: result.canonical_name_it,
        extracted_by: result.extracted_by,
        confidence: result.confidence,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source,source_market_type" },
    );
  }

  // ═══ Stage 5: LLM (optional, gated by args.useLlm) ═══
  let llmSummary: EngineSummary["llm"] | undefined;
  if (args.useLlm && stage3Unmatched.length > 0) {
    const apiKey = args.llmApiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    if (!apiKey) {
      throw new Error("LLM stage requested but ANTHROPIC_API_KEY missing");
    }
    const batchSize = Math.max(1, Math.min(60, args.llmBatchSize ?? 30));
    const budget = Math.max(1, args.llmBudgetBatches ?? Number(process.env.NORMALIZE_LLM_BUDGET ?? 50));
    const minConf = Math.max(0, args.llmMinConfidence ?? 50);

    // Group unmatched by source to keep batch-level "source" prompt coherent.
    const bySource = new Map<Source, string[]>();
    for (const r of stage3Unmatched) {
      const arr = bySource.get(r.source) ?? [];
      arr.push(r.market_type);
      bySource.set(r.source, arr);
    }

    let batchesUsed = 0;
    let inputTok = 0, outputTok = 0, cacheTok = 0, errors = 0;

    outer: for (const [src, types] of bySource.entries()) {
      for (let i = 0; i < types.length; i += batchSize) {
        if (batchesUsed >= budget) break outer;
        const batch = types.slice(i, i + batchSize);
        try {
          const r = await lookupLLM({ batch, canonicals: catalog, source: src, apiKey });
          batchesUsed++;
          inputTok += r.usage?.input_tokens ?? 0;
          outputTok += r.usage?.output_tokens ?? 0;
          cacheTok += r.usage?.cache_read_input_tokens ?? 0;

          for (const m of r.matches) {
            if (!m.canonical_key) continue;
            if (m.confidence < minConf) continue;
            const canon = catalog.find((c) => c.canonical_key === m.canonical_key);
            if (!canon) continue;
            await client.from("market_normalization").upsert(
              {
                source: src,
                source_market_type: m.input,
                canonical_key: m.canonical_key,
                canonical_line: m.canonical_line,
                canonical_name_it: canon.canonical_name_it,
                verified: false,
                extracted_by: "llm",
                confidence: m.confidence,
                notes: m.reasoning ?? null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "source,source_market_type" },
            );
            matched.llm = (matched.llm ?? 0) + 1;
          }
        } catch (err) {
          errors++;
          console.error("[engine.llm] batch failed:", (err as Error).message);
        }
      }
    }

    llmSummary = {
      batches_used: batchesUsed,
      batches_budget: budget,
      input_tokens: inputTok,
      output_tokens: outputTok,
      cache_read_tokens: cacheTok,
      errors,
    };
  }

  unmatchedCount = stage3Unmatched.length - (matched.llm ?? 0);

  const { data: remainingData } = await client.rpc("count_unmapped_market_types");
  const remaining = typeof remainingData === "number" ? remainingData : 0;

  return {
    processed: rows.length,
    matched,
    unmatched: unmatchedCount,
    remaining,
    took_ms: Date.now() - start,
    llm: llmSummary,
  };
}
