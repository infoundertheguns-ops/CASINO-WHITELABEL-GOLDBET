import { describe, it, expect } from "vitest";
import { mapClaimRpcResult } from "@/app/api/tickets/_claim";

describe("mapClaimRpcResult", () => {
  it("success → 200 payload", () => {
    const r = mapClaimRpcResult([{ ticket_id: "t1", amount_paid: 150.4, already_claimed: false, not_payable: false }]);
    expect(r).toEqual({ status: 200, body: { success: true, amount_paid: 150.4, ticket_id: "t1" } });
  });
  it("already_claimed → 409", () => {
    const r = mapClaimRpcResult([{ ticket_id: null, amount_paid: null, already_claimed: true, not_payable: false }]);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/già incassato/i);
  });
  it("not_payable → 400", () => {
    const r = mapClaimRpcResult([{ ticket_id: null, amount_paid: null, already_claimed: false, not_payable: true }]);
    expect(r.status).toBe(400);
  });
  it("not_found (all false, nessun ticket_id) → 404", () => {
    const r = mapClaimRpcResult([{ ticket_id: null, amount_paid: null, already_claimed: false, not_payable: false }]);
    expect(r.status).toBe(404);
  });
  it("rpc returned empty array → 500", () => {
    const r = mapClaimRpcResult([]);
    expect(r.status).toBe(500);
  });
});
