export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// /api/admin/team-aliases — CRUD + bulk approve for the team_aliases table.
// Backs the "Team aliases" tab on /admin/event-normalization.
//
// Mig 121 added proposed_for_event_id + llm_reason so the UI can surface the
// LLM rationale when triaging proposals. Source filter:
//   * source='llm' AND verified=false  → LLM proposals queue
//   * verified=true                     → operator-confirmed dictionary

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const verified = url.searchParams.get('verified'); // 'true' | 'false' | null
  const sport = url.searchParams.get('sport');
  const source = url.searchParams.get('source'); // 'llm' | 'operator' | null
  const search = url.searchParams.get('q');
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const sb = createAdminClient();
  let q = sb.from('team_aliases')
    .select('id, alias, canonical, sport, source, verified, created_at, llm_reason, proposed_for_event_id')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (verified === 'true') q = q.eq('verified', true);
  if (verified === 'false') q = q.eq('verified', false);
  if (sport) q = q.eq('sport', sport);
  if (source) q = q.eq('source', source);
  if (search) q = q.or(`alias.ilike.%${search}%,canonical.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pending count for the badge
  const { data: pendingData } = await sb.rpc('team_aliases_pending_count');
  const pending = typeof pendingData === 'number' ? pendingData : 0;

  return NextResponse.json({ rows: data ?? [], pending });
}

export async function POST(req: NextRequest) {
  const sb = createAdminClient();
  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case 'create': {
      // Operator-created alias: verified=true immediately, source='operator'.
      const alias = String(body.alias ?? '').trim().toLowerCase();
      const canonical = String(body.canonical ?? '').trim().toLowerCase();
      const sport = body.sport ? String(body.sport).trim().toLowerCase() : null;
      if (!alias || !canonical || alias === canonical) {
        return NextResponse.json({ error: 'alias and canonical required and must differ' }, { status: 400 });
      }
      const { data, error } = await sb.from('team_aliases').insert({
        alias, canonical, sport,
        source: 'operator',
        verified: true,
      }).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, row: data });
    }

    case 'verify': {
      // Approve a pending LLM proposal (or any unverified row).
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { error } = await sb.from('team_aliases')
        .update({ verified: true })
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case 'reject': {
      // Delete a pending proposal (operator says it's wrong).
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { error } = await sb.from('team_aliases')
        .delete()
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case 'edit': {
      // Operator edits canonical/alias before verifying. Only mutates the row;
      // doesn't auto-verify (operator clicks verify separately).
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const patch: any = {};
      if (typeof body.alias === 'string') patch.alias = body.alias.trim().toLowerCase();
      if (typeof body.canonical === 'string') patch.canonical = body.canonical.trim().toLowerCase();
      if (body.sport !== undefined) patch.sport = body.sport ? String(body.sport).trim().toLowerCase() : null;
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no patch fields' }, { status: 400 });
      const { error } = await sb.from('team_aliases').update(patch).eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case 'bulk-verify': {
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return NextResponse.json({ error: 'ids array required' }, { status: 400 });
      }
      const { error } = await sb.from('team_aliases')
        .update({ verified: true })
        .in('id', body.ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, verified: body.ids.length });
    }

    case 'bulk-reject': {
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return NextResponse.json({ error: 'ids array required' }, { status: 400 });
      }
      const { error } = await sb.from('team_aliases').delete().in('id', body.ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, rejected: body.ids.length });
    }

    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}
