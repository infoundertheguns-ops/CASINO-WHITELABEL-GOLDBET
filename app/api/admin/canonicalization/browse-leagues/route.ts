// app/api/admin/canonicalization/browse-leagues/route.ts
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { unstable_cache } from 'next/cache';

// Per-sport league lists are cached individually (60s) keyed on sport_id so
// reopening a sport in the accordion uses the cached payload.
const getLeagues = unstable_cache(
  async (sportId: string) => {
    const sb = createAdminClient();
    const { data, error } = await sb.rpc('canonicalization_browse_leagues', {
      p_sport_id: sportId,
    });
    if (error) throw new Error(error.message);
    return data;
  },
  ['canonicalization-browse-leagues'],
  { revalidate: 60 }
);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sportId = url.searchParams.get('sport_id')?.trim();
  if (!sportId) {
    return NextResponse.json({ error: 'sport_id required' }, { status: 400 });
  }
  // Basic UUID shape check — RPC will fail with a 500 on bad input otherwise.
  if (!/^[0-9a-f-]{32,36}$/i.test(sportId)) {
    return NextResponse.json({ error: 'sport_id must be a uuid' }, { status: 400 });
  }
  try {
    const data = await getLeagues(sportId);
    return NextResponse.json({ leagues: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
