import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildPartialUpsert,
  mergeEndpointStatus,
  type EnrichmentPayload,
  type EndpointStatus,
} from "@/app/api/sofascore/enrichment/_lib";

describe("buildPartialUpsert", () => {
  it("includes only keys explicitly provided (incl null), omits undefined", () => {
    const input: EnrichmentPayload = {
      stats: { foo: 1 },
      lineups: null,
    };
    const result = buildPartialUpsert(input);
    expect(result).toHaveProperty("stats", { foo: 1 });
    expect(result).toHaveProperty("lineups", null);
    expect(result).not.toHaveProperty("incidents");
  });

  it("returns empty object when payload empty", () => {
    expect(buildPartialUpsert({})).toEqual({});
  });

  it("ignores keys outside ENRICHMENT_KEYS", () => {
    const input = { stats: { x: 1 }, unknown_key: "should-not-appear" } as any;
    const r = buildPartialUpsert(input);
    expect(r).toHaveProperty("stats");
    expect(r).not.toHaveProperty("unknown_key");
  });
});

describe("mergeEndpointStatus", () => {
  it("preserves untouched keys (shallow merge)", () => {
    const prior: Record<string, EndpointStatus> = {
      stats: { ok: true, http: 200, size: 100, ts: "T1" },
      lineups: { ok: false, http: 404, size: 0, ts: "T1" },
    };
    const next: Record<string, EndpointStatus> = {
      stats: { ok: true, http: 200, size: 200, ts: "T2" },
    };
    const merged = mergeEndpointStatus(prior, next);
    expect(merged.stats.ts).toBe("T2");
    expect(merged.stats.size).toBe(200);
    expect(merged.lineups.ts).toBe("T1");
  });

  it("returns empty when both inputs empty", () => {
    expect(mergeEndpointStatus({}, {})).toEqual({});
  });
});

// =====================================================================
// Integration tests for POST /api/sofascore/enrichment
// =====================================================================
import { NextRequest } from "next/server";

type SupabaseQueryResult = { data: unknown; error: unknown };

interface MockHandlers {
  ev2Result?: SupabaseQueryResult;
  priorResult?: SupabaseQueryResult;
  enrichmentUpsertResult?: SupabaseQueryResult;
  systemConfigUpsertResult?: SupabaseQueryResult;
  capturedUpserts?: Array<Record<string, unknown>>;
}

