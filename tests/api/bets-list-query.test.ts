// tests/api/bets-list-query.test.ts
import { describe, it, expect } from "vitest";
import { buildBetsListPostgrest } from "@/lib/admin/bets-list-query";

describe("buildBetsListPostgrest", () => {
  function fakeSupabase() {
    const calls: string[] = [];
    const chain: any = new Proxy({}, {
      get: (_t, prop) => (...args: any[]) => {
        calls.push(`${String(prop)}(${args.map(a => JSON.stringify(a)).join(",")})`);
        return chain;
      },
    });
    chain._calls = calls;
    return { from: (t: string) => { calls.push(`from(${JSON.stringify(t)})`); return chain; }, _calls: calls };
  }

  it("applies status filter when not 'all'", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { status: "won" }, "all");
    expect(sb._calls.some(c => c.includes('eq("status","won")'))).toBe(true);
  });

  it("does NOT apply status filter when 'all'", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { status: "all" }, "all");
    expect(sb._calls.some(c => c.includes('eq("status"'))).toBe(false);
  });

  it("forces agent scope when scope is { agent_id }", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { agent_id: "should-be-overridden" }, { agent_id: "real-agent-id" });
    expect(sb._calls.some(c => c.includes('"real-agent-id"'))).toBe(true);
    expect(sb._calls.some(c => c.includes('"should-be-overridden"'))).toBe(false);
  });

  it("applies stake range when provided", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, { min_stake: 10, max_stake: 100 }, "all");
    expect(sb._calls.some(c => c.includes('gte("stake",10)'))).toBe(true);
    expect(sb._calls.some(c => c.includes('lte("stake",100)'))).toBe(true);
  });

  it("orders by created_at desc by default", () => {
    const sb = fakeSupabase();
    buildBetsListPostgrest(sb as any, {}, "all");
    expect(sb._calls.some(c => c.includes('order("created_at"'))).toBe(true);
  });
});
