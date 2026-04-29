// lib/admin/csv-export.ts
// Tiny CSV serializer used by /api/admin/canonicalization/export.csv.
// Italian Excel friendly: semicolon separator + UTF-8 (no BOM).

const SEP = ';';

/**
 * Format a single value for a CSV cell.
 * - null/undefined → empty string
 * - boolean → 'true' / 'false'
 * - number → toString (no locale-formatting; Excel parses with system locale)
 * - Date / ISO timestamp string → 'YYYY-MM-DDTHH:MM:SS'
 * - other → string. Quoted with " if contains ; " or newline. Internal " escaped as "".
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (value instanceof Date) return formatDate(value);
  const str = String(value);
  // ISO-shaped timestamps → strip trailing milliseconds + Z for cleaner cells.
  // 2026-04-27T18:30:00.000Z or 2026-04-27T18:30:00+00:00 → 2026-04-27T18:30:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
    return str.slice(0, 19);
  }
  if (str.includes(SEP) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Build a CSV string from an array of rows + a fixed column list.
 * The first emitted line is the header (column names, joined with SEP).
 * Lines are CRLF-terminated (Excel-friendly).
 */
export function buildCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const out: string[] = [];
  out.push(columns.map(c => formatCell(c)).join(SEP));
  for (const row of rows) {
    out.push(columns.map(c => formatCell(row[c])).join(SEP));
  }
  return out.join('\r\n');
}

/**
 * Build the timestamped filename, e.g. canonicalization-groups-20260427-183045.csv
 */
export function buildExportFilename(prefix: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${prefix}-${stamp}.csv`;
}