function makeSupabaseMock(handlers: MockHandlers) {
  const captured = {
    upserts: handlers.capturedUpserts ?? [],
  };
  return {
    from: vi.fn((table: string) => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(() => {
        if (table === "events_v2") {
          return Promise.resolve(handlers.ev2Result ?? { data: null, error: null });
        }
        if (table === "event_enrichment") {
          return Promise.resolve(handlers.priorResult ?? { data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      builder.upsert = vi.fn((payload: Record<string, unknown>, opts?: unknown) => {
        captured.upserts.push({ table, payload, opts });
        if (table === "event_enrichment") {
          return Promise.resolve(handlers.enrichmentUpsertResult ?? { error: null });
        }
        if (table === "system_config") {
          return Promise.resolve(handlers.systemConfigUpsertResult ?? { error: null });
        }
        return Promise.resolve({ error: null });
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
  const { POST } = await import("@/app/api/sofascore/enrichment/route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-scraper-key"] = key;
  const req = new NextRequest("http://localhost/api/sofascore/enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/sofascore/enrichment", () => {
  it("rejects requests without scraper key (401)", async () => {
    _activeMock = makeSupabaseMock({});
    const res = await callRoute({ sofa_event_id: 1, sport_slug: "calcio" }, null);
    expect(res.status).toBe(401);
  });

  it("rejects requests with missing required fields (400)", async () => {
    _activeMock = makeSupabaseMock({});
    const res = await callRoute({ sport_slug: "calcio" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when no events_v2 row matches sofa_event_id", async () => {
    _activeMock = makeSupabaseMock({ ev2Result: { data: null, error: null } });
    const res = await callRoute({ sofa_event_id: 999, sport_slug: "calcio" });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/no events_v2 row/i);
  });

  it("inserts new event_enrichment row when sofa_event_id matches", async () => {
    _activeMock = makeSupabaseMock({
      ev2Result: { data: { id: "uuid-1" }, error: null },
      priorResult: { data: null, error: null },
    });
    const body = {
      sofa_event_id: 1001,
      sport_slug: "calcio" as const,
      payloads: { stats: { x: 1 } },
      endpoint_status: {
        stats: { ok: true, http: 200, size: 10, ts: "T" },
      },
    };
    const res = await callRoute(body);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.event_v2_id).toBe("uuid-1");

    const enrichmentUpsert = _activeMock!._captured.upserts.find(
      (u) => u.table === "event_enrichment"
    );
    expect(enrichmentUpsert).toBeDefined();
    const payload = enrichmentUpsert!.payload as Record<string, unknown>;
    expect(payload.event_v2_id).toBe("uuid-1");
    expect(payload.sofa_event_id).toBe(1001);
    expect(payload.sport_slug).toBe("calcio");
    expect(payload.stats).toEqual({ x: 1 });
    expect(payload.last_endpoint_status).toMatchObject({
      stats: { ts: "T" },
    });
  });

  it("partial update preserves untouched columns + REPLACES endpoint_status (drops orphan keys)", async () => {
    _activeMock = makeSupabaseMock({
      ev2Result: { data: { id: "uuid-2" }, error: null },
      priorResult: {
        data: {
          last_endpoint_status: {
            stats: { ok: true, http: 200, size: 100, ts: "T1" },
            lineups: { ok: false, http: 404, size: 0, ts: "T1" },
          },
        },
        error: null,
      },
    });
    const body = {
      sofa_event_id: 2002,
      sport_slug: "calcio" as const,
      payloads: { stats: { y: 2 } },
      endpoint_status: {
        stats: { ok: true, http: 200, size: 200, ts: "T2" },
      },
    };
    const res = await callRoute(body);
    expect(res.status).toBe(200);

    const enrichmentUpsert = _activeMock!._captured.upserts.find(
      (u) => u.table === "event_enrichment"
    );
    expect(enrichmentUpsert).toBeDefined();
    const payload = enrichmentUpsert!.payload as Record<string, unknown>;
    const status = payload.last_endpoint_status as Record<string, EndpointStatus>;
    expect(status.stats.ts).toBe("T2");
    // REPLACE semantics: orphan key from prior must be dropped
    expect(status.lineups).toBeUndefined();
    expect(payload).toHaveProperty("stats", { y: 2 });
    expect(payload).not.toHaveProperty("lineups");

    const sysCfgUpsert = _activeMock!._captured.upserts.find(
      (u) => u.table === "system_config"
    );
    expect(sysCfgUpsert).toBeDefined();
    const sysPayload = sysCfgUpsert!.payload as Record<string, unknown>;
    expect(sysPayload.key).toBe("last_run_sofascore_enrichment");
  });

  it("keeps prior endpoint_status when body omits it (defensive)", async () => {
    _activeMock = makeSupabaseMock({
      ev2Result: { data: { id: "uuid-3" }, error: null },
      priorResult: {
        data: {
          last_endpoint_status: {
            stats: { ok: true, http: 200, size: 100, ts: "T1" },
          },
        },
        error: null,
      },
    });
    const body = {
      sofa_event_id: 3003,
      sport_slug: "calcio" as const,
      payloads: { stats: { y: 9 } },
      // no endpoint_status
    };
    const res = await callRoute(body);
    expect(res.status).toBe(200);
    const enrichmentUpsert = _activeMock!._captured.upserts.find(
      (u) => u.table === "event_enrichment"
    );
    const payload = enrichmentUpsert!.payload as Record<string, unknown>;
    const status = payload.last_endpoint_status as Record<string, EndpointStatus>;
    expect(status.stats.ts).toBe("T1");  // prior preserved
  });
});
