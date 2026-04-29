import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResolvedLimit {
  max_stake: number | null;
  max_win: number | null;
  max_daily_turnover: number | null;
  source: string;
}

/**
 * Resolve the most specific active betting limit for a player.
 * Priority (highest → lowest):
 *   1. player + sport
 *   2. player only
 *   3. agent + sport
 *   4. agent only
 *   5. global (no player_id, no agent_id, no sport)
 */
export async function resolveLimit(
  supabase: SupabaseClient,
  playerId: string,
  agentId: string | null,
  sport: string | null
): Promise<ResolvedLimit | null> {
  // Build OR filter to fetch all potentially matching limits in one query
  const orParts: string[] = [];

  // player+sport
  if (sport) orParts.push(`and(player_id.eq.${playerId},sport.eq.${sport})`);
  // player only
  orParts.push(`and(player_id.eq.${playerId},sport.is.null)`);
  // agent+sport
  if (agentId && sport) orParts.push(`and(agent_id.eq.${agentId},player_id.is.null,sport.eq.${sport})`);
  // agent only
  if (agentId) orParts.push(`and(agent_id.eq.${agentId},player_id.is.null,sport.is.null)`);
  // global
  orParts.push(`and(player_id.is.null,agent_id.is.null,sport.is.null)`);

  const { data: limits } = await supabase
    .from("betting_limits")
    .select("agent_id, player_id, sport, max_stake, max_win, max_daily_turnover")
    .eq("is_active", true)
    .or(orParts.join(","));

  if (!limits || limits.length === 0) return null;

  // Score each limit by specificity
  function score(l: any): number {
    let s = 0;
    if (l.player_id) s += 4;
    if (l.agent_id && !l.player_id) s += 2;
    if (l.sport) s += 1;
    return s;
  }

  const best = limits.reduce((acc: any, cur: any) =>
    score(cur) > score(acc) ? cur : acc
  );

  // Determine human-readable source label
  let source = "global";
  if (best.player_id && best.sport) source = "player+sport";
  else if (best.player_id) source = "player";
  else if (best.agent_id && best.sport) source = "agent+sport";
  else if (best.agent_id) source = "agent";

  return {
    max_stake: best.max_stake ?? null,
    max_win: best.max_win ?? null,
    max_daily_turnover: best.max_daily_turnover ?? null,
    source,
  };
}

/**
 * Check if a player is currently on the blacklist.
 */
export async function isBlacklisted(
  supabase: SupabaseClient,
  playerId: string
): Promise<{ blocked: boolean; reason?: string }> {
  const { data } = await supabase
    .from("player_blacklist")
    .select("reason")
    .eq("player_id", playerId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!data) return { blocked: false };
  return { blocked: true, reason: data.reason };
}
