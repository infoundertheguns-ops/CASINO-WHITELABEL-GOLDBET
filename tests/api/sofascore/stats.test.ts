import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ENRICHMENT_KEYS } from "@/app/api/sofascore/enrichment/_lib";

type SupabaseQueryResult = { data: unknown; error: unknown };

interface MockHandlers {
  ev2Result?: SupabaseQueryResult;
  enrichmentResult?: SupabaseQueryResult;
  systemConfigResult?: SupabaseQueryResult;
}

/**
 * Each builder method returns a thenable proxy: it is itself a chainable
 * builder AND a Promise resolving to the configured table result.
 * This mirrors supabase-js v2 PostgrestQueryBuilder semantics where any
 * point in the chain can be awaited.
 */
function makeSupabaseMock(handlers: MockHandlers) {
  return {
    from: vi.fn((table: string) => {
      const result =
        table === "events_v2"
          ? handlers.ev2Result ?? { data: [], error: null }
          : table === "event_enrichment"
            ? handlers.enrichmentResult ?? { data: [], error: null }
            : table === "system_config"
              ? handlers.systemConfigResult ?? { data: [], error: null }
              : { data: [], error: null };

      const builder: any = {};
      const wrap = () => {
        const p = Promise.resolve(result);
        builder.then = p.then.bind(p);
        builder.catch = p.catch.bind(p);
        builder.finally = p.finally.bind(p);
        return builder;
      };
      builder.select = vi.fn(() => wrap());
      builder.not = vi.fn(() => wrap());
      builder.in = vi.fn(() => wrap());
      builder.eq = vi.fn(() => wrap());
      return builder;
    }),
  };
}

let _activeMock: ReturnType<typeof makeSupabaseMock> | null = null;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => _activeMock,
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  _activeMock = null;
});

async function callRoute() {
  const { GET } = await import("@/app/api/sofascore/stats/route");
  const req = new NextRequest("http://localhost/api/sofascore/stats", {
    method: "GET",
  });
  return GET(req);
}

describe("GET /api/sofascore/stats", () => {
  it("empty case returns zeros for all fields", async () => {
    _activeMock = makeSupabaseMock({
      ev2Result: { data: [], error: null },
      enrichmentResult: { data: [], error: null },
      systemConfigResult: { data: [], error: null },
    });
    const res = await callRoute();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matched_total).toBe(0);
    expect(json.by_sport).toEqual({ calcio: 0, tennis: 0, basket: 0 });
    expect(Object.keys(json.by_endpoint_freshness).length).toBe(ENRICHMENT_KEYS.length);
    for (const k of ENRICHMENT_KEYS) {
      expect(json.by_endpoint_freshness).toHaveProperty(k);
      expect(json.by_endpoint_freshness[k].populated_pct).toBe(0);
      expect(json.by_endpoint_freshness[k].median_age_s).toBe(0);
    }
    expect(json.last_run_at).toEqual({
      last_run_sofascore_fixtures: null,
      last_run_sofascore_enrichment: null,
    });
  });

  it("counts matched_total and by_sport from events_v2 rows", async () => {
    _activeMock = makeSupabaseMock({
      ev2Result: {
        data: [
          { sport_slug: "calcio" },
          { sport_slug: "calcio" },
          { sport_slug: "calcio" },
          { sport_slug: "tennis" },
          { sport_slug: "tennis" },
        ],
        error: null,
      },
      enrichmentResult: { data: [], error: null },
      systemConfigResult: { data: [], error: null },
    });
    const res = await callRoute();
    const json = await res.json();
    expect(json.matched_total).toBe(5);
    expect(json.by_sport).toEqual({ calcio: 3, tennis: 2, basket: 0 });
  });

  it("computes endpoint freshness populated_pct and median_age_s", async () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
    _activeMock = makeSupabaseMock({
      ev2Result: { data: [], error: null },
      enrichmentResult: {
        data: [
          { stats: { x: 1 }, last_synced_at: iso(30_000) },
          { stats: { x: 2 }, last_synced_at: iso(60_000) },
          { stats: null, last_synced_at: null },
        ],
        error: null,
      },
      systemConfigResult: { data: [], error: null },
    });
    const res = await callRoute();
    const json = await res.json();
    expect(json.by_endpoint_freshness.stats.populated_pct).toBeCloseTo(66.67, 1);
    // ages sorted [30, 60]; Math.floor(2/2)=1 → picks ages[1] = 60
    expect(json.by_endpoint_freshness.stats.median_age_s).toBeGreaterThanOrEqual(59);
    expect(json.by_endpoint_freshness.stats.median_age_s).toBeLessThanOrEqual(61);
    // other keys untouched → populated_pct=0, median=0
    expect(json.by_endpoint_freshness.lineups.populated_pct).toBe(0);
    expect(json.by_endpoint_freshness.lineups.median_age_s).toBe(0);
  });

  it("parses last_run_at JSON-stringified ISO timestamps", async () => {
    const fixturesTs = "2026-05-07T10:00:00.000Z";
    const enrichTs = "2026-05-07T10:05:00.000Z";
    _activeMock = makeSupabaseMock({
      ev2Result: { data: [], error: null },
      enrichmentResult: { data: [], error: null },
      systemConfigResult: {
        data: [
          { key: "last_run_sofascore_fixtures", value: JSON.stringify(fixturesTs) },
          { key: "last_run_sofascore_enrichment", value: JSON.stringify(enrichTs) },
        ],
        error: null,
      },
    });
    const res = await callRoute();
    const json = await res.json();
    expect(json.last_run_at.last_run_sofascore_fixtures).toBe(fixturesTs);
    expect(json.last_run_at.last_run_sofascore_enrichment).toBe(enrichTs);
  });
});
