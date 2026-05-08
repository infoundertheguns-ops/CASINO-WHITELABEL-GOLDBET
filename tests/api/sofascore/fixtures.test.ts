import { describe, it, expect } from "vitest";
import {
  matchSofaToCandidate,
  buildPoolQuery,
  SOFA_VALID_SPORTS,
  type SofaFixture,
  type Candidate,
} from "@/app/api/sofascore/fixtures/_lib";

describe("SOFA_VALID_SPORTS", () => {
  it("contains exactly the three EN slugs", () => {
    expect(SOFA_VALID_SPORTS.has("football")).toBe(true);
    expect(SOFA_VALID_SPORTS.has("tennis")).toBe(true);
    expect(SOFA_VALID_SPORTS.has("basketball")).toBe(true);
    expect(SOFA_VALID_SPORTS.size).toBe(3);
  });
  it("does NOT contain Italian slugs (regression guard)", () => {
    expect(SOFA_VALID_SPORTS.has("calcio")).toBe(false);
    expect(SOFA_VALID_SPORTS.has("basket")).toBe(false);
  });
});

describe("buildPoolQuery", () => {
  it("returns EN slug array (regression guard for bug #1)", () => {
    const q = buildPoolQuery();
    expect(q.slugs).toEqual(["football", "tennis", "basketball"]);
  });
  it("returns valid status values matching events_v2 constraint (regression guard for bug #2)", () => {
    const q = buildPoolQuery();
    // pending+live cover prematch+inplay; route.ts adds settled-recent via .or()
    expect(q.statuses).toContain("pending");
    expect(q.statuses).toContain("live");
    expect(q.statuses).not.toContain("prematch");
  });
});

describe("matchSofaToCandidate", () => {
  const baseFx: SofaFixture = {
    sofa_event_id: 1,
    sofa_sport: "football",
    home: "FC Bayern München",
    away: "Paris Saint-Germain",
    kickoff_at: "2026-05-07T19:00:00Z",
    sofa_status: "finished",
    tournament_name: "UEFA Champions League",
    category_name: "Europe",
  };
  const baseC: Candidate = {
    id: "uuid-1",
    sport_slug: "football",
    home: "Bayern Munich",
    away: "PSG",
    starts_at: "2026-05-07T19:05:00Z",
    status: "pending",
    sofascore_id: null,
  };

  it("returns matched_fuzzy on close name + kickoff with EN slug", () => {
    const r = matchSofaToCandidate(baseFx, [baseC]);
    expect(r.kind).toBe("matched_fuzzy");
    if (r.kind === "matched_fuzzy") expect(r.candidate.id).toBe("uuid-1");
  });

  it("returns matched_direct when candidate already has sofascore_id matching fixture", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 1 }]);
    expect(r.kind).toBe("matched_direct");
  });

  it("returns no_time_window when kickoff diff > 20min", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, starts_at: "2026-05-07T20:30:00Z" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("uses 60min tolerance for basketball (sport-specific)", () => {
    // basketball fixture at 19:00, candidate at 19:45 (45min off — within 60min basketball tolerance)
    const fxBasket: SofaFixture = { ...baseFx, sofa_sport: "basketball", sofa_event_id: 7 };
    const cBasket: Candidate = { ...baseC, sport_slug: "basketball", id: "uuid-bk", home: "Lakers", away: "Celtics", starts_at: "2026-05-07T19:45:00Z" };
    const r = matchSofaToCandidate({ ...fxBasket, home: "Lakers LA", away: "Boston Celtics" }, [cBasket]);
    expect(r.kind).toBe("matched_fuzzy");
  });

  it("uses 30min tolerance for tennis (sport-specific)", () => {
    // tennis fixture at 19:00, candidate at 19:25 (25min off — within 30min tennis tolerance)
    const fxTennis: SofaFixture = { ...baseFx, sofa_sport: "tennis", sofa_event_id: 8, home: "Rafael Nadal", away: "Djokovic Novak" };
    const cTennis: Candidate = { ...baseC, sport_slug: "tennis", id: "uuid-tn", home: "Nadal Rafael", away: "Novak Djokovic", starts_at: "2026-05-07T19:25:00Z" };
    const r = matchSofaToCandidate(fxTennis, [cTennis]);
    expect(r.kind).toBe("matched_fuzzy");
  });

  it("football retains 20min default tolerance (does NOT match at 25min off)", () => {
    // football fixture at 19:00, candidate at 19:25 (25min off — outside football 20min tolerance)
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, starts_at: "2026-05-07T19:25:00Z" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("returns no_match_name when names too different", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, home: "Inter Milan", away: "AC Milan" }]);
    expect(r.kind).toBe("no_match_name");
  });

  it("does NOT match across sports (basketball candidate vs football fixture)", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sport_slug: "basketball" }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("ignores already-mapped candidates with different sofa_event_id", () => {
    const r = matchSofaToCandidate(baseFx, [{ ...baseC, sofascore_id: 99 }]);
    expect(r.kind).toBe("no_time_window");
  });

  it("returns skipped_unknown_sport for unsupported sofa_sport", () => {
    const r = matchSofaToCandidate({ ...baseFx, sofa_sport: "rugby" }, [baseC]);
    expect(r.kind).toBe("skipped_unknown_sport");
  });

  it("EN slug pool match — regression guard against re-introducing IT slugs", () => {
    // candidate has EN slug, fixture has EN sport — must match (this is the bug we're fixing)
    const fxBasket: SofaFixture = { ...baseFx, sofa_sport: "basketball", sofa_event_id: 2 };
    const cBasket: Candidate = { ...baseC, sport_slug: "basketball", id: "uuid-b" };
    const r = matchSofaToCandidate(fxBasket, [cBasket]);
    expect(r.kind).toBe("matched_fuzzy");
  });
});

