// app/api/admin/canonicalization/inspect/route.ts
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));

  if (q.length < 2) {
    return NextResponse.json({ groups: [] });
  }

  const sb = createAdminClient();
  const { data, error } = await sb.rpc('inspect_event', {
    p_query: q,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ groups: data ?? [] });
}
