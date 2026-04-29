// app/api/admin/canonicalization/overview/route.ts
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { unstable_cache } from 'next/cache';

const getOverview = unstable_cache(
  async () => {
    const sb = createAdminClient();
    const { data, error } = await sb.rpc('canonicalization_overview');
    if (error) throw new Error(error.message);
    return data;
  },
  ['canonicalization-overview'],
  { revalidate: 60 } // 60s cache
);

export async function GET() {
  try {
    const data = await getOverview();
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
