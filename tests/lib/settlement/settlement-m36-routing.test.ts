// tests/lib/settlement/settlement-m36-routing.test.ts
//
// M3.6 integration tests — verify the per-leg routing logic in
// `lib/settlement.ts#settleEvent` correctly:
//   1. Routes canonical football markets to api-football and logs dual-source
//   2. Defers to the FS path when api-football returns a null verdict
//   3. Routes non-canonical / non-football markets straight to the FS path
//
// The full settleEvent function performs many supabase round-trips. We mock
// the supabase client with chainable helpers and intercept logDualSource +
// classifyLegAF / classifyLeg (the FS planD classifier) to assert which
// branch fired per leg.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (must be declared before module imports) ──────────────
const logDualSourceMock = vi.fn(async () => {});
const classifyLegAFMock = vi.fn();
const classifyLegFSMock = vi.fn();

vi.mock("@/lib/settlement/dual-source-log", () => ({
  logDualSource: (...args: unknown[]) => logDualSourceMock(...args),
}));

vi.mock("@/lib/settlement/api-football/classify-af", () => ({
  classifyLegAF: (...args: unknown[]) => classifyLegAFMock(...args),
}));

// Intercept the planD FS classifier so we can detect FS-path invocations
// without needing real FS scoring data. Keep buildResultFromAF + the rest
// of the imports live (we want the real source-router + buildResultFromAF).
vi.mock("@/lib/settlement/odds-api/classify", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/settlement/odds-api/classify")
  >("@/lib/settlement/odds-api/classify");
  return {
    ...actual,
    classifyLeg: (...args: unknown[]) => classifyLegFSMock(...args),
  };
});

// Import after mocks so settlement.ts wires to the mocked deps.
import { settleEvent } from "@/lib/settlement";

// ─── Supabase mock builder ───────────────────────────────────────────────
interface FakeEventRow {
  id: string;
  home?: string | null;
  away?: string | null;
  score_home: number;
  score_away: number;
  status: string;
  live_data: Record<string, unknown> | null;
  last_settled_at: string | null;
  period?: string | null;
  sport_slug: string;
  period_scores?: Record<string, unknown> | null;
}

interface FakeLeg {
  id: string;
  bet_id: string;
  market_type: string;
  outcome_name: string;
  line: number | null;
}

interface FakeDb {
  event: FakeEventRow;
  legs: FakeLeg[];
  updates: Array<{ id: string; result: string }>;
}

function makeSupabase(db: FakeDb) {
  const eventsV2 = {
    select: (_cols: string) => ({
      eq: (_field: string, _id: string) => ({
        single: async () => ({ data: { ...db.event }, error: null }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: (_f: string, _v: string) => ({
        is: (_g: string, _h: unknown) => ({
          select: (_c: string) => Promise.resolve({
            // optimistic lock returns the row
            data: [{ id: db.event.id }],
            error: null,
          }),
        }),
        // settlement_log path (no .is/.select)
        then: (resolve: (v: unknown) => void) => {
          // Apply the patch (e.g. last_settled_at clear) silently.
          if ("last_settled_at" in patch) {
            db.event.last_settled_at = patch.last_settled_at as string | null;
          }
          resolve({ data: null, error: null });
        },
      }),
    }),
  };

  const legRowsForFetch = () => db.legs.map(l => ({
    id: l.id,
    bet_id: l.bet_id,
    event_id: db.event.id,
    market_id: `m-${l.id}`,
    outcome_id: `o-${l.id}`,
    odds_at_placement: 2.0,
    markets: { market_type: l.market_type, line: l.line },
    outcomes: { name: l.outcome_name },
    bets: {
      id: l.bet_id,
      user_id: "u-1",
      stake: 10,
      potential_win: 20,
      total_odds: 2.0,
      status: "pending",
    },
  }));

  const betSelections = {
    select: (_cols: string) => {
      // resolveBet uses `.select("result, odds_at_placement").eq("bet_id", id)`
      // (awaited directly) — return a thenable.
      const buildResolveBetRows = () => db.updates.map(u => ({
        result: u.result,
        odds_at_placement: 2.0,
      }));
      const eqResult = {
        is: async (_g: string, _h: unknown) => ({
          data: legRowsForFetch(),
          error: null,
        }),
        then: (resolve: (v: unknown) => void) => {
          resolve({ data: buildResolveBetRows(), error: null });
        },
      };
      return {
        eq: (_f: string, _v: string) => eqResult,
      };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: async (_f: string, id: string) => {
        db.updates.push({ id, result: String(patch.result) });
        return { data: null, error: null };
      },
    }),
  };

  const settlementLog = {
    insert: async (_row: Record<string, unknown>) => ({ data: null, error: null }),
  };

  const bets = {
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: {
            id: db.legs[0]?.bet_id ?? "b-1",
            user_id: "u-1",
            stake: 10,
            total_odds: 2.0,
            status: "pending",
            parent_bet_id: null,
          },
          error: null,
        }),
      }),
    }),
    update: () => ({ eq: async () => ({ data: null, error: null }) }),
  };

  return {
    from: (table: string) => {
      if (table === "events_v2") return eventsV2;
      if (table === "bet_selections") {
        return betSelections;
      }
      if (table === "settlement_log") return settlementLog;
      if (table === "bets") return bets;
      // Generic chainable mock for everything else (markets, wallets,
      // wallet_transactions, market_normalization, etc.).
      // Every method returns the chain object itself so any sequence of
      // .select().eq().eq().update()... resolves to an empty-data response.
      const chain: Record<string, unknown> = {};
      const emptyResp = { data: [], error: null };
      const single = async () => ({ data: null, error: null });
      const passthrough = () => chain;
      Object.assign(chain, {
        select: passthrough,
        insert: passthrough,
        update: passthrough,
        delete: passthrough,
        eq: passthrough,
        neq: passthrough,
        in: passthrough,
        is: passthrough,
        not: passthrough,
        match: passthrough,
        single,
        maybeSingle: single,
        then: (resolve: (v: unknown) => void) => resolve(emptyResp),
      });
      return chain;
    },
  };
}

