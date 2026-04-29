import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function buildMockSupabase(opts: { betsData?: any[]; eventsData?: any[]; betsError?: any; eventsError?: any } = {}) {
  const betsData = opts.betsData ?? [];
  const eventsData = opts.eventsData ?? [];

  return {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => {
          if (table === "bet_selections") {
            return Promise.resolve({ data: betsData, error: opts.betsError ?? null });
          }
          if (table === "events") {
            return Promise.resolve({ data: eventsData, error: opts.eventsError ?? null });
          }
          return Promise.resolve({ data: [], error: null });
        }),
      };
      return chain;
    }),
  };
}

let mockState: ReturnType<typeof buildMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => mockState,
}));

import { GET } from "@/app/api/admin/settlement-coverage/drill-down/route";

describe("GET /api/admin/settlement-coverage/drill-down", () => {
  it("rejects missing market_type with 400", async () => {
    mockState = buildMockSupabase();
    const req = new NextRequest("http://localhost/api/admin/settlement-coverage/drill-down");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/market_type/);
  });

  it("returns recent_bets + recent_events shape", async () => {
    mockState = buildMockSupabase({
      betsData: [
        {
          id: "bs-1",
          result: "won",
          settled_at: "2026-04-29T11:00:00Z",
          bets: { id: "b-1", stake: "10.00", status: "settled", created_at: "2026-04-29T10:00:00Z" },
          markets: { market_type: "1X2", line: null },
          outcomes: { name: "1", odds: 1.85 },
        },
      ],
      eventsData: [
        {
          id: "e-1",
          external_id: "odds-api:12345",
          flashscore_id: "fs-99",
          score_home: 2,
          score_away: 1,
          starts_at: "2026-04-29T08:00:00Z",
          status: "ended",
          sports: { name: "Calcio" },
          markets: { market_type: "1X2" },
        },
        // Duplicate due to join — should be deduped
        {
          id: "e-1",
          external_id: "odds-api:12345",
          flashscore_id: "fs-99",
          score_home: 2,
          score_away: 1,
          starts_at: "2026-04-29T08:00:00Z",
          status: "ended",
          sports: { name: "Calcio" },
          markets: { market_type: "1X2" },
        },
      ],
    });

    const req = new NextRequest(
      "http://localhost/api/admin/settlement-coverage/drill-down?market_type=1X2&limit=20"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const j = await res.json();

    expect(j.market_type).toBe("1X2");
    expect(j.recent_bets).toHaveLength(1);
    expect(j.recent_bets[0].bet_selection_id).toBe("bs-1");
    expect(j.recent_bets[0].outcome_name).toBe("1");

    expect(j.recent_events).toHaveLength(1); // deduped
    expect(j.recent_events[0].has_flashscore_id).toBe(true);
    expect(j.recent_events[0].has_score).toBe(true);
    expect(j.recent_events[0].sport).toBe("Calcio");
  });
});
