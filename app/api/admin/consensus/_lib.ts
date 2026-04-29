// Private helpers for app/api/admin/consensus/route.ts
// The `_` prefix marks this as a private module (Next.js does not treat it as a route).

export async function getKpis(supabase: any) {
  const [total, unreviewed, topDelta, lastRefresh] = await Promise.all([
    supabase.from("consensus_snapshots").select("id", { count: "exact", head: true }),
    supabase.from("consensus_snapshots").select("id", { count: "exact", head: true }).eq("reviewed", false),
    supabase.from("consensus_snapshots").select("abs_delta_pct").order("abs_delta_pct", { ascending: false }).limit(1).single(),
    supabase.from("system_config").select("value").eq("key", "last_consensus_refresh").single(),
  ]);
  let lastRun: any = null;
  try { lastRun = lastRefresh?.data?.value ? JSON.parse(lastRefresh.data.value) : null; } catch {}
  return {
    total: total.count ?? 0,
    unreviewed: unreviewed.count ?? 0,
    max_delta: topDelta.data?.abs_delta_pct ?? null,
    last_refresh: lastRun,
  };
}

export async function getSports(supabase: any) {
  const { data, error } = await supabase.rpc("get_consensus_sports_counts");
  if (error && !String(error.message).includes("function")) throw error;
  if (data && Array.isArray(data) && data.length) {
    return data;
  }
  // Fallback raw aggregate if RPC not present
  const { data: rows } = await supabase
    .from("consensus_snapshots")
    .select("sport")
    .limit(10000);
  const map = new Map<string, number>();
  for (const r of (rows ?? [])) {
    map.set(r.sport, (map.get(r.sport) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([sport, count]) => ({ sport, count })).sort((a, b) => b.count - a.count);
}

export async function listOutliers(supabase: any, sp: URLSearchParams) {
  const sport = sp.get("sport");
  const marketType = sp.get("market_type");
  const minDelta = Number(sp.get("min_delta") ?? 15);
  const onlyUnreviewed = sp.get("only_unreviewed") === "1";
  const limit = Math.min(500, Math.max(10, Number(sp.get("limit") ?? 100)));

  // Bypass v_consensus_latest view — DISTINCT ON over ~1.8M rows times out.
  // Query consensus_snapshots directly with overfetch, then dedup by
  // (kambi_event_id, market_type, outcome_name) keeping the freshest snapshot.
  const OVERFETCH = Math.min(2000, limit * 8);

  let q = supabase
    .from("consensus_snapshots")
    .select(`
      id, sport, home_team, away_team, event_starts_at,
      market_type, outcome_name,
      kambi_odds, twobet_odds, betfair_odds,
      delta_pct, abs_delta_pct,
      snapshot_at, reviewed, notes,
      kambi_event_id, twobet_event_id, betfair_event_id
    `)
    .gte("abs_delta_pct", minDelta)
    .gte("event_starts_at", new Date(Date.now() - 2 * 3600_000).toISOString())
    .order("abs_delta_pct", { ascending: false })
    .limit(OVERFETCH);

  if (sport) q = q.eq("sport", sport);
  if (marketType) q = q.eq("market_type", marketType);
  if (onlyUnreviewed) q = q.eq("reviewed", false);

  const { data, error } = await q;
  if (error) throw error;

  // Server-side dedup: latest snapshot per (kambi_event_id, market_type, outcome_name)
  const byKey = new Map<string, any>();
  for (const r of (data ?? [])) {
    const k = `${r.kambi_event_id}|${r.market_type}|${r.outcome_name}`;
    const existing = byKey.get(k);
    if (!existing || new Date(r.snapshot_at).getTime() > new Date(existing.snapshot_at).getTime()) {
      byKey.set(k, r);
    }
  }
  const deduped = Array.from(byKey.values())
    .sort((a, b) => Number(b.abs_delta_pct) - Number(a.abs_delta_pct))
    .slice(0, limit);

  return { rows: deduped };
}