// ─── Test fixtures ───────────────────────────────────────────────────────
function makeFootballEvent(overrides: Partial<FakeEventRow> = {}): FakeEventRow {
  return {
    id: "evt-1",
    home: "Juventus",
    away: "Inter",
    score_home: 2,
    score_away: 1,
    status: "ended",
    live_data: {
      halfScoreHome: [1, 1],
      halfScoreAway: [0, 1],
      statistics_af: [
        { team: { name: "Juventus" }, statistics: [
          { type: "Corner Kicks", value: 6 },
          { type: "Total Shots", value: 12 },
        ]},
        { team: { name: "Inter" }, statistics: [
          { type: "Corner Kicks", value: 4 },
          { type: "Total Shots", value: 8 },
        ]},
      ],
    },
    last_settled_at: null,
    period: "FT",
    sport_slug: "football",
    period_scores: {
      firstHalf: { home: 1, away: 0 },
      secondHalf: { home: 1, away: 1 },
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────
describe("settleEvent — M3.6 api-football canonical routing", () => {
  beforeEach(() => {
    logDualSourceMock.mockClear();
    classifyLegAFMock.mockClear();
    classifyLegFSMock.mockClear();
    // Ensure planD engine is enabled (matches production .env)
    process.env.SETTLE_VIA_ODDS_API = "true";
  });

  it("routes football 1x2 to api-football and logs dual-source", async () => {
    classifyLegAFMock.mockReturnValue({ verdict: "won" });
    const db: FakeDb = {
      event: makeFootballEvent(),
      legs: [{ id: "leg-1", bet_id: "bet-1", market_type: "1x2", outcome_name: "1", line: null }],
      updates: [],
    };
    const supabase = makeSupabase(db);
    const result = await settleEvent(supabase as never, "evt-1");
    expect(result.success).toBe(true);
    expect(classifyLegAFMock).toHaveBeenCalledOnce();
    expect(classifyLegFSMock).not.toHaveBeenCalled();
    expect(logDualSourceMock).toHaveBeenCalledOnce();
    const logArgs = logDualSourceMock.mock.calls[0][0] as {
      betId: string; canonicalVerdict: string; marketType: string; sport: string;
    };
    expect(logArgs.betId).toBe("leg-1");
    expect(logArgs.canonicalVerdict).toBe("won");
    expect(logArgs.marketType).toBe("1x2");
    expect(logArgs.sport).toBe("football");
  });

  it("routes football total_corners to api-football", async () => {
    classifyLegAFMock.mockReturnValue({ verdict: "lost" });
    const db: FakeDb = {
      event: makeFootballEvent(),
      legs: [{
        id: "leg-2",
        bet_id: "bet-2",
        market_type: "total_corners",
        outcome_name: "Over 12.5",
        line: 12.5,
      }],
      updates: [],
    };
    const supabase = makeSupabase(db);
    await settleEvent(supabase as never, "evt-1");
    expect(classifyLegAFMock).toHaveBeenCalledOnce();
    expect(classifyLegFSMock).not.toHaveBeenCalled();
    expect(logDualSourceMock).toHaveBeenCalledOnce();
  });

  it("routes football to_score_2plus_goals to api-football", async () => {
    classifyLegAFMock.mockReturnValue({ verdict: "won" });
    const db: FakeDb = {
      event: makeFootballEvent({
        live_data: {
          ...makeFootballEvent().live_data,
          players_af_ft: [
            { players: [{ player: { name: "Vlahovic" }, statistics: [{ goals: { total: 2 } }] }] },
          ],
        },
      }),
      legs: [{
        id: "leg-3",
        bet_id: "bet-3",
        market_type: "to_score_2plus_goals",
        outcome_name: "Vlahovic",
        line: null,
      }],
      updates: [],
    };
    const supabase = makeSupabase(db);
    await settleEvent(supabase as never, "evt-1");
    expect(classifyLegAFMock).toHaveBeenCalledOnce();
    expect(logDualSourceMock).toHaveBeenCalledOnce();
  });

  it("falls back to FS when api-football classifier returns null verdict", async () => {
    // Simulate missing AF stats / unsupported market — classifier returns null.
    classifyLegAFMock.mockReturnValue({ verdict: null, reason: "data_missing" });
    classifyLegFSMock.mockReturnValue({ verdict: "won" });
    const db: FakeDb = {
      event: makeFootballEvent({ live_data: { halfScoreHome: [1, 1], halfScoreAway: [0, 1] } }),
      legs: [{ id: "leg-4", bet_id: "bet-4", market_type: "1x2", outcome_name: "1", line: null }],
      updates: [],
    };
    const supabase = makeSupabase(db);
    const result = await settleEvent(supabase as never, "evt-1");
    expect(result.success).toBe(true);
    expect(classifyLegAFMock).toHaveBeenCalledOnce();
    expect(classifyLegFSMock).toHaveBeenCalledOnce(); // FS path took over
    // No dual-source log when canonical verdict is null
    expect(logDualSourceMock).not.toHaveBeenCalled();
    // The FS verdict should be persisted
    expect(db.updates).toEqual([{ id: "leg-4", result: "won" }]);
  });

  it("routes basketball ml directly to FS (no AF path for non-football)", async () => {
    classifyLegFSMock.mockReturnValue({ verdict: "won" });
    const db: FakeDb = {
      event: makeFootballEvent({ sport_slug: "basketball" }),
      legs: [{ id: "leg-5", bet_id: "bet-5", market_type: "ml", outcome_name: "1", line: null }],
      updates: [],
    };
    const supabase = makeSupabase(db);
    await settleEvent(supabase as never, "evt-1");
    expect(classifyLegAFMock).not.toHaveBeenCalled();
    expect(classifyLegFSMock).toHaveBeenCalledOnce();
    expect(logDualSourceMock).not.toHaveBeenCalled();
  });

  it("routes football anytime_goalscorer to FS (legacy scorer market not in AF canonical set)", async () => {
    classifyLegFSMock.mockReturnValue({ verdict: "won" });
    const db: FakeDb = {
      event: makeFootballEvent(),
      legs: [{
        id: "leg-6",
        bet_id: "bet-6",
        market_type: "anytime_goalscorer",
        outcome_name: "Vlahovic",
        line: null,
      }],
      updates: [],
    };
    const supabase = makeSupabase(db);
    await settleEvent(supabase as never, "evt-1");
    expect(classifyLegAFMock).not.toHaveBeenCalled();
    expect(classifyLegFSMock).toHaveBeenCalledOnce();
    expect(logDualSourceMock).not.toHaveBeenCalled();
  });

  it("does not throw when logDualSource fails (best-effort defensive guard)", async () => {
    classifyLegAFMock.mockReturnValue({ verdict: "won" });
    logDualSourceMock.mockRejectedValueOnce(new Error("supabase down"));
    const db: FakeDb = {
      event: makeFootballEvent(),
      legs: [{ id: "leg-7", bet_id: "bet-7", market_type: "1x2", outcome_name: "1", line: null }],
      updates: [],
    };
    const supabase = makeSupabase(db);
    const result = await settleEvent(supabase as never, "evt-1");
    expect(result.success).toBe(true);
    // The verdict still gets persisted despite the log failure
    expect(db.updates).toEqual([{ id: "leg-7", result: "won" }]);
  });
});
