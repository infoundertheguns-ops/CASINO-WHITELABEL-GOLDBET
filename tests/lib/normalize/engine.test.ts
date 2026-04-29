import { describe, it, expect, vi } from "vitest";
import { runEngine } from "@/lib/normalize/engine";
import type { CanonicalMarket, NormalizationRow } from "@/lib/normalize/types";

const CANONICALS: CanonicalMarket[] = [
  { canonical_key: "1x2_ft",   base_key: "1x2",   period: "ft", canonical_name_it: "1X2",             has_line: false, outcomes: [] },
  { canonical_key: "u_o_ft",   base_key: "u_o",   period: "ft", canonical_name_it: "Under/Over",      has_line: true,  outcomes: [] },
  { canonical_key: "gg_ng_ft", base_key: "gg_ng", period: "ft", canonical_name_it: "Goal/No Goal",    has_line: false, outcomes: [] },
];

function makeFakeClient(opts: {
  unmapped: Array<{ source: string; market_type: string }>;
  verified: NormalizationRow[];
  twobetGroups: Array<{ twobet_g: number; name_it: string }>;
  chunkSize?: number;
}) {
  const upserts: any[] = [];
  const totalUnmapped = opts.unmapped.length;
  const effectiveChunk = opts.chunkSize ?? totalUnmapped;
  return {
    upserts,
    client: {
      rpc: vi.fn(async (name: string, params?: any) => {
        if (name === "list_unmapped_market_types") {
          const limit = params?.p_limit ?? effectiveChunk;
          return { data: opts.unmapped.slice(0, limit), error: null };
        }
        if (name === "count_unmapped_market_types") {
          const remaining = Math.max(0, totalUnmapped - Math.min(effectiveChunk, totalUnmapped));
          return { data: remaining, error: null };
        }
        return { data: [], error: null };
      }),
      from: vi.fn((table: string) => {
        if (table === "market_normalization") {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: opts.verified as any, error: null }),
            }),
            upsert: (row: any) => {
              upserts.push(row);
              return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
            },
          };
        }
        if (table === "canonical_markets") {
          return {
            select: () => Promise.resolve({ data: CANONICALS as any, error: null }),
          };
        }
        if (table === "twobet_market_groups") {
          return {
            select: () => Promise.resolve({ data: opts.twobetGroups as any, error: null }),
          };
        }
        return { select: () => Promise.resolve({ data: [] as any, error: null }) };
      }),
    },
  };
}

describe("runEngine", () => {
  it("matches U/O via regex and upserts canonical_key + line", async () => {
    const { client, upserts } = makeFakeClient({
      unmapped: [{ source: "kambi", market_type: "U/O 2.5" }],
      verified: [],
      twobetGroups: [],
    });
    const summary = await runEngine({ client: client as any, chunkSize: 100 });
    expect(summary.matched.regex).toBe(1);
    expect(upserts[0]).toMatchObject({
      source: "kambi",
      source_market_type: "U/O 2.5",
      canonical_key: "u_o_ft",
      canonical_line: 2.5,
      extracted_by: "regex",
      confidence: 95,
    });
    // Engine no longer includes `verified` in upsert payload (commit ebc3da7)
    // so prior operator confirmations aren't reset when regex re-runs.
    expect(upserts[0]).not.toHaveProperty("verified");
  });

  it("regex takes priority over dictionary when both could match", async () => {
    const { client, upserts } = makeFakeClient({
      unmapped: [{ source: "22bet", market_type: "1X2" }],
      verified: [],
      twobetGroups: [{ twobet_g: 1, name_it: "1x2" }],
    });
    const summary = await runEngine({ client: client as any, chunkSize: 100 });
    expect(summary.matched.regex).toBe(1);
    expect(summary.matched.dictionary).toBe(0);
    expect(upserts[0].canonical_key).toBe("1x2_ft");
  });

  it("respects chunk size and reports remaining", async () => {
    const unmapped = Array.from({ length: 10 }, (_, i) => ({ source: "kambi", market_type: `U/O ${i}.5` }));
    const { client } = makeFakeClient({ unmapped, verified: [], twobetGroups: [], chunkSize: 3 });
    const summary = await runEngine({ client: client as any, chunkSize: 3 });
    expect(summary.processed).toBe(3);
    expect(summary.remaining).toBe(7);
  });
});
