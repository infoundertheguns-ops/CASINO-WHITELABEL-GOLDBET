// app/api/admin/event-normalization/_lib.ts
// Shared helpers for the event-normalization route group.
// Kept outside route.ts because Next.js restricts the set of exports allowed
// in route modules (only GET/POST/PATCH/etc. and config).

export interface ListQuery {
  sport: string | null;
  stage: string | null;
  verified: 'true' | 'false' | null;
  flashscore_id: string | null;
  // Mig 119 / UI Sprint 2.x — sub-filter for the "LLM da rivedere" tab:
  //   'verify_false' → llm rows where llm_verify=false (LLM flagged ambiguity)
  //   'low_conf'     → llm rows where confidence<0.95 (below auto-apply gate)
  //   'all'          → both groups (default when llm_filter is omitted)
  // Mig 119 / UI Sprint 2.x — sub-filter for the "Verificati" tab:
  //   'auto'   → verified_by IS NULL  (engine + retroactive cron)
  //   'manual' → verified_by IS NOT NULL  (operator clicked)
  //   'all'    → both (default)
  llm_filter: 'verify_false' | 'low_conf' | 'all' | null;
  verified_by_filter: 'auto' | 'manual' | 'all' | null;
  limit: number;
  offset: number;
}

export function parseListQuery(url: URL): ListQuery {
  const llmFilterRaw = url.searchParams.get('llm_filter');
  const vbRaw = url.searchParams.get('verified_by_filter');
  return {
    sport: url.searchParams.get('sport'),
    stage: url.searchParams.get('stage'),
    verified: url.searchParams.get('verified') as 'true' | 'false' | null,
    // E6: drill-through from Fixtures — filter rows mapped to a specific Flashscore be_match_id.
    flashscore_id: url.searchParams.get('flashscore_id'),
    llm_filter: (llmFilterRaw === 'verify_false' || llmFilterRaw === 'low_conf' || llmFilterRaw === 'all')
      ? llmFilterRaw : null,
    verified_by_filter: (vbRaw === 'auto' || vbRaw === 'manual' || vbRaw === 'all')
      ? vbRaw : null,
    limit: Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10))),
    offset: Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10)),
  };
}

export async function listRows(supabase: any, q: ListQuery) {
  let query = supabase.from('event_normalization')
    .select(
      'id, event_id, flashscore_id, match_stage, confidence, llm_reason, llm_verify, verified, verified_at, verified_by, created_at, ' +
      'events!inner(id, home_team, away_team, starts_at, source, sport_id, flashscore_id, sports!inner(name))'
    )
    .order('created_at', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);

  if (q.stage) query = query.eq('match_stage', q.stage);
  if (q.verified === 'true') query = query.eq('verified', true);
  if (q.verified === 'false') query = query.eq('verified', false);
  if (q.sport) query = query.eq('events.sports.name', q.sport);
  if (q.flashscore_id) query = query.eq('flashscore_id', q.flashscore_id);

  // LLM sub-filter (only meaningful when stage='llm' is also set)
  if (q.stage === 'llm' && q.llm_filter === 'verify_false') {
    query = query.or('llm_verify.eq.false,llm_verify.is.null').lt('confidence', 1.01);
    // verify_false bucket: explicit false OR legacy NULL (treat as needs-review).
    // Confidence cap is just a no-op to keep the chain typed.
  } else if (q.stage === 'llm' && q.llm_filter === 'low_conf') {
    query = query.lt('confidence', 0.95);
  }

  // Verified-by sub-filter
  if (q.verified === 'true' && q.verified_by_filter === 'auto') {
    query = query.is('verified_by', null);
  } else if (q.verified === 'true' && q.verified_by_filter === 'manual') {
    query = query.not('verified_by', 'is', null);
  }

  return query;
}

export async function listLowConfidence(supabase: any, q: ListQuery) {
  // Review #4 P1-B: server-side filter via mig 115 RPC. Replaces the broken
  // client-side filter that only saw the first 200 paginated rows.
  const { data, error } = await supabase.rpc('event_normalization_low_confidence', {
    p_max_confidence: 0.85,
    p_sport: q.sport,
    p_exclude_stage: 'llm',
    p_limit: q.limit,
    p_offset: q.offset,
  });
  return { data, error };
}

