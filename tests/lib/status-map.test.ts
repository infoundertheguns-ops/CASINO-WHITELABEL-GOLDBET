import { describe, it, expect } from "vitest";
import { getStatusVisual, isPayable } from "@/app/admin/agent-tickets/lib/status-map";

describe("getStatusVisual", () => {
  it("returns won styling", () => {
    const v = getStatusVisual("won");
    expect(v.label).toMatch(/vinta/i);
    expect(v.tone).toBe("success");
  });
  it("handles unknown status gracefully", () => {
    const v = getStatusVisual("something_weird");
    expect(v.tone).toBe("neutral");
  });
});

describe("isPayable", () => {
  it("true for won and void", () => {
    expect(isPayable("won")).toBe(true);
    expect(isPayable("void")).toBe(true);
  });
  it("false for open/lost/claimed/expired", () => {
    expect(isPayable("open")).toBe(false);
    expect(isPayable("lost")).toBe(false);
    expect(isPayable("claimed")).toBe(false);
    expect(isPayable("expired")).toBe(false);
  });
});
