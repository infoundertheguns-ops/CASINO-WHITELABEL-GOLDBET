import { describe, it, expect, vi } from "vitest";
import { resolveFlashscoreId } from "../resolve-flashscore-id.js";

const baseEvent = {
  odds_api_id: 12345,
  sport_slug: "football",
  starts_at: new Date("2026-05-01T20:00:00Z"),
  home: "Inter",
  away: "Milan",
};

function mkDeps(steps: { direct?: string | null; search?: { ok: boolean; matchId?: string } }) {
  const queryOne = vi.fn();
  if (steps.direct === undefined) queryOne.mockResolvedValueOnce(null);
  else queryOne.mockResolvedValueOnce(steps.direct ? { flashscore_id: steps.direct } : null);

  const fetchFn = vi.fn(async () => {
    if (steps.search?.ok) return { ok: true, json: async () => ({ matchId: steps.search!.matchId }) } as any;
    return { ok: false, status: 404 } as any;
  });

  return {
    db: { queryOne },
    searchUrl: "http://test:8090",
    apiKey: "k",
    log: { info: vi.fn(), warn: vi.fn() },
    fetch: fetchFn,
  };
}

describe("resolveFlashscoreId", () => {
  it("hits step 1 (v2 direct cache) and skips search", async () => {
    const deps = mkDeps({ direct: "FS-V2-123" });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBe("FS-V2-123");
    expect(deps.db.queryOne).toHaveBeenCalledTimes(1);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("falls through to step 2 (search) when step 1 misses", async () => {
    const deps = mkDeps({ direct: null, search: { ok: true, matchId: "FS-SEARCH-789" } });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBe("FS-SEARCH-789");
    expect(deps.db.queryOne).toHaveBeenCalledTimes(1);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when all steps miss", async () => {
    const deps = mkDeps({ direct: null, search: { ok: false } });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBeNull();
  });

  it("returns null and logs warn on fetch error", async () => {
    const deps = mkDeps({ direct: null });
    deps.fetch = vi.fn(async (): Promise<any> => { throw new Error("ECONNREFUSED"); });
    const result = await resolveFlashscoreId(baseEvent, deps);
    expect(result).toBeNull();
    expect(deps.log.warn).toHaveBeenCalled();
  });

  it("queries events_v2 by odds_api_id (not legacy external_id)", async () => {
    const deps = mkDeps({ direct: "FS-V2-CACHE" });
    await resolveFlashscoreId(baseEvent, deps);
    const call = deps.db.queryOne.mock.calls[0];
    expect(call[0]).toContain("events_v2");
    expect(call[0]).toContain("odds_api_id");
    expect(call[0]).not.toContain("external_id");
    expect(call[1]).toEqual([baseEvent.odds_api_id]);
  });
});
