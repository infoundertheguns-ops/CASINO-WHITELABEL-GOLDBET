// tests/lib/bets-permissions.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveBetsScope } from "@/lib/admin/bets-permissions";

describe("resolveBetsScope", () => {
  it("returns 'all' for super_admin user", async () => {
    const supabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "admin-row" }, error: null }),
    } as any;
    // agents query returns no row → not an agent → super_admin path
    supabase.from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(table === "admin_users"
              ? { data: { id: "admin-row" }, error: null }
              : { data: null, error: null }),
        }),
      }),
    }));
    const scope = await resolveBetsScope(supabase, "user-uuid");
    expect(scope).toBe("all");
  });

  it("returns { agent_id } when user is an agent", async () => {
    const supabase = {} as any;
    supabase.from = vi.fn().mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(table === "agents"
              ? { data: { id: "agent-uuid", user_id: "user-uuid" }, error: null }
              : { data: null, error: null }),
        }),
      }),
    }));
    const scope = await resolveBetsScope(supabase, "user-uuid");
    expect(scope).toEqual({ agent_id: "agent-uuid" });
  });

  it("throws when user is neither admin nor agent", async () => {
    const supabase = {} as any;
    supabase.from = vi.fn().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }));
    await expect(resolveBetsScope(supabase, "user-uuid")).rejects.toThrow(/not authorized/i);
  });
});
