import { describe, it, expect } from "vitest";
import { getDefaultLine, isSentinelLine } from "@/lib/line-picker-defaults";

describe("line-picker-defaults", () => {
  it("returns 2.5 for calcio U/O", () => {
    expect(getDefaultLine("calcio", "U/O")).toBe(2.5);
  });

  it("returns 0.5 for calcio U/O - 1T", () => {
    expect(getDefaultLine("calcio", "U/O - 1T")).toBe(0.5);
  });

  it("returns null for unknown sport", () => {
    expect(getDefaultLine("unknownsport", "U/O")).toBeNull();
  });

  it("returns null for unknown market", () => {
    expect(getDefaultLine("calcio", "unknown_market")).toBeNull();
  });

  it("identifies AH as sentinel (use nearest-to-zero)", () => {
    expect(isSentinelLine("calcio", "AH")).toBe(true);
    expect(isSentinelLine("calcio", "AH - 1T")).toBe(true);
    expect(isSentinelLine("calcio", "Hcap Corners")).toBe(true);
  });

  it("identifies U/O as static (not sentinel)", () => {
    expect(isSentinelLine("calcio", "U/O")).toBe(false);
  });
});
