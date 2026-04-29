// app/admin/canonicalization/overview-tab.tsx
"use client";
import { useEffect, useState } from 'react';
import type { OverviewResponse } from '@/lib/admin/canonicalization-types';
import { KpiStrip } from './components/kpi-strip';
import { formatPct } from '@/lib/admin/canonicalization-signals';

export function OverviewTab() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/canonicalization/overview');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  if (loading) return <div className="text-sm opacity-70">Caricamento KPI...</div>;
  if (error) return <div className="text-sm text-red-600">Errore: {error}</div>;
  if (!data) return null;

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-3 text-xs opacity-70">
        <span>Generato: {new Date(data.generated_at).toLocaleString('it-IT')}</span>
        <button onClick={reload} className="underline">↻ Aggiorna</button>
      </div>

      <KpiStrip
        level={1}
        title="Sports"
        total={data.level_1_sports.total as number}
        pct={data.level_1_sports.pct}
        color={data.level_1_sports.color}
      />

      <KpiStrip
        level={2}
        title="Leagues"
        total={data.level_2_leagues.total}
        pct={data.level_2_leagues.pct}
        color={data.level_2_leagues.color}
        detail={
          <>
            <span>Identified: {data.level_2_leagues.identified}</span>
            {' · '}
            <span>Unknown: {data.level_2_leagues.unknown}</span>
          </>
        }
        perSource={
          <>
            {Object.entries(data.level_2_leagues.per_source)
              .map(([src, v]) => `${src}: ${v.unknown} unknown`)
              .join(' · ')}
          </>
        }
      />

      <KpiStrip
        level={3}
        title="Events (active 7d)"
        total={data.level_3_events.total_active_7d}
        pct={data.level_3_events.coverage_among_mappable_pct ?? data.level_3_events.flashscore_pct}
        color={data.level_3_events.color}
        detail={
          <>
            <div>Flashscore mapped: {data.level_3_events.flashscore_mapped} ({formatPct(data.level_3_events.flashscore_pct)} totale)</div>
            <div>
              Coverage tra mappabili: {data.level_3_events.flashscore_mapped}/{data.level_3_events.mappable_total ?? data.level_3_events.total_active_7d}
              {' '}({formatPct(data.level_3_events.coverage_among_mappable_pct ?? data.level_3_events.flashscore_pct)})
            </div>
            <div>🔒 Strutturalmente source-only: {data.level_3_events.source_only_flagged}</div>
            <div>Verified: {data.level_3_events.verified} ({formatPct(data.level_3_events.verified_pct)} dei mapped)</div>
            <div>Per stage: 🤖 auto {data.level_3_events.per_stage.auto} · 👤 manual {data.level_3_events.per_stage.manual} · 🤖 LLM auto {data.level_3_events.per_stage.llm_auto}</div>
            <div>🟣 Cross-source canonical: {data.level_3_events.cross_source_canonical} ({formatPct(data.level_3_events.cross_source_pct)}) · {data.level_3_events.cross_source_clusters} cluster</div>
          </>
        }
        perSource={
          <>
            {Object.entries(data.level_3_events.per_source)
              .map(([src, v]) => `${src}: ${v.mapped}/${v.total} (${formatPct(v.pct)})`)
              .join(' · ')}
          </>
        }
        drillDownHref="/admin/event-normalization"
      />

      <KpiStrip
        level={4}
        title="Markets"
        total={data.level_4_markets.total}
        pct={data.level_4_markets.pct}
        color={data.level_4_markets.color}
        detail={<>Canonicalized: {data.level_4_markets.canonical}</>}
        drillDownHref="/admin/market-normalization"
      />

      <KpiStrip
        level={5}
        title="Outcomes"
        total={data.level_5_outcomes.total_distinct}
        pct={data.level_5_outcomes.pct}
        color={data.level_5_outcomes.color}
        detail={<>Canonical seed: {data.level_5_outcomes.canonical_seed}</>}
        drillDownHref="/admin/outcome-normalization"
      />
    </div>
  );
}
