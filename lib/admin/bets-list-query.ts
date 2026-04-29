import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetsListFilters, BetsScope } from "@/lib/types/bets-admin";

/**
 * Build the Postgrest query for listing bets with filters and scope.
 * Returns the chain (caller invokes .range() and awaits).
 *
 * IMPORTANT: scope ALWAYS overrides any agent_id in filters.
 */
export function buildBetsListPostgrest(
  supabase: SupabaseClient,
  filters: BetsListFilters,
  scope: BetsScope
) {
  let q: any = supabase
    .from("bets")
    .select(
      `id, user_id, bet_type, stake, total_odds, potential_win, actual_win,
       status, is_live, selections_count, risk_score, created_at, settled_at,
       kiosk_id,
       user:users(id, username),
       kiosk:kiosks(code, name, agent_id, agent:agents(code, name))`,
      { count: "exact" }
    );

  // Permission scope (forced)
  if (scope !== "all") {
    // bets.kiosk_id → kiosks.agent_id == scope.agent_id
    // Postgrest filter on nested: use .eq on the joined table column
    q = q.eq("kiosk.agent_id", scope.agent_id);
  }

  // Status
  if (filters.status && filters.status !== "all") {
    q = q.eq("status", filters.status);
  }

  // Date range
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);

  // FK filters
  if (filters.kiosk_id) q = q.eq("kiosk_id", filters.kiosk_id);
  if (filters.user_id) q = q.eq("user_id", filters.user_id);

  // Stake range
  if (typeof filters.min_stake === "number") q = q.gte("stake", filters.min_stake);
  if (typeof filters.max_stake === "number") q = q.lte("stake", filters.max_stake);

  // Live
  if (typeof filters.is_live === "boolean") q = q.eq("is_live", filters.is_live);

  // Risk range
  if (typeof filters.risk_min === "number") q = q.gte("risk_score", filters.risk_min);
  if (typeof filters.risk_max === "number") q = q.lte("risk_score", filters.risk_max);

  // Search (PostgREST or filter; we use ilike on UUID prefix and username via foreign-key not directly possible —
  // do username via inner join filter and id with text-cast)
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    // id::text ilike or kiosk.code ilike. PostgREST supports `or=` with embedded fields.
    q = q.or(
      [
        `id::text.ilike.%${s}%`,
        `kiosk.code.ilike.%${s}%`,
      ].join(",")
    );
    // username search handled in route handler via post-filter (Postgrest limit)
    // recorded in BetsListFilters.search; route applies post-filter on user.username in JS
  }

  // Sort
  const sortCol = filters.sort === "stake" ? "stake"
                : filters.sort === "payout" ? "actual_win"
                : "created_at";
  const dir = filters.dir === "asc" ? { ascending: true } : { ascending: false };
  q = q.order(sortCol, dir);

  return q;
}