// =====================================================================
// Integration tests for POST /api/sofascore/fixtures
// =====================================================================
import { vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type SupabaseQueryResult = { data: unknown; error: unknown };

interface MockHandlers {
  poolResult?: SupabaseQueryResult;
  updateResult?: SupabaseQueryResult;
  upsertResult?: SupabaseQueryResult;
  capturedUpdates?: Array<Record<string, unknown>>;
  capturedUpserts?: Array<Record<string, unknown>>;
}

function makeSupabaseMock(handlers: MockHandlers) {
  const captured = {
    updates: handlers.capturedUpdates ?? [],
    upserts: handlers.capturedUpserts ?? [],
  };
  return {
    from: vi.fn((table: string) => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.gte = vi.fn(() => builder);
      builder.lte = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => Promise.resolve(handlers.poolResult ?? { data: [], error: null }));
      builder.update = vi.fn((payload: Record<string, unknown>) => {
        captured.updates.push({ table, ...payload });
        const eqBuilder: any = {};
        eqBuilder.eq = vi.fn(() => Promise.resolve(handlers.updateResult ?? { error: null }));
        return eqBuilder;
      });
      builder.upsert = vi.fn((payload: Record<string, unknown>) => {
        captured.upserts.push({ table, ...payload });
        return Promise.resolve(handlers.upsertResult ?? { error: null });
      });
      return builder;
    }),
    _captured: captured,
  };
}

let _activeMock: ReturnType<typeof makeSupabaseMock> | null = null;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => _activeMock,
}));

beforeEach(() => {
  process.env.SCRAPER_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  _activeMock = null;
});

async function callRoute(body: unknown, key: string | null = "test-key") {
  const { POST } = await import("@/app/api/sofascore/fixtures/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-scraper-key"] = key;
  const req = new NextRequest("http://localhost/api/sofascore/fixtures", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/sofascore/fixtures", () => {
  it("rejects requests without scraper key (401)", async () => {
    _activeMock = makeSupabaseMock({});
    const res = await callRoute({ fixtures: [] }, null);
    expect(res.status).toBe(401);
  });

  it("rejects requests where fixtures is not an array (400)", async () => {
    _activeMock = makeSupabaseMock({});
    const res = await callRoute({ fixtures: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("processes fixtures and returns stats + matched array (EN slugs)", async () => {
    const futureIso = "2026-05-07T19:05:00Z";
    const poolRows = [
      {
        id: "uuid-football",
        sport_slug: "football",
        home: "Bayern Munich",
        away: "PSG",
        starts_at: futureIso,
        status: "pending",
        sofascore_id: null,
      },
      {
        id: "uuid-basketball",
        sport_slug: "basketball",
        home: "Lakers",
        away: "Celtics",
        starts_at: futureIso,
        status: "pending",
        sofascore_id: null,
      },
    ];
    _activeMock = makeSupabaseMock({ poolResult: { data: poolRows, error: null } });

    const fixtures = [
      {
        sofa_event_id: 1001,
        sofa_sport: "football",
        home: "FC Bayern München",
        away: "Paris Saint-Germain",
        kickoff_at: "2026-05-07T19:00:00Z",
        sofa_status: "finished",
        tournament_name: "UCL",
        category_name: "Europe",
      },
      {
        sofa_event_id: 1002,
        sofa_sport: "football",
        home: "Random FC",
        away: "Other United",
        kickoff_at: "2026-05-07T19:00:00Z",
        sofa_status: "finished",
        tournament_name: "X",
        category_name: null,
      },
      {
        sofa_event_id: 1003,
        sofa_sport: "rugby",
        home: "All Blacks",
        away: "Springboks",
        kickoff_at: "2026-05-07T19:00:00Z",
        sofa_status: "finished",
        tournament_name: "X",
        category_name: null,
      },
    ];
    const res = await callRoute({ fixtures });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matched_fuzzy).toBe(1);
    expect(json.skipped_unknown_sport).toBe(1);
    expect((json.no_match_name ?? 0) + (json.no_time_window ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(json.matched)).toBe(true);
    expect(json.matched).toHaveLength(1);
    expect(json.matched[0]).toMatchObject({
      sofa_event_id: 1001,
      event_v2_id: "uuid-football",
      sport_slug: "football",
    });
  });

  it("includes recently-finished events in candidate pool (status=settled within 6h)", async () => {
    const recentSettledIso = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const fxIso = recentSettledIso;
    const poolRows = [
      {
        id: "uuid-recent",
        sport_slug: "football",
        home: "Bayern Munich",
        away: "PSG",
        starts_at: recentSettledIso,
        status: "settled",
        sofascore_id: null,
      },
    ];
    _activeMock = makeSupabaseMock({ poolResult: { data: poolRows, error: null } });

    const fixtures = [
      {
        sofa_event_id: 2001,
        sofa_sport: "football",
        home: "FC Bayern München",
        away: "Paris Saint-Germain",
        kickoff_at: fxIso,
        sofa_status: "finished",
        tournament_name: "UCL",
        category_name: "Europe",
      },
    ];
    const res = await callRoute({ fixtures });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matched_fuzzy).toBe(1);
    expect(json.matched[0].event_v2_id).toBe("uuid-recent");
  });
});
