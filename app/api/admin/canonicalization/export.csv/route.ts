// app/api/admin/canonicalization/export.csv/route.ts
// Streams a CSV download of all (non-ended) event groups, one row per group.
// Italian Excel friendly: semicolon separator + UTF-8 (no BOM).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { buildCsv, buildExportFilename } from '@/lib/admin/csv-export';

// Fixed column order matches the plan's CSV spec (2026-04-27).
const COLUMNS = [
  'group_type',
  'real_world_label',
  'sport',
  'league',
  'country',
  'country_code',
  'tour_code',
  'starts_at',
  'flashscore_id',
  'verified',
  'match_stage',
  'confidence',
  'llm_verify',
  'verified_by',
  'kambi_external_id',
  'kambi_status',
  'kambi_markets',
  'kambi_outcomes',
  '22bet_external_id',
  '22bet_status',
  '22bet_markets',
  '22bet_outcomes',
  'betfair_external_id',
  'betfair_status',
  'betfair_markets',
  'betfair_outcomes',
];

export async function GET() {
  const sb = createAdminClient();
  const { data, error } = await sb.rpc('canonicalization_export_groups');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  const csv = buildCsv(COLUMNS, rows);
  const filename = buildExportFilename('canonicalization-groups');
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
