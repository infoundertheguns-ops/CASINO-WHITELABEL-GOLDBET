// app/admin/canonicalization/components/kpi-strip.tsx
"use client";
import type { LevelColor } from '@/lib/admin/canonicalization-types';
import { formatPct } from '@/lib/admin/canonicalization-signals';

const COLOR_BG: Record<LevelColor, string> = {
  green: 'bg-emerald-100 border-emerald-400',
  yellow: 'bg-amber-100 border-amber-400',
  red: 'bg-red-100 border-red-400',
  gray: 'bg-zinc-100 border-zinc-400',
};

const COLOR_DOT: Record<LevelColor, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  gray: '⚪',
};

export interface KpiStripProps {
  level: 1 | 2 | 3 | 4 | 5;
  title: string;
  total: number;
  pct: number;
  color: LevelColor;
  detail?: React.ReactNode;
  perSource?: React.ReactNode;
  drillDownHref?: string;
}

export function KpiStrip({ level, title, total, pct, color, detail, perSource, drillDownHref }: KpiStripProps) {
  return (
    <div className={`border-l-4 p-4 mb-3 rounded-r ${COLOR_BG[color]}`}>
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-sm">
          LEVEL {level}: {title.toUpperCase()} {COLOR_DOT[color]}
        </h3>
        {drillDownHref && (
          <a href={drillDownHref} className="text-xs underline opacity-80">
            drill-down →
          </a>
        )}
      </div>
      <div className="text-2xl font-mono mt-1">{formatPct(pct)}</div>
      <div className="text-xs opacity-80">total {total}</div>
      {detail && <div className="text-xs mt-2">{detail}</div>}
      {perSource && <div className="text-xs mt-2 opacity-80">{perSource}</div>}
    </div>
  );
}
