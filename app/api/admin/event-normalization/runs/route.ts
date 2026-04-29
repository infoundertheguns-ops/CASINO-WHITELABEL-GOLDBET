export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/admin/event-normalization/runs
//
// Returns the last N runs from event_normalization_runs plus a `status`
// summary for the automation health panel:
//   - last auto (engine) run: source='auto' and source='manual' separately
//   - last sentinel retry: source='sentinel_retry_auto'/'_manual'
//
// SLA thresholds (review #4 P3-L: tightened to match actual cron cadence):
//   - auto engine cron runs every ~15 min → ok ≤18m (one cycle + 3m grace),
//     warn ≤45m (>2 missed cycles), critical else.
//   - sentinel retry: 'ok' if last < 6h, 'warn' < 24h, 'critical' else.

const AUTO_SLA_MIN = 18;
const AUTO_SLA_WARN_MIN = 45;
const SENTINEL_SLA_HR = 6;
const SENTINEL_SLA_WARN_HR = 24;

function severity(ageMin: number | null, okThreshMin: number, warnThreshMin: number) {
  if (ageMin == null) return 'never';
  if (ageMin <= okThreshMin) return 'ok';
  if (ageMin <= warnThreshMin) return 'warn';
  return 'critical';
}

export async function GET(req: NextRequest) {
  const sb = createAdminClient();
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)));

  const [latestRes, lastAutoRes, lastSentinelRes] = await Promise.all([
    sb.from('event_normalization_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit),
    sb.from('event_normalization_runs')
      .select('id, source, processed, matched, llm_used, duration_ms, error, created_at')
      .in('source', ['auto', 'manual'])
      .order('created_at', { ascending: false })
      .limit(1),
    sb.from('event_normalization_runs')
      .select('id, source, processed, matched, llm_used, duration_ms, error, created_at')
      .in('source', ['sentinel_retry_auto', 'sentinel_retry_manual'])
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const now = Date.now();
  const lastAuto = lastAutoRes.data?.[0];
  const lastSent = lastSentinelRes.data?.[0];

  const autoAgeMin = lastAuto ? (now - new Date(lastAuto.created_at).getTime()) / 60000 : null;
  const sentinelAgeMin = lastSent ? (now - new Date(lastSent.created_at).getTime()) / 60000 : null;

  return NextResponse.json({
    runs: latestRes.data ?? [],
    status: {
      auto: {
        last: lastAuto ?? null,
        age_minutes: autoAgeMin,
        severity: severity(autoAgeMin, AUTO_SLA_MIN, AUTO_SLA_WARN_MIN),
      },
      sentinel: {
        last: lastSent ?? null,
        age_minutes: sentinelAgeMin,
        severity: severity(sentinelAgeMin, SENTINEL_SLA_HR * 60, SENTINEL_SLA_WARN_HR * 60),
      },
    },
  });
}
