export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { parseListQuery, listRows, listUnmappedEvents, listLowConfidence, getStats, retroactiveAutoVerify } from './_lib';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'list';
  const sb = createAdminClient();

  if (action === 'stats') {
    const s = await getStats(sb);
    return NextResponse.json(s);
  }
  if (action === 'unmapped') {
    const { data, error } = await listUnmappedEvents(sb, parseListQuery(url));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
  }
  if (action === 'low_confidence') {
    // Review #4 P1-B: server-side filter via mig 115 RPC.
    const { data, error } = await listLowConfidence(sb, parseListQuery(url));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [] });
  }
  if (action === 'coverage') {
    // Review #4 P2-E + Sprint 1: overall + per-source coverage % via mig 117 RPC.
    // Default counts active events only (prematch+live) and excludes legacy synthetics
    // placeholder synthetics. ?include_ended=true brings back historical view.
    const windowDays = Math.min(90, Math.max(1, Number(url.searchParams.get('window_days') ?? 7)));
    const includeEnded = url.searchParams.get('include_ended') === 'true';
    const { data, error } = await sb.rpc('event_normalization_coverage_pct', {
      p_window_days: windowDays,
      p_include_ended: includeEnded,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [], window_days: windowDays, include_ended: includeEnded });
  }

  const { data, error } = await listRows(sb, parseListQuery(url));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sb = createAdminClient();

  switch (body.action) {
    case 'verify': {
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { error } = await sb.from('event_normalization')
        .update({ verified: true, verified_at: new Date().toISOString() })
        .eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Propagate events.flashscore_id in case the row was partial-persist only.
      const { data: row } = await sb.from('event_normalization')
        .select('event_id, flashscore_id').eq('id', body.id).single();
      if (row?.event_id && row.flashscore_id) {
        await sb.from('events').update({ flashscore_id: row.flashscore_id }).eq('id', row.event_id);
      }
      return NextResponse.json({ success: true });
    }

    case 'manual-assign': {
      if (!body.event_id || !body.flashscore_id) {
        return NextResponse.json({ error: 'event_id + flashscore_id required' }, { status: 400 });
      }
      const { error } = await sb.from('event_normalization').upsert({
        event_id: body.event_id,
        flashscore_id: body.flashscore_id,
        match_stage: 'manual',
        confidence: 1.0,
        verified: true,
        verified_at: new Date().toISOString(),
        llm_reason: body.reason ?? null,
      }, { onConflict: 'event_id' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await sb.from('events').update({ flashscore_id: body.flashscore_id }).eq('id', body.event_id);
      return NextResponse.json({ success: true });
    }

    case 'reject': {
      // Review #4 P1-A: clear events.flashscore_id when the rejected row had
      // already been verified — verify/manual-assign propagate the FS-id to
      // events; without this clear-on-reject, rejection leaves a stale FS-id.
      const where = body.id ? { id: body.id } : body.event_id ? { event_id: body.event_id } : null;
      if (!where) return NextResponse.json({ error: 'id or event_id required' }, { status: 400 });

      const { data: existing } = await sb
        .from('event_normalization')
        .select('event_id, flashscore_id, verified')
        .match(where)
        .maybeSingle();

      const { error } = await sb.from('event_normalization').delete().match(where);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      if (existing?.event_id && existing.flashscore_id && existing.verified) {
        // Only null events.flashscore_id if it still matches the rejected one.
        // Avoids clobbering a different mapping that was set after the rejected one.
        await sb
          .from('events')
          .update({ flashscore_id: null })
          .eq('id', existing.event_id)
          .eq('flashscore_id', existing.flashscore_id);
      }
      return NextResponse.json({ success: true });
    }

    case 'bulk-verify': {
      // Review #4 P2-H: bulk approve N selected mappings (autopilot review queue).
      const ids = Array.isArray(body.ids) ? body.ids.filter((x: any) => Number.isFinite(Number(x))).map(Number) : [];
      if (ids.length === 0) return NextResponse.json({ error: 'ids array required' }, { status: 400 });
      const nowIso = new Date().toISOString();
      const { error } = await sb.from('event_normalization')
        .update({ verified: true, verified_at: nowIso })
        .in('id', ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Propagate events.flashscore_id for the newly verified rows.
      const { data: rows } = await sb
        .from('event_normalization')
        .select('event_id, flashscore_id')
        .in('id', ids);
      let propagated = 0;
      for (const r of rows ?? []) {
        if (r.event_id && r.flashscore_id) {
          const { error: e } = await sb.from('events').update({ flashscore_id: r.flashscore_id }).eq('id', r.event_id);
          if (!e) propagated++;
        }
      }
      return NextResponse.json({ success: true, verified: ids.length, propagated });
    }

    case 'bulk-reject': {
      // Bulk delete + null events.flashscore_id for the rows that were verified.
      const ids = Array.isArray(body.ids) ? body.ids.filter((x: any) => Number.isFinite(Number(x))).map(Number) : [];
      if (ids.length === 0) return NextResponse.json({ error: 'ids array required' }, { status: 400 });

      const { data: existing } = await sb
        .from('event_normalization')
        .select('id, event_id, flashscore_id, verified')
        .in('id', ids);

      const { error } = await sb.from('event_normalization').delete().in('id', ids);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      let cleared = 0;
      for (const r of existing ?? []) {
        if (r.event_id && r.flashscore_id && r.verified) {
          const { error: e } = await sb
            .from('events')
            .update({ flashscore_id: null })
            .eq('id', r.event_id)
            .eq('flashscore_id', r.flashscore_id);
          if (!e) cleared++;
        }
      }
      return NextResponse.json({ success: true, rejected: ids.length, cleared_events: cleared });
    }

    case 'llm-submit': {
      // Batch-submit LLM results (from subagent operator). Each entry:
      //   { event_id, flashscore_id, confidence, verify, reason }
      // verify is the LLM's self-verify flag (mig 119) — paired with
      // confidence>=0.95 as a dual gate before auto-verification. Older
      // subagent payloads without `verify` default to false (safe).
      if (!Array.isArray(body.results)) {
        return NextResponse.json({ error: 'results array required' }, { status: 400 });
      }
      let upserted = 0;
      let skipped = 0;
      for (const r of body.results) {
        if (!r.event_id || !r.flashscore_id) { skipped++; continue; }
        const conf = Math.max(0, Math.min(1, Number(r.confidence ?? 0)));
        const llmVerify = r.verify === true;
        const shouldVerify = conf >= 0.95 && llmVerify;
        const { error } = await sb.from('event_normalization').upsert({
          event_id: r.event_id,
          flashscore_id: r.flashscore_id,
          match_stage: 'llm',
          confidence: conf,
          llm_reason: r.reason ?? null,
          llm_verify: llmVerify,
          verified: shouldVerify,
          verified_at: shouldVerify ? new Date().toISOString() : null,
          verified_by: null, // system / LLM, never operator
        }, { onConflict: 'event_id' });
        if (error) { skipped++; continue; }
        if (conf >= 0.95) {
          await sb.from('events').update({ flashscore_id: r.flashscore_id }).eq('id', r.event_id);
        }
        upserted++;
      }
      return NextResponse.json({ upserted, skipped });
    }

    case 'retroactive-verify': {
      // Mig 119: idempotent retroactive auto-verify.
      // Body: { threshold?: number (default 0.97), dry_run?: boolean (default false) }
      // dry_run=true → preview count without applying the UPDATE.
      const threshold = Math.max(0, Math.min(1, Number(body.threshold ?? 0.97)));
      const dryRun = body.dry_run === true;
      const result = await retroactiveAutoVerify(sb, threshold, dryRun);
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        dry_run: dryRun,
        threshold,
        total_affected: result.total_affected,
        by_stage: result.by_stage,
      });
    }

    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}
