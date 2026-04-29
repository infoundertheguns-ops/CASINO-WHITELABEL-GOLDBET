// app/api/admin/canonicalization/browse-groups/route.ts
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';

// Cached fetch — 30s TTL keyed on (sport_id, league_id, search, limit). The
// expensive RPC under the hood (canonicalization_browse_groups, mig 124) does
// per-event O(n²) trigram clustering for NULL-flashscore events; cached call
// makes the second click on the same league instant.
//
// Pattern matches app/api/admin/canonicalization/overview/route.ts (60s).
const fetchGroups = unstable_cache(
  async (sportId: string, leagueId: string | null, search: string | null, limit: number) => {
    const sb = createAdminClient();
    const { data, error } = await sb.rpc('canonicalization_browse_groups', {
      p_sport_id: sportId,
      p_league_id: leagueId,
      p_search: search,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    return (data as unknown[] | null) ?? [];
  },
  ['canonicalization-browse-groups'],
  { revalidate: 30 }
);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sportId = url.searchParams.get('sport_id')?.trim();
  const leagueId = url.searchParams.get('league_id')?.trim() ?? null;
  const q = url.searchParams.get('q')?.trim() ?? null;
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));

  if (!sportId) {
    return NextResponse.json({ error: 'sport_id required' }, { status: 400 });
  }
  if (!/^[0-9a-f-]{32,36}$/i.test(sportId)) {
    return NextResponse.json({ error: 'sport_id must be a uuid' }, { status: 400 });
  }
  if (leagueId && !/^[0-9a-f-]{32,36}$/i.test(leagueId)) {
    return NextResponse.json({ error: 'league_id must be a uuid' }, { status: 400 });
  }

  const search = q && q.length >= 2 ? q : null;
  try {
    const groups = await fetchGroups(sportId, leagueId, search, limit);
    return NextResponse.json({
      groups,
      truncated: groups.length >= limit,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
