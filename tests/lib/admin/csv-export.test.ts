import { describe, it, expect } from 'vitest';
import { formatCell, buildCsv, buildExportFilename } from '@/lib/admin/csv-export';

describe('formatCell', () => {
  it('emits empty string for null/undefined', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('emits booleans as true/false', () => {
    expect(formatCell(true)).toBe('true');
    expect(formatCell(false)).toBe('false');
  });

  it('emits finite numbers as-is, NaN/Infinity as empty', () => {
    expect(formatCell(0)).toBe('0');
    expect(formatCell(42)).toBe('42');
    expect(formatCell(-1.5)).toBe('-1.5');
    expect(formatCell(Number.NaN)).toBe('');
    expect(formatCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('passes plain strings unchanged', () => {
    expect(formatCell('Roma')).toBe('Roma');
    expect(formatCell('')).toBe('');
  });

  it('quotes strings containing the separator (;)', () => {
    expect(formatCell('a;b')).toBe('"a;b"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(formatCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes strings containing newlines and CR', () => {
    expect(formatCell('line1\nline2')).toBe('"line1\nline2"');
    expect(formatCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('truncates ISO timestamps to YYYY-MM-DDTHH:MM:SS', () => {
    expect(formatCell('2026-04-27T18:30:45.123Z')).toBe('2026-04-27T18:30:45');
    expect(formatCell('2026-04-27T18:30:45+00:00')).toBe('2026-04-27T18:30:45');
  });

  it('formats Date objects as UTC ISO timestamp', () => {
    const d = new Date(Date.UTC(2026, 3, 27, 18, 30, 45));
    expect(formatCell(d)).toBe('2026-04-27T18:30:45');
  });
});

describe('buildCsv', () => {
  it('emits header line + one line per row, CRLF separated, with semicolon delimiter', () => {
    const csv = buildCsv(['a', 'b'], [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
    expect(csv).toBe('a;b\r\n1;2\r\n3;4');
  });

  it('emits empty cells when row keys are missing', () => {
    const csv = buildCsv(['x', 'y', 'z'], [{ x: '1', z: '3' }]);
    expect(csv).toBe('x;y;z\r\n1;;3');
  });

  it('quotes header cells when they contain special chars', () => {
    const csv = buildCsv(['plain', 'has;sep'], [{ plain: 'a', 'has;sep': 'b' }]);
    expect(csv).toBe('plain;"has;sep"\r\na;b');
  });

  it('builds an empty CSV with just the header when no rows', () => {
    expect(buildCsv(['a', 'b'], [])).toBe('a;b');
  });
});

describe('buildExportFilename', () => {
  it('generates a timestamped filename', () => {
    const d = new Date(Date.UTC(2026, 3, 27, 18, 30, 45));
    expect(buildExportFilename('canonicalization-groups', d)).toBe(
      'canonicalization-groups-20260427-183045.csv'
    );
  });
});
