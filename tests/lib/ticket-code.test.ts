import { describe, it, expect } from "vitest";
import { normalizeTicketCode, isValidTicketCode } from "@/app/admin/agent-tickets/lib/ticket-code";

describe("normalizeTicketCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeTicketCode("  tk-abc123  ")).toBe("TK-ABC123");
  });
  it("removes internal spaces (scanner artefatti)", () => {
    expect(normalizeTicketCode("tk - a b c 1 2 3")).toBe("TK-ABC123");
  });
});

describe("isValidTicketCode", () => {
  it("accepts TK- + 6 alfanumerici upper (whitelist generator)", () => {
    expect(isValidTicketCode("TK-ABCDEF")).toBe(true);
    expect(isValidTicketCode("TK-A8F3E2")).toBe(true);
    expect(isValidTicketCode("TK-23456J")).toBe(true);
  });
  it("rejects lowercase, wrong length, missing prefix", () => {
    expect(isValidTicketCode("tk-abc123")).toBe(false);
    expect(isValidTicketCode("TK-ABC12")).toBe(false);
    expect(isValidTicketCode("ABC-123456")).toBe(false);
    expect(isValidTicketCode("")).toBe(false);
  });
  it("rejects confusing chars 0/O/1/I (matching generator whitelist)", () => {
    expect(isValidTicketCode("TK-0O1IAB")).toBe(false);
  });
});
