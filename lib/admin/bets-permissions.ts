// lib/admin/bets-permissions.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetsScope } from "@/lib/types/bets-admin";

/**
 * Resolve which bets a given auth user can see.
 *
 * - If user_id is an agent → returns { agent_id }
 * - If user_id is an admin_users entry (super_admin or any role) → returns "all"
 * - Otherwise → throws (not authorized)
 *
 * Agent check is done first so that a user who is BOTH an agent and an admin
 * is treated as an agent (more restrictive).
 */
export async function resolveBetsScope(
  supabase: SupabaseClient,
  userId: string
): Promise<BetsScope> {
  // Check agents first
  const { data: agentRow } = await supabase
    .from("agents")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (agentRow?.id) {
    return { agent_id: agentRow.id };
  }

  // Check admin_users
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminRow?.id) {
    return "all";
  }

  throw new Error("User not authorized: not an admin or agent");
}
