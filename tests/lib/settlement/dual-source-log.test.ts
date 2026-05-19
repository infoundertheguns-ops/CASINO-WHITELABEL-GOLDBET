import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────
// Hoisted mock containers so each test can reset / inspect.
const supabaseInsertMock = vi.fn();
const buildResultMock = vi.fn();
const classifyLegMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: supabaseInsertMock,
    }),
  }),
}));

vi.mock("@/lib/settlement", () => ({
  __test__buildResult: (...args: unknown[]) => buildResultMock(...args),
}));

vi.mock("@/lib/settlement/odds-api/classify", async () => {
  // Re-export real types via passthrough so the importing module still
  // satisfies its TS type imports. Only `classifyLeg` is intercepted.
  return {
    classifyLeg: (...args: unknown[]) => classifyLegMock(...args),
  };
});

// Import AFTER mocks so the module under test wires to the mocked deps.
import { logDualSource } from "@/lib/settlement/dual-source-log";

const baseInput = {
  betId: "bet-1111",
  marketType: "1X2",
  event: { score_home: 2, score_away: 1, live_data: {} },
  leg: { market_type: "1X2", outcome_name: "1", line: null },
  sport: "calcio",
};

describe("logDualSource", () => {
  beforeEach(() => {
    supabaseInsertMock.mockReset().mockResolvedValue({ error: null });
    buildResultMock.mockReset().mockReturnValue({
      home: 2,
      away: 1,
      total: 3,
      sport: "calcio",
    });
    classifyLegMock.mockReset().mockReturnValue({ verdict: "won" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("agreement path: canonical=won shadow=won -> inserts disagreement=false", async () => {
    await logDualSource({ ...baseInput, canonicalVerdict: "won" });

    expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
    const row = supabaseInsertMock.mock.calls[0][0];
    expect(row).toMatchObject({
      bet_id: "bet-1111",
      market_type: "1X2",
      canonical_source: "api-football",
      canonical_verdict: "won",
      shadow_source: "fs",
      shadow_verdict: "won",
      disagreement: false,
    });
  });

  it("disagreement path: canonical=won shadow=lost -> inserts disagreement=true", async () => {
    classifyLegMock.mockReturnValue({ verdict: "lost" });

    await logDualSource({ ...baseInput, canonicalVerdict: "won" });

    expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
    const row = supabaseInsertMock.mock.calls[0][0];
    expect(row.canonical_verdict).toBe("won");
    expect(row.shadow_verdict).toBe("lost");
    expect(row.disagreement).toBe(true);
  });

  it("shadow builder throws -> swallows, logs error, still inserts with shadow=null + disagreement=true", async () => {
    buildResultMock.mockImplementation(() => {
      throw new Error("FS event corrupted");
    });
    const errSpy = vi.spyOn(console, "error");

    const result = await logDualSource({ ...baseInput, canonicalVerdict: "won" });

    expect(result).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
    const row = supabaseInsertMock.mock.calls[0][0];
    expect(row.shadow_verdict).toBeNull();
    expect(row.disagreement).toBe(true); // null shadow counts as disagreement
  });

  it("supabase insert error -> swallows, logs error, does NOT throw", async () => {
    supabaseInsertMock.mockResolvedValue({ error: { message: "RLS denied" } });
    const errSpy = vi.spyOn(console, "error");

    await expect(
      logDualSource({ ...baseInput, canonicalVerdict: "won" })
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    // The call WAS made — the error is post-insert handling.
    expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
  });

  it("supabase insert throws -> swallows, logs error, does NOT throw", async () => {
    supabaseInsertMock.mockRejectedValue(new Error("network down"));
    const errSpy = vi.spyOn(console, "error");

    await expect(
      logDualSource({ ...baseInput, canonicalVerdict: "won" })
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
  });

  it("returns void (no return value)", async () => {
    const ret = await logDualSource({ ...baseInput, canonicalVerdict: "won" });
    expect(ret).toBeUndefined();
  });

  it("null buildResult (event missing scores) -> shadow=null + disagreement=true, no throw", async () => {
    buildResultMock.mockReturnValue(null);

    await logDualSource({ ...baseInput, canonicalVerdict: "won" });

    expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
    const row = supabaseInsertMock.mock.calls[0][0];
    expect(row.shadow_verdict).toBeNull();
    expect(row.disagreement).toBe(true);
    // classifyLeg should NOT be called when buildResult returned null
    expect(classifyLegMock).not.toHaveBeenCalled();
  });
});
