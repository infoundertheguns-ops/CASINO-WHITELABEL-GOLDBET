// app/api/admin/canonicalization/browse-sports/route.ts
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { unstable_cache } from 'next/cache';

const getSports = unstable_cache(
  async () => {
    const sb = createAdminClient();
    const { data, error } = await sb.rpc('canonicalization_browse_sports');
    if (error) throw new Error(error.message);
    return data;
  },
  ['canonicalization-browse-sports'],
  { revalidate: 60 } // 60s cache — sport counts shift slowly
);

export async function GET() {
  try {
    const data = await getSports();
    return NextResponse.json({ sports: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
