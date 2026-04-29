import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock createAdminClient (matches existing repo convention — sync, returns supabase client).
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    rpc: vi.fn((fn: string, _args: any) => {
      if (fn === "settlement_coverage_kpis") {
        return Promise.resolve({
          data: [
            { category: "score", legs_total: 800, legs_won: 400, legs_lost: 350, legs_void: 50, legs_pending: 0, stake_total: 8000 },
            { category: "stats", legs_total: 100, legs_won: 40, legs_lost: 50, legs_void: 5, legs_pending: 5, stake_total: 1000 },
            { category: "player", legs_total: 100, legs_won: 10, legs_lost: 80, legs_void: 5, legs_pending: 5, stake_total: 1000 },
          ],
          error: null,
        });
      }
      if (fn === "settlement_coverage_list") {
        return Promise.resolve({
          data: [
            {
              market_type: "1X2",
              category: "score",
              sport: "Calcio",
              bet_count: 500,
              auto_settled: 480,
              manual_settled: 0,
              void_settled: 20,
              pending: 0,
              last_seen_at: "2026-04-29T12:00:00Z",
            },
          ],
          error: null,
        });
      }
      if (fn === "settlement_coverage_filter_kpi") {
        return Promise.resolve({
          data: [{ markets_filtered: 0, total_markets: 0, pct: 0, reason: "mig-154-pending" }],
          error: null,
        });
      }
      if (fn === "settlement_coverage_sla_kpi") {
        return Promise.resolve({
          data: [
            { category: "score", legs_settled: 800, legs_within_sla: 760, settled_within_sla_pct: 95.0 },
            { category: "stats", legs_settled: 100, legs_within_sla: 95, settled_within_sla_pct: 95.0 },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  }),
}));

import { GET } from "@/app/api/admin/settlement-coverage/list/route";

describe("GET /api/admin/settlement-coverage/list", () => {
  it("returns kpis + filter_kpi + sla_kpi + markets shape with default 7-day window", async () => {
    const req = new NextRequest("http://localhost/api/admin/settlement-coverage/list");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("kpis");
    expect(json).toHaveProperty("filter_kpi");
    expect(json).toHaveProperty("sla_kpi");
    expect(json).toHaveProperty("markets");
    expect(json.window_days).toBe(7);

    expect(json.kpis.score.legs_total).toBe(800);
    expect(json.kpis.score.pct_of_total).toBeCloseTo(80, 0); // 800/1000
    expect(json.kpis.stats.legs_pending).toBe(5);

    expect(json.filter_kpi.pct).toBe(0);
    expect(json.filter_kpi.by_reason[0].reason).toBe("mig-154-pending");

    // weighted SLA: (760 + 95) / (800 + 100) = 855/900 = 95%
    expect(json.sla_kpi.settled_within_sla_pct).toBeCloseTo(95.0, 1);

    expect(json.markets[0].market_type).toBe("1X2");
  });

  it("honours window query param + clamps to [1,90]", async () => {
    const reqWindow30 = new NextRequest(
      "http://localhost/api/admin/settlement-coverage/list?window=30"
    );
    const res30 = await GET(reqWindow30);
    expect(res30.status).toBe(200);
    expect((await res30.json()).window_days).toBe(30);

    const reqWindow999 = new NextRequest(
      "http://localhost/api/admin/settlement-coverage/list?window=999"
    );
    const res999 = await GET(reqWindow999);
    expect((await res999.json()).window_days).toBe(90);

    const reqWindow0 = new NextRequest(
      "http://localhost/api/admin/settlement-coverage/list?window=0"
    );
    const res0 = await GET(reqWindow0);
    expect((await res0.json()).window_days).toBe(1);
  });
});