export async function listUnmappedEvents(supabase: any, q: ListQuery) {
  // Server-side anti-join via RPC `next_unmapped_events` (mig 087d).
  // Avoids the PostgREST "NOT IN (<thousands of uuids>)" URL-too-long problem
  // the previous client-side version suffered from.
  const { data, error } = await supabase.rpc('next_unmapped_events', {
    p_limit: q.limit,
    p_sport: q.sport,
  });
  if (error) return { data: null, error };

  // Reshape RPC output to match legacy `events!inner(sports)` shape the page expects.
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    home_team: r.home_team,
    away_team: r.away_team,
    starts_at: r.starts_at,
    source: r.source,
    flashscore_id: r.flashscore_id,
    sports: { name: r.sport_name },
  }));

  return { data: rows, error: null };
}

// Stats now backed by mig 119 RPC `event_norm_verified_breakdown` — single
// query that returns total / auto_verified / human_verified / unverified /
// avg_confidence per match_stage. Eliminates the previous ~21 sequential
// COUNT queries (was ~3-5s on the prod dataset).
//
// Backward-compatible shape: `byStage[stage] = { count, avg_conf, verified }`
// so the UI keeps working; we add `auto_verified` and `human_verified`
// alongside for the new KPI split.
export async function getStats(supabase: any) {
  const byStage: Record<string, {
    count: number;
    avg_conf: number;
    verified: number;
    auto_verified: number;
    human_verified: number;
  }> = {};
  let totalRows = 0;
  let totalAuto = 0;
  let totalHuman = 0;

  const { data, error } = await supabase.rpc('event_norm_verified_breakdown');
  if (!error && Array.isArray(data)) {
    for (const r of data as any[]) {
      const verified = Number(r.auto_verified ?? 0) + Number(r.human_verified ?? 0);
      byStage[r.match_stage] = {
        count: Number(r.total_mapped ?? 0),
        avg_conf: Number(r.avg_confidence ?? 0),
        verified,
        auto_verified: Number(r.auto_verified ?? 0),
        human_verified: Number(r.human_verified ?? 0),
      };
      totalRows += Number(r.total_mapped ?? 0);
      totalAuto += Number(r.auto_verified ?? 0);
      totalHuman += Number(r.human_verified ?? 0);
    }
  }

  // Mig 119 follow-up: the breakdown RPC filters out match_stage='unmapped'
  // (those rows have flashscore_id NULL by design — they're negative-cache
  // sentinels marking events the pipeline tried and failed). Without a
  // separate count the "Unmapped (sentinel)" KPI on the page would show 0
  // and mislead the operator. Add a single COUNT(*) query so the legacy
  // KPI keeps working without bloating the breakdown RPC's main query.
  const { count: unmappedCount } = await supabase
    .from('event_normalization')
    .select('id', { count: 'exact', head: true })
    .eq('match_stage', 'unmapped');
  if (unmappedCount && unmappedCount > 0) {
    byStage.unmapped = {
      count: unmappedCount,
      avg_conf: 0,
      verified: 0,
      auto_verified: 0,
      human_verified: 0,
    };
    // NOTE: total_mapped intentionally NOT incremented — kpiAggregate.mappedReal
    // already filters out 'unmapped' to keep the % meaningful.
  }

  // Coverage per sport is optional — RPC may not exist in all envs.
  let bySport: any[] = [];
  try {
    const { data: cov } = await supabase.rpc('event_normalization_coverage');
    bySport = cov ?? [];
  } catch {
    /* silently degrade */
  }

  return {
    total_mapped: totalRows,
    auto_verified: totalAuto,
    human_verified: totalHuman,
    by_stage: byStage,
    by_sport: bySport,
  };
}

/**
 * Wrapper for the retroactive auto-verify RPC (mig 119.3). Used both by the
 * UI button and the recurring cron. p_dry_run=true returns counts without
 * applying the UPDATE — used by the UI preview before confirmation.
 */
export async function retroactiveAutoVerify(
  supabase: any,
  threshold: number,
  dryRun: boolean,
): Promise<{ total_affected: number; by_stage: Record<string, number> } | { error: string }> {
  const { data, error } = await supabase.rpc('retroactive_auto_verify_event_norm', {
    p_threshold: threshold,
    p_dry_run: dryRun,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total_affected: Number(row?.total_affected ?? 0),
    by_stage: (row?.by_stage ?? {}) as Record<string, number>,
  };
}
