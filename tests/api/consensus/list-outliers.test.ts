// tests/api/consensus/list-outliers.test.ts
import { describe, it, expect } from "vitest";
import { listOutliers } from "@/app/api/admin/consensus/_lib";

function fakeSupabase() {
  const calls: string[] = [];

  // Build a chainable object that records every method call.
  // It must be a thenable so `await q` resolves to { data: [], error: null }.
  // We use a plain object (not Proxy) so that the `then` property is not
  // accidentally shadowed by the Proxy trap.
  const resolution = { data: [] as any[], error: null };

  function makeChain(): any {
    const obj: any = {
      then(resolve: (v: any) => void, _reject?: (e: any) => void) {
        // Resolve synchronously via a microtask to avoid timeout.
        Promise.resolve(resolution).then(resolve);
      },
    };
    const methods = ["select", "eq", "gte", "lte", "order", "limit", "range", "single"];
    for (const m of methods) {
      obj[m] = (...args: any[]) => {
        calls.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return obj; // return same chain
      };
    }
    return obj;
  }

  const chain = makeChain();

  return {
    _calls: calls,
    from(table: string) {
      calls.push(`from(${JSON.stringify(table)})`);
      return chain;
    },
  } as any;
}

describe("listOutliers", () => {
  it("reads from v_consensus_latest (not consensus_snapshots)", async () => {
    const sb = fakeSupabase();
    const sp = new URLSearchParams({ min_delta: "15", limit: "50" });
    await listOutliers(sb, sp);
    const fromCalls = sb._calls.filter((c: string) => c.startsWith("from("));
    expect(fromCalls).toContain('from("v_consensus_latest")');
    expect(fromCalls).not.toContain('from("consensus_snapshots")');
  });
});
