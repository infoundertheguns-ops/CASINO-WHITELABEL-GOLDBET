'use client';

// E1 follow-up A — useAdminFilters wired. `tab`, `sport`, `use_llm` now persist in URL
// (deep-linkable). Dynamic rendering forced because the hook reads useSearchParams.
// E9/E8 sweep (2026-04-24 late) — migrated to shared ui/ primitives:
// Kpi/KpiRow, AdminTable/Th/Td/Tr/EmptyRow, FilterBar/AdminSelect/AdminCheckboxLabel,
// GlossaryTerm on key column headers. Stats fetched on mount so the KPI row is always
// visible, not only on the "Stats" tab.
export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ManualAssignModal } from '@/components/admin/event-normalization/manual-assign-modal';
import { useAdminFilters } from '@/lib/hooks/use-admin-filters';
import { EngineRunBar } from '@/components/admin/normalization/primitives';
import {
  Kpi,
  KpiRow,
  GlossaryTerm,
  FilterBar,
  AdminSelect,
  AdminCheckboxLabel,
  AdminTable,
  AdminThead,
  AdminTh,
  AdminTd,
  AdminTr,
  AdminEmptyRow,
} from '@/components/admin/ui';

type Tab = 'unmapped' | 'llm_pending' | 'low_confidence' | 'verified' | 'stats' | 'team_aliases';

const tabs: Array<{ id: Tab; label: string; sub?: string }> = [
  { id: 'unmapped',        label: 'Non mappati' },
  { id: 'llm_pending',     label: 'LLM da rivedere', sub: 'verify=false o conf<0.95' },
  { id: 'low_confidence',  label: 'Bassa confidence' },
  { id: 'verified',        label: 'Verificati' },
  { id: 'team_aliases',    label: 'Team aliases', sub: 'LLM proposals + dictionary' },
  { id: 'stats',           label: 'Stats' },
];

const SPORTS = ['Calcio', 'Tennis', 'Basket', 'Pallamano', 'Volley',
  'Hockey Ghiaccio', 'Tennis Tavolo', 'Baseball', 'Rugby', 'Esports', 'Cricket'];

const SPORT_OPTIONS = [
  { value: '', label: 'Tutti gli sport' },
  ...SPORTS.map((s) => ({ value: s, label: s })),
];

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (default · cheap)' },
  { value: 'claude-sonnet-4-6',          label: 'Sonnet 4.6 (3× costo)' },
  { value: 'claude-opus-4-7',            label: 'Opus 4.7 (15× costo)' },
];

interface StageStat {
  count: number;
  avg_conf: number;
  verified: number;
  // Mig 119 — auto-verified (verified_by NULL) vs human-verified (verified_by IS NOT NULL).
  // Optional for backward compat with the older getStats shape.
  auto_verified?: number;
  human_verified?: number;
}
interface Stats {
  total_mapped: number;
  auto_verified?: number;
  human_verified?: number;
  by_stage: Record<string, StageStat>;
  by_sport?: any[];
}
interface CoverageRow {
  source: string | null;
  total_events: number;
  mapped_events: number;
  coverage_pct: number;
}

type RunSeverity = 'ok' | 'warn' | 'critical' | 'never';
interface RunSummary {
  last: {
    source: string;
    processed: number;
    matched: number;
    llm_used: number;
    duration_ms: number;
    error: string | null;
    created_at: string;
  } | null;
  age_minutes: number | null;
  severity: RunSeverity;
}
interface RunsStatus {
  auto: RunSummary;
  sentinel: RunSummary;
}

const SEVERITY_COLOR: Record<RunSeverity, string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  critical: '#ef4444',
  never: '#64748b',
};
const SEVERITY_LABEL: Record<RunSeverity, string> = {
  ok: 'OK',
  warn: 'STALE',
  critical: 'CRITICO',
  never: 'MAI',
};

function formatAge(mins: number | null): string {
  if (mins == null) return 'mai';
  if (mins < 1) return `${Math.round(mins * 60)}s fa`;
  if (mins < 60) return `${Math.round(mins)}m fa`;
  if (mins < 60 * 24) return `${(mins / 60).toFixed(1)}h fa`;
  return `${Math.round(mins / 60 / 24)}d fa`;
}

// Mig 119 — single-glance trust signal for an event_normalization row.
//   👤 verified_by IS NOT NULL → operator confirmed
//   🤖 verified=true && verified_by IS NULL → engine + retro cron auto-verified
//   ⏳ stage=llm && !verified → LLM produced match, awaiting human review
//   ⚠️ confidence < 0.85 && !verified → low confidence, needs eyes
//   ❌ stage=unmapped → pipeline gave up (sentinel)
//   ❓ fallback (mapped, mid-confidence, awaiting auto-verify cron)
function trustIcon(row: any): string {
  if (row.match_stage === 'unmapped') return '❌';
  if (row.verified === true) return row.verified_by ? '👤' : '🤖';
  if (row.match_stage === 'llm') return '⏳';
  if (typeof row.confidence === 'number' && row.confidence < 0.85) return '⚠️';
  return '❓';
}

function trustTooltip(row: any): string {
  if (row.match_stage === 'unmapped') return 'Non mappato — pipeline ha esaurito gli stage senza match';
  if (row.verified === true) {
    return row.verified_by
      ? 'Verificato manualmente da operatore'
      : 'Auto-verificato dal pipeline (engine inline o cron retroattivo)';
  }
  if (row.match_stage === 'llm') return 'Match LLM in attesa di review (verify=false o conf<0.95)';
  if (typeof row.confidence === 'number' && row.confidence < 0.85) {
    return `Bassa confidence (${(row.confidence * 100).toFixed(0)}%) — review consigliata`;
  }
  return 'Mappato, in attesa del prossimo cron auto-verify';
}

export default function EventNormalizationPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: 'var(--admin-text-muted)' }}>Caricamento…</div>}>
      <EventNormalizationContent />
    </Suspense>
  );
}

function EventNormalizationContent() {
  const { filters, updateFilter } = useAdminFilters({
    tab: 'unmapped' as Tab,
    sport: '',
    use_llm: false as boolean,
    model: 'claude-haiku-4-5-20251001',
    // E6: drill-through from Fixtures — when set, restricts table to rows mapping to this flashscore_id.
    flashscore_id: '',
    // Mig 119 sub-filters
    llm_filter: 'all' as 'all' | 'verify_false' | 'low_conf',
    verified_by_filter: 'all' as 'all' | 'auto' | 'manual',
  });
  const tab = filters.tab;
  const sport = filters.sport;
  const useLlm = filters.use_llm;
  const model = filters.model;
  const flashscoreId = filters.flashscore_id;
  const llmFilter = filters.llm_filter as 'all' | 'verify_false' | 'low_conf';
  const verifiedByFilter = filters.verified_by_filter as 'all' | 'auto' | 'manual';
  const setTab = (v: Tab) => updateFilter('tab', v);
  const setSport = (v: string) => updateFilter('sport', v);
  const setUseLlm = (v: boolean) => updateFilter('use_llm', v);
  const setModel = (v: string) => updateFilter('model', v);
  const clearFlashscoreId = () => updateFilter('flashscore_id', '');
  const setLlmFilter = (v: 'all' | 'verify_false' | 'low_conf') => updateFilter('llm_filter', v);
  const setVerifiedByFilter = (v: 'all' | 'auto' | 'manual') => updateFilter('verified_by_filter', v);

  // E6: if arriving with ?flashscore_id=... set the tab to a filterable view.
  useEffect(() => {
    if (flashscoreId && tab === 'unmapped') updateFilter('tab', 'verified');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashscoreId]);

  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [runsStatus, setRunsStatus] = useState<RunsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [assignTarget, setAssignTarget] = useState<any | null>(null);
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const [showManualControls, setShowManualControls] = useState(false);

  // Bulk selection state (review #4 P2-H — autopilot review queue staging).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Inline 2-step reject confirmation (review #4 P1-C).
  const [rejectArmedId, setRejectArmedId] = useState<number | null>(null);
  // Sprint 1: include ended events in coverage denominator (default off so
  // the metric reflects forward-looking betting capacity, not historical).
  const [coverageIncludeEnded, setCoverageIncludeEnded] = useState(false);

  // Reset selection when tab/filter change so we don't carry stale ids across pages.
  useEffect(() => { setSelectedIds(new Set()); setRejectArmedId(null); }, [tab, sport, flashscoreId]);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/event-normalization?action=stats');
      if (!r.ok) {
        setMessage(`Errore stats (HTTP ${r.status}).`);
        return;
      }
      const data = (await r.json()) as Stats;
      setStats(data);
    } catch (e: any) {
      setMessage(`Errore stats: ${e.message}`);
    }
  }, []);

  const loadCoverage = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ action: 'coverage', window_days: '7' });
      if (coverageIncludeEnded) qs.set('include_ended', 'true');
      const r = await fetch(`/api/admin/event-normalization?${qs}`);
      if (!r.ok) return;
      const d = await r.json();
      setCoverage((d.rows ?? []) as CoverageRow[]);
    } catch { /* non-blocking */ }
  }, [coverageIncludeEnded]);

  const loadRunsStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/event-normalization/runs?limit=5');
      if (!r.ok) return;
      const d = await r.json();
      setRunsStatus(d.status ?? null);
    } catch { /* non-blocking */ }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sport, flashscoreId, llmFilter, verifiedByFilter]);

  useEffect(() => {
    void loadStats();
    void loadCoverage();
    void loadRunsStatus();
    fetch('/api/admin/event-normalization/status')
      .then((r) => r.json())
      .then((d) => setLlmAvailable(!!d.llm_available))
      .catch(() => setLlmAvailable(false));

    // Refresh automation status every 30s so the operator sees freshness live.
    const interval = setInterval(() => {
      void loadRunsStatus();
      void loadCoverage();
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadStats, loadCoverage, loadRunsStatus]);

  async function load() {
    setBusy(true);
    setMessage('');
    try {
      if (tab === 'stats') {
        await loadStats();
        return;
      }
      const params = new URLSearchParams();
      if (sport) params.set('sport', sport);
      if (tab === 'unmapped') params.set('action', 'unmapped');
      if (tab === 'llm_pending') {
        params.set('stage', 'llm');
        params.set('verified', 'false');
        // Mig 119 sub-filter: verify=false / low_conf / all
        if (llmFilter !== 'all') params.set('llm_filter', llmFilter);
      }
      // Review #4 P1-B: low_confidence now uses dedicated server-side RPC
      // (mig 115). Pre-fix this filtered client-side AFTER paging, hiding
      // low-conf rows past the first 200.
      if (tab === 'low_confidence') params.set('action', 'low_confidence');
      if (tab === 'verified') {
        params.set('verified', 'true');
        // Mig 119: auto-only / manual-only / both for the Verificati tab.
        if (verifiedByFilter !== 'all') params.set('verified_by_filter', verifiedByFilter);
      }
      if (flashscoreId) params.set('flashscore_id', flashscoreId);
      params.set('limit', '200');
      const r = await fetch(`/api/admin/event-normalization?${params}`);
      if (!r.ok) {
        setMessage(`Errore (HTTP ${r.status}).`);
        setRows([]);
        return;
      }
      const data = await r.json();
      setRows(data.rows ?? []);
    } catch (e: any) {
      setMessage(`Errore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: number) {
    await fetch('/api/admin/event-normalization', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', id }),
    });
    setRows(rows.filter((r) => r.id !== id));
    void loadStats();
  }

  async function reject(id: number, event_id: string) {
    await fetch('/api/admin/event-normalization', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', id, event_id }),
    });
    setRows(rows.filter((r) => r.id !== id));
    setRejectArmedId(null);
    void loadStats();
  }

  // Bulk actions (P2-H — autopilot review queue prep).
  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelectedIds(new Set(rows.map((r) => r.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }
  async function bulkVerify() {
    if (selectedIds.size === 0) return;
    setBusy(true);
    setMessage(`Verifica ${selectedIds.size} mapping…`);
    try {
      const ids = Array.from(selectedIds);
      const r = await fetch('/api/admin/event-normalization', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk-verify', ids }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setMessage(`Verificati ${d.verified} mapping (propagati a events: ${d.propagated}).`);
      setRows(rows.filter((row) => !selectedIds.has(row.id)));
      clearSelection();
      void loadStats();
      void loadCoverage();
    } catch (e: any) {
      setMessage(`Errore bulk verify: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  async function bulkReject() {
    if (selectedIds.size === 0) return;
    setBusy(true);
    setMessage(`Rifiuta ${selectedIds.size} mapping…`);
    try {
      const ids = Array.from(selectedIds);
      const r = await fetch('/api/admin/event-normalization', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk-reject', ids }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setMessage(`Rifiutati ${d.rejected} mapping (events.flashscore_id ripuliti: ${d.cleared_events}).`);
      setRows(rows.filter((row) => !selectedIds.has(row.id)));
      clearSelection();
      void loadStats();
      void loadCoverage();
    } catch (e: any) {
      setMessage(`Errore bulk reject: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // Mig 119 — retroactive auto-verify (one-shot from UI button).
  // Two-step UX: dry-run preview → operator confirms → real UPDATE.
  async function runRetroactiveVerify() {
    setBusy(true);
    setMessage('Calcolo anteprima auto-verify retroattivo…');
    try {
      const r1 = await fetch('/api/admin/event-normalization', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retroactive-verify', threshold: 0.97, dry_run: true }),
      });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error ?? `HTTP ${r1.status}`);
      const total = d1.total_affected ?? 0;
      if (total === 0) {
        setMessage('Nessun mapping da auto-verificare al momento (tutti già verificati o sotto soglia 0.97).');
        return;
      }
      const breakdown = Object.entries(d1.by_stage as Record<string, number>)
        .map(([s, n]) => `${s}: ${n}`).join(' · ');
      const ok = window.confirm(
        `Stai per AUTO-VERIFICARE ${total.toLocaleString('it-IT')} mapping con confidence ≥ 0.97.\n\n` +
        `Breakdown per stage: ${breakdown}\n\n` +
        `Stage inclusi: regex, trigram, alias_dict, propagation, flashscore_native.\n` +
        `Stage LLM esclusi (necessitano del campo verify=true, applicato inline dall'engine).\n\n` +
        `Operatori già verificati NON saranno toccati. Confermi?`
      );
      if (!ok) {
        setMessage('Annullato. Nessun update applicato.');
        return;
      }
      const r2 = await fetch('/api/admin/event-normalization', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retroactive-verify', threshold: 0.97, dry_run: false }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error ?? `HTTP ${r2.status}`);
      setMessage(`✅ Auto-verificati ${d2.total_affected.toLocaleString('it-IT')} mapping.`);
      void loadStats();
      void loadCoverage();
      void load();
    } catch (e: any) {
      setMessage(`Errore retroactive verify: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // Legacy prompt() flow removed in E1.F2a — now via ManualAssignModal.
  function openAssign(row: any) {
    setAssignTarget({
      id: row.id,
      home_team: row.home_team,
      away_team: row.away_team,
      starts_at: row.starts_at,
      sport: row.sports?.name ?? null,
    });
  }

  async function runEngine() {
    setBusy(true);
    setMessage(useLlm ? 'Engine + LLM in corso…' : 'Engine in corso…');
    try {
      const r = await fetch('/api/admin/event-normalization/run-engine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_size: 500, sport: sport || undefined, use_llm: useLlm, model }),
      });
      const data = await r.json();
      const llmNote = data.llm ? ` · LLM: ${data.llm.skipped ? data.llm.reason : `matched=${data.llm.matched}/${data.llm.batches_used} (errors=${data.llm.errors})`}` : '';
      setMessage(`Processati: ${data.processed} in ${data.took_ms}ms. Stage: ${JSON.stringify(data.stats ?? {})}${llmNote}`);
      void load();
      void loadStats();
      void loadRunsStatus();
    } catch (e: any) {
      setMessage(`Errore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function openSubagentBatch(mode: 'unmapped' | 'sentinels', batchSize: number) {
    setBusy(true);
    setMessage(`Preparazione batch ${mode} (${batchSize})…`);
    try {
      const r = await fetch('/api/admin/event-normalization/subagent-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: mode, batch_size: batchSize, sport: sport || undefined }),
      });
      if (!r.ok) {
        setMessage(`Errore batch (HTTP ${r.status}).`);
        return;
      }
      const data = await r.json();
      const json = JSON.stringify(data, null, 2);
      // Open in new tab (data URL) so the operator can copy-paste into a Claude Code subagent.
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `event-norm-subagent-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        `Batch ${mode}: ${data.summary?.returned ?? 0} eventi (${data.summary?.with_candidates ?? 0} con candidati). ` +
        `File scaricato. Passa a un subagent, poi POSTa i risultati ad action=llm-submit.`
      );
    } catch (e: any) {
      setMessage(`Errore batch: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function runSentinelRetry() {
    setBusy(true);
    setMessage('Retry sentinel LLM in corso…');
    try {
      const r = await fetch('/api/admin/event-normalization/run-engine/retry-sentinels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_size: 100, llm_budget: 50, sport: sport || undefined, model }),
      });
      const data = await r.json();
      if (!r.ok) {
        setMessage(`Errore retry sentinel (HTTP ${r.status}): ${data.error ?? ''}`);
        return;
      }
      setMessage(
        `Retry sentinel: processati ${data.processed}, eligibili ${data.eligible}, tentati ${data.attempted ?? 0}, ` +
        `matched ${data.matched ?? 0}, errori ${data.errors ?? 0} in ${data.took_ms}ms.`
      );
      void load();
      void loadStats();
      void loadRunsStatus();
    } catch (e: any) {
      setMessage(`Errore retry sentinel: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // ═══ Derived KPI values ═══
  // `stage=unmapped` (mig 087c) is a sentinel marking events the pipeline
  // already processed without a result — not a real mapping. We exclude it
  // from the "real mapped" counters so % and avg_conf stay meaningful, and
  // surface the unmapped count as its own KPI.
  const kpiAggregate = useMemo(() => {
    if (!stats) return null;
    const entries = Object.entries(stats.by_stage ?? {}) as Array<[string, StageStat]>;
    const realEntries = entries.filter(([stage]) => stage !== 'unmapped');
    const unmappedRec = stats.by_stage?.unmapped;

    const mappedReal = realEntries.reduce((s, [, r]) => s + r.count, 0);
    const verified = realEntries.reduce((s, [, r]) => s + (r.verified ?? 0), 0);
    // Mig 119 — split verified into auto (engine + retro cron) vs human (operator click).
    const autoVerified = stats.auto_verified
      ?? realEntries.reduce((s, [, r]) => s + (r.auto_verified ?? 0), 0);
    const humanVerified = stats.human_verified
      ?? realEntries.reduce((s, [, r]) => s + (r.human_verified ?? 0), 0);
    const llmRec = stats.by_stage?.llm;
    const llmPending = llmRec ? Math.max(0, llmRec.count - llmRec.verified) : 0;
    const lowConf = realEntries.reduce((s, [, r]) => {
      // rough heuristic: real-mapping stages with avg_conf < 85% contribute
      // their full unverified slice
      if (r.avg_conf >= 0.85) return s;
      return s + Math.max(0, r.count - r.verified);
    }, 0);
    const weightedConf = mappedReal
      ? realEntries.reduce((s, [, r]) => s + r.avg_conf * r.count, 0) / mappedReal
      : 0;
    return {
      mappedReal,
      realStageCount: realEntries.length,
      unmappedSentinel: unmappedRec?.count ?? 0,
      verified,
      verifiedPct: mappedReal ? (verified / mappedReal) * 100 : 0,
      autoVerified,
      humanVerified,
      llmPending,
      lowConf,
      avgConfPct: weightedConf * 100,
    };
  }, [stats]);

  const statsTableRows = useMemo(() => {
    if (!stats) return [] as Array<[string, StageStat]>;
    return Object.entries(stats.by_stage ?? {}) as Array<[string, StageStat]>;
  }, [stats]);

  // Coverage KPI breakdown (review #4 P2-E + P2-F).
  // The RPC returns one ROLLUP row with source=NULL representing the overall total.
  const coverageBreakdown = useMemo(() => {
    if (coverage.length === 0) return null;
    const overall = coverage.find((r) => r.source == null) ?? null;
    const perSource = coverage.filter((r) => r.source != null);
    return { overall, perSource };
  }, [coverage]);
  const coverageColor = (pct: number | null | undefined) => {
    if (pct == null) return '#64748b';
    if (pct >= 95) return '#10b981';
    if (pct >= 80) return '#3b82f6';
    if (pct >= 60) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div style={{ padding: 20, color: 'var(--admin-text)' }}>
      <h1 style={{ marginBottom: 8 }}>🎯 Normalizzazione Eventi</h1>
      <p style={{ color: 'var(--admin-text-muted)', marginBottom: 16 }}>
        Pipeline a 5 stage per mappare{' '}
        <GlossaryTerm term="flashscore_id"><code>events.flashscore_id</code></GlossaryTerm>.
        Target: ≥95% coverage.
      </p>

      {/* ═══ Automazione ═══ */}
      <div style={{
        marginBottom: 16,
        padding: 12,
        border: '1px solid var(--admin-border)',
        borderRadius: 10,
        background: 'var(--admin-card)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: 'var(--admin-text-muted)',
          }}>
            ⚙ Automazione
          </div>
          <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
            Auto SLA ≤30m · Sentinel SLA ≤6h · refresh 30s
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 10,
        }}>
          <AutomationCard
            title="Auto engine"
            subtitle="Nuovi eventi · stages 1-4 + LLM residui"
            status={runsStatus?.auto}
          />
          <AutomationCard
            title="Retry sentinel"
            subtitle="LLM su match_stage='unmapped' entro 7d"
            status={runsStatus?.sentinel}
          />
          {/* Mig 119 — retroactive auto-verify (one-shot from UI). */}
          <div style={{
            padding: 10,
            border: '1px solid var(--admin-border)',
            borderRadius: 8,
            background: 'var(--admin-surface)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-text)' }}>
              Auto-verify retroattivo
            </div>
            <div style={{ fontSize: 10, color: 'var(--admin-text-muted)', lineHeight: 1.4 }}>
              Marca <code>verified=true</code> sui mapping conf≥0.97 (regex/trigram/alias/propagation/native).
              LLM escluso (richiede dual gate). Idempotente, preserva conferme operator.
            </div>
            <button
              onClick={runRetroactiveVerify}
              disabled={busy}
              style={{
                padding: '6px 12px',
                background: '#10b981',
                color: '#fff',
                border: 0,
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              ▶ Esegui ora (preview)
            </button>
          </div>
        </div>
      </div>

      {/* Coverage card (review #4 P2-E + P2-F): overall + per-source ≥95% target. */}
      {coverageBreakdown && (
        <div style={{
          marginBottom: 12,
          padding: 10,
          border: '1px solid var(--admin-border)',
          borderRadius: 10,
          background: 'var(--admin-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: 'var(--admin-text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <span>
              📊 Coverage 7d (target ≥95%)
              <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--admin-text-muted)' }}>
                {coverageIncludeEnded ? 'incl. eventi finiti' : 'solo prematch + live'}
              </span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 500, textTransform: 'none', cursor: 'pointer', color: 'var(--admin-text-muted)' }}>
                <input
                  type="checkbox"
                  checked={coverageIncludeEnded}
                  onChange={(e) => setCoverageIncludeEnded(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Include ended
              </label>
              {coverageBreakdown.overall && (
                <span style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
                  {coverageBreakdown.overall.mapped_events.toLocaleString('it-IT')} / {coverageBreakdown.overall.total_events.toLocaleString('it-IT')} eventi
                </span>
              )}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            {coverageBreakdown.overall && (
              <div style={{
                padding: '6px 14px',
                borderRadius: 8,
                background: `${coverageColor(coverageBreakdown.overall.coverage_pct)}22`,
                color: coverageColor(coverageBreakdown.overall.coverage_pct),
                fontWeight: 700,
                fontSize: 16,
                border: `1px solid ${coverageColor(coverageBreakdown.overall.coverage_pct)}`,
              }}>
                Overall: {coverageBreakdown.overall.coverage_pct}%
              </div>
            )}
            {coverageBreakdown.perSource.map((r) => (
              <div key={r.source ?? 'unknown'} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11 }}>
                <span style={{ color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                  {r.source ?? 'unknown'}
                </span>
                <span style={{ color: coverageColor(r.coverage_pct), fontWeight: 700 }}>
                  {r.coverage_pct}% ({r.mapped_events.toLocaleString('it-IT')}/{r.total_events.toLocaleString('it-IT')})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <KpiRow minWidth={160}>
          <Kpi
            label="Mappati (reali)"
            value={kpiAggregate?.mappedReal.toLocaleString('it-IT') ?? '—'}
            accent="#334155"
            sub={kpiAggregate ? `${kpiAggregate.realStageCount} stage · esclude sentinel` : undefined}
          />
          <Kpi
            label={<GlossaryTerm term="canonical_verified">Verificati</GlossaryTerm>}
            value={kpiAggregate?.verified.toLocaleString('it-IT') ?? '—'}
            accent="#10b981"
            sub={kpiAggregate
              ? `${kpiAggregate.verifiedPct.toFixed(1)}% dei mappati · 🤖 ${kpiAggregate.autoVerified.toLocaleString('it-IT')} auto · 👤 ${kpiAggregate.humanVerified.toLocaleString('it-IT')} manual`
              : undefined}
          />
          <Kpi
            label="LLM da rivedere"
            value={kpiAggregate?.llmPending.toLocaleString('it-IT') ?? '—'}
            accent={kpiAggregate && kpiAggregate.llmPending > 0 ? '#f59e0b' : '#64748b'}
            sub="verify=false oppure conf<0.95"
          />
          <Kpi
            label={<GlossaryTerm term="confidence">Bassa confidence</GlossaryTerm>}
            value={kpiAggregate?.lowConf.toLocaleString('it-IT') ?? '—'}
            accent={kpiAggregate && kpiAggregate.lowConf > 0 ? '#ef4444' : '#64748b'}
            sub="stage reali con avg_conf < 85%"
          />
          <Kpi
            label="Avg confidence"
            value={kpiAggregate ? `${kpiAggregate.avgConfPct.toFixed(1)}%` : '—'}
            accent="#60a5fa"
            sub="media pesata, esclude unmapped"
          />
          <Kpi
            label="Unmapped (sentinel)"
            value={kpiAggregate?.unmappedSentinel.toLocaleString('it-IT') ?? '—'}
            accent="#64748b"
            sub="eventi processati senza match"
          />
        </KpiRow>
      </div>

      {flashscoreId && (
        <div style={{
          padding: '8px 12px',
          marginBottom: 12,
          background: 'rgba(6,182,212,0.1)',
          border: '1px solid #06b6d4',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
        }}>
          <span style={{ color: '#06b6d4', fontWeight: 700 }}>Filtro da Fixtures:</span>
          <GlossaryTerm term="flashscore_id">
            <code style={{ color: 'var(--admin-text)', fontFamily: 'monospace' }}>flashscore_id = {flashscoreId}</code>
          </GlossaryTerm>
          <button
            onClick={clearFlashscoreId}
            style={{ marginLeft: 'auto', padding: '3px 10px', background: 'transparent', border: '1px solid #06b6d4', color: '#06b6d4', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
          >
            ✕ Rimuovi filtro
          </button>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <FilterBar>
          <AdminSelect
            value={sport as string}
            onChange={setSport}
            options={SPORT_OPTIONS}
            label="Sport"
          />
          <button
            onClick={() => setShowManualControls((v) => !v)}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--admin-border)',
              borderRadius: 6,
              color: 'var(--admin-text-muted)',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: 700,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
            }}
            aria-expanded={showManualControls}
            aria-controls="manual-controls"
          >
            {showManualControls ? '▲ Nascondi controlli manuali' : '▼ Controlli manuali'}
          </button>
          {message && <span style={{ color: 'var(--admin-text-muted)', fontSize: 12 }}>{message}</span>}
        </FilterBar>
      </div>

      {showManualControls && (
        <div id="manual-controls" style={{
          marginBottom: 12,
          padding: 12,
          border: '1px dashed var(--admin-border)',
          borderRadius: 10,
          background: 'rgba(139,92,246,0.04)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <div style={{
            fontSize: 11,
            color: 'var(--admin-text-muted)',
            fontStyle: 'italic',
          }}>
            Sono trigger manuali. In funzionamento normale i cron ci pensano da soli —
            usare solo se l'automazione è in stato STALE/CRITICO o per debug.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <AdminSelect
              value={model as string}
              onChange={setModel}
              options={MODEL_OPTIONS}
              label="Model"
            />
            <span style={{ fontSize: 10, color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>
              Si applica a Run engine (con LLM) + Retry sentinel
            </span>
          </div>
          <EngineRunBar
            running={busy}
            onRun={runEngine}
            label={`Run engine${useLlm ? ' + LLM' : ''} (500)`}
            extraControls={
              <AdminCheckboxLabel
                checked={useLlm}
                onChange={(v) => { if (llmAvailable) setUseLlm(v); }}
              >
                <span
                  style={{ opacity: llmAvailable ? 1 : 0.5 }}
                  title={llmAvailable ? 'Abilita LLM stage (costa tokens Anthropic)' : 'ANTHROPIC_API_KEY non configurato sul server'}
                >
                  use LLM {!llmAvailable && '(unavailable)'}
                </span>
              </AdminCheckboxLabel>
            }
          />
          <button
            onClick={runSentinelRetry}
            disabled={busy || !llmAvailable}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 14px',
              background: llmAvailable ? '#f59e0b' : '#64748b',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 12,
              cursor: busy || !llmAvailable ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
            title={llmAvailable ? 'Rilancia LLM sui sentinel entro 7 giorni (budget 50) — usa credito Anthropic' : 'ANTHROPIC_API_KEY non configurato sul server'}
          >
            {busy ? 'Retry sentinel in corso…' : '▶ Retry sentinel via API (100, LLM 50)'}
          </button>

          <div style={{
            marginTop: 6,
            paddingTop: 10,
            borderTop: '1px dashed var(--admin-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-text)' }}>
              🤖 Subagent mode (zero costo API)
            </div>
            <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>
              Esporta un batch pronto per Claude Code subagent. Copia il JSON,
              falo ragionare in un subagent, poi rimanda via <code>llm-submit</code>.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => openSubagentBatch('unmapped', 30)}
                disabled={busy}
                style={{
                  padding: '6px 14px',
                  background: '#0ea5e9',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
                title="Scarica 30 nuovi eventi non mappati per subagent"
              >
                📥 Batch nuovi eventi (30)
              </button>
              <button
                onClick={() => openSubagentBatch('sentinels', 50)}
                disabled={busy}
                style={{
                  padding: '6px 14px',
                  background: '#8b5cf6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
                title="Scarica 50 sentinel entro 7 giorni per subagent"
              >
                📥 Batch sentinel 7d (50)
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--admin-border)', marginBottom: 16 }}>
        {tabs.map((t) => (
          <div key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={0}
            style={{
              padding: '8px 16px',
              borderBottom: tab === t.id ? '2px solid #8b5cf6' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: tab === t.id ? 600 : 400,
            }}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTab(t.id); } }}
          >{t.label}</div>
        ))}
      </div>

      {tab === 'stats' && (
        <AdminTable>
          <AdminThead>
            <AdminTh><GlossaryTerm term="match_stage">Stage</GlossaryTerm></AdminTh>
            <AdminTh align="right">Count</AdminTh>
            <AdminTh align="right"><GlossaryTerm term="confidence">Avg conf</GlossaryTerm></AdminTh>
            <AdminTh align="right"><GlossaryTerm term="canonical_verified">Verified</GlossaryTerm></AdminTh>
          </AdminThead>
          <tbody>
            {statsTableRows.map(([stage, rec]) => (
              <AdminTr key={stage}>
                <AdminTd>{stage}</AdminTd>
                <AdminTd align="right">{rec.count.toLocaleString('it-IT')}</AdminTd>
                <AdminTd align="right">{(rec.avg_conf * 100).toFixed(1)}%</AdminTd>
                <AdminTd align="right">{rec.verified.toLocaleString('it-IT')}</AdminTd>
              </AdminTr>
            ))}
            {statsTableRows.length === 0 && (
              <AdminEmptyRow colSpan={4}>Nessuno stage registrato.</AdminEmptyRow>
            )}
          </tbody>
        </AdminTable>
      )}

      {tab === 'unmapped' && (
        <AdminTable>
          <AdminThead>
            <AdminTh>Evento</AdminTh>
            <AdminTh>Sport</AdminTh>
            <AdminTh>Inizio</AdminTh>
            <AdminTh>Source</AdminTh>
            <AdminTh align="center">Azione</AdminTh>
          </AdminThead>
          <tbody>
            {rows.map((r) => (
              <AdminTr key={r.id}>
                <AdminTd>{r.home_team} vs {r.away_team}</AdminTd>
                <AdminTd>{r.sports?.name}</AdminTd>
                <AdminTd>{r.starts_at?.replace('T', ' ').substring(0, 16)}</AdminTd>
                <AdminTd>{r.source}</AdminTd>
                <AdminTd align="center">
                  <button onClick={() => openAssign(r)}
                    style={{ padding: '4px 10px', background: '#0ea5e9', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>
                    Assegna
                  </button>
                </AdminTd>
              </AdminTr>
            ))}
            {rows.length === 0 && !busy && (
              <AdminEmptyRow colSpan={5}>Nessun evento non mappato.</AdminEmptyRow>
            )}
          </tbody>
        </AdminTable>
      )}

      {(tab === 'llm_pending' || tab === 'low_confidence' || tab === 'verified') && (
        <>
          {/* Mig 119 sub-filters: LLM tab → verify_false vs low_conf; Verificati tab → auto vs manual. */}
          {tab === 'llm_pending' && (
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center',
              padding: '6px 10px', marginBottom: 8,
              background: 'var(--admin-surface)', border: '1px solid var(--admin-border)', borderRadius: 6,
              fontSize: 11,
            }}>
              <span style={{ color: 'var(--admin-text-muted)', marginRight: 4 }}>Filtro LLM:</span>
              {([
                { id: 'all',          label: 'Tutti',                hint: 'verify=false oppure conf<0.95' },
                { id: 'verify_false', label: '⚠️ verify=false',      hint: 'LLM ha rilevato ambiguità' },
                { id: 'low_conf',     label: '📉 conf<0.95',         hint: 'sotto soglia auto-apply LLM' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setLlmFilter(opt.id)}
                  title={opt.hint}
                  style={{
                    padding: '3px 10px',
                    background: llmFilter === opt.id ? '#8b5cf6' : 'transparent',
                    color: llmFilter === opt.id ? '#fff' : 'var(--admin-text)',
                    border: '1px solid ' + (llmFilter === opt.id ? '#8b5cf6' : 'var(--admin-border)'),
                    borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    fontWeight: llmFilter === opt.id ? 700 : 400,
                  }}
                >{opt.label}</button>
              ))}
            </div>
          )}
          {tab === 'verified' && (
            <div style={{
              display: 'flex', gap: 6, alignItems: 'center',
              padding: '6px 10px', marginBottom: 8,
              background: 'var(--admin-surface)', border: '1px solid var(--admin-border)', borderRadius: 6,
              fontSize: 11,
            }}>
              <span style={{ color: 'var(--admin-text-muted)', marginRight: 4 }}>Sorgente verifica:</span>
              {([
                { id: 'all',    label: 'Tutti',     hint: 'auto + manual' },
                { id: 'auto',   label: '🤖 Auto',   hint: 'verified_by IS NULL — engine + cron retroattivo' },
                { id: 'manual', label: '👤 Manual', hint: 'verified_by IS NOT NULL — operatore ha cliccato' },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setVerifiedByFilter(opt.id)}
                  title={opt.hint}
                  style={{
                    padding: '3px 10px',
                    background: verifiedByFilter === opt.id ? '#10b981' : 'transparent',
                    color: verifiedByFilter === opt.id ? '#fff' : 'var(--admin-text)',
                    border: '1px solid ' + (verifiedByFilter === opt.id ? '#10b981' : 'var(--admin-border)'),
                    borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    fontWeight: verifiedByFilter === opt.id ? 700 : 400,
                  }}
                >{opt.label}</button>
              ))}
            </div>
          )}
          {/* Bulk toolbar (review #4 P2-H — autopilot review queue). */}
          {tab !== 'verified' && rows.length > 0 && (
            <div style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 12px',
              marginBottom: 8,
              background: selectedIds.size > 0 ? 'rgba(139,92,246,0.08)' : 'transparent',
              border: selectedIds.size > 0 ? '1px solid #8b5cf644' : '1px dashed var(--admin-border)',
              borderRadius: 6,
              fontSize: 12,
            }}>
              <span style={{ color: 'var(--admin-text-muted)' }}>
                {selectedIds.size === 0
                  ? `${rows.length} righe — seleziona per azione bulk`
                  : `${selectedIds.size} selezionati`}
              </span>
              <button
                onClick={selectAllVisible}
                disabled={busy || rows.length === 0}
                style={{ padding: '3px 10px', background: 'transparent', border: '1px solid var(--admin-border)', color: 'var(--admin-text-muted)', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
              >
                Seleziona tutti
              </button>
              {selectedIds.size > 0 && (
                <>
                  <button
                    onClick={clearSelection}
                    disabled={busy}
                    style={{ padding: '3px 10px', background: 'transparent', border: '1px solid var(--admin-border)', color: 'var(--admin-text-muted)', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
                  >
                    Deseleziona
                  </button>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={bulkVerify}
                    disabled={busy}
                    style={{ padding: '4px 12px', background: '#10b981', color: '#fff', border: 0, borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
                  >
                    ✅ Verifica selezionati ({selectedIds.size})
                  </button>
                  <button
                    onClick={bulkReject}
                    disabled={busy}
                    style={{ padding: '4px 12px', background: '#ef4444', color: '#fff', border: 0, borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
                  >
                    ❌ Rifiuta selezionati ({selectedIds.size})
                  </button>
                </>
              )}
            </div>
          )}
          <AdminTable>
            <AdminThead>
              {tab !== 'verified' && (
                <AdminTh align="center">
                  <input
                    type="checkbox"
                    aria-label="Seleziona tutti"
                    checked={rows.length > 0 && selectedIds.size === rows.length}
                    onChange={(e) => e.target.checked ? selectAllVisible() : clearSelection()}
                  />
                </AdminTh>
              )}
              <AdminTh align="center">
                <span title="Trust signal: 👤 manual · 🤖 auto · ⏳ pending review · ⚠️ low conf · ❌ unmapped">Trust</span>
              </AdminTh>
              <AdminTh>Evento</AdminTh>
              <AdminTh>Sport</AdminTh>
              <AdminTh><GlossaryTerm term="match_stage">Stage</GlossaryTerm></AdminTh>
              <AdminTh align="right"><GlossaryTerm term="confidence">Conf</GlossaryTerm></AdminTh>
              {tab === 'llm_pending' && (
                <AdminTh align="center">
                  <span title="LLM self-verify gate (mig 119)">LLM verify</span>
                </AdminTh>
              )}
              <AdminTh><GlossaryTerm term="flashscore_id">Flashscore ID</GlossaryTerm></AdminTh>
              <AdminTh>Reason</AdminTh>
              <AdminTh align="center">Azioni</AdminTh>
            </AdminThead>
            <tbody>
              {rows.map((r) => {
                const isSelected = selectedIds.has(r.id);
                const isArmed = rejectArmedId === r.id;
                return (
                  <AdminTr key={r.id} style={isSelected ? { background: 'rgba(139,92,246,0.06)' } : undefined}>
                    {tab !== 'verified' && (
                      <AdminTd align="center">
                        <input
                          type="checkbox"
                          aria-label={`Seleziona mapping ${r.id}`}
                          checked={isSelected}
                          onChange={() => toggleSelect(r.id)}
                        />
                      </AdminTd>
                    )}
                    <AdminTd align="center" style={{ fontSize: 16 }}>
                      <span title={trustTooltip(r)}>{trustIcon(r)}</span>
                    </AdminTd>
                    <AdminTd>{r.events?.home_team} vs {r.events?.away_team}</AdminTd>
                    <AdminTd>{r.events?.sports?.name}</AdminTd>
                    <AdminTd>{r.match_stage}</AdminTd>
                    <AdminTd align="right">{(r.confidence * 100).toFixed(0)}%</AdminTd>
                    {tab === 'llm_pending' && (
                      <AdminTd align="center">
                        <span title={r.llm_verify === true ? 'LLM declared verify=true' : r.llm_verify === false ? 'LLM declared verify=false (ambiguity flagged)' : 'verify field missing (legacy LLM output)'}>
                          {r.llm_verify === true ? '✓' : r.llm_verify === false ? '✗' : '—'}
                        </span>
                      </AdminTd>
                    )}
                    <AdminTd style={{ fontFamily: 'monospace' }}>{r.flashscore_id}</AdminTd>
                    <AdminTd>{r.llm_reason ?? '—'}</AdminTd>
                    <AdminTd align="center">
                      {!r.verified && !isArmed && (
                        <>
                          <button onClick={() => verify(r.id)}
                            aria-label="Conferma mapping"
                            title="Conferma mapping"
                            style={{ padding: '4px 10px', marginRight: 4, background: '#10b981', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>✅</button>
                          <button onClick={() => setRejectArmedId(r.id)}
                            aria-label="Rifiuta mapping ed elimina"
                            title="Rifiuta mapping ed elimina (richiede conferma)"
                            style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>❌</button>
                        </>
                      )}
                      {!r.verified && isArmed && (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: '#fca5a5' }}>Confermi?</span>
                          <button onClick={() => reject(r.id, r.event_id)}
                            style={{ padding: '3px 8px', background: '#ef4444', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Sì</button>
                          <button onClick={() => setRejectArmedId(null)}
                            style={{ padding: '3px 8px', background: 'transparent', color: 'var(--admin-text-muted)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>No</button>
                        </span>
                      )}
                      {r.verified && <span style={{ color: '#10b981' }}>verificato</span>}
                    </AdminTd>
                  </AdminTr>
                );
              })}
              {rows.length === 0 && !busy && (
                <AdminEmptyRow colSpan={tab !== 'verified' ? 8 : 7}>Nessun risultato.</AdminEmptyRow>
              )}
            </tbody>
          </AdminTable>
        </>
      )}

      {/* Mig 121 — Team aliases tab. Fetches separately from event-normalization
          rows because the data source is /api/admin/team-aliases. */}
      {tab === 'team_aliases' && (
        <TeamAliasesPanel sport={sport} />
      )}

      {assignTarget && (
        <ManualAssignModal
          event={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => {
            setRows((prev) => prev.filter((x) => x.id !== assignTarget.id));
            setAssignTarget(null);
            void loadStats();
            void loadRunsStatus();
          }}
        />
      )}
    </div>
  );
}

function AutomationCard({
  title, subtitle, status,
}: {
  title: string;
  subtitle: string;
  status: RunSummary | undefined;
}) {
  const sev = status?.severity ?? 'never';
  const color = SEVERITY_COLOR[sev];
  const last = status?.last;
  return (
    <div
      style={{
        padding: 10,
        border: '1px solid var(--admin-border)',
        borderRadius: 8,
        background: 'var(--admin-bg)',
        borderLeft: `3px solid ${color}`,
      }}
      role="status"
      aria-label={`${title}: ${SEVERITY_LABEL[sev]}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        <span style={{
          padding: '2px 8px',
          borderRadius: 999,
          background: `${color}22`,
          color,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}>{SEVERITY_LABEL[sev]}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginBottom: 6 }}>{subtitle}</div>
      {last ? (
        <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div>
            <span style={{ color: 'var(--admin-text-muted)' }}>Ultimo run: </span>
            <span style={{ color }}>{formatAge(status?.age_minutes ?? null)}</span>
            <span style={{ color: 'var(--admin-text-muted)' }}> · {last.source}</span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--admin-text-muted)' }}>
            processati={last.processed} · matched={last.matched} · llm={last.llm_used} · {last.duration_ms}ms
          </div>
          {last.error && (
            <div style={{ color: '#ef4444', fontSize: 10 }}>⚠ {last.error}</div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
          Nessun run registrato ancora.
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Mig 121 — Team aliases panel (LLM proposals + operator dictionary)
// ───────────────────────────────────────────────────────────────────

interface TeamAliasRow {
  id: number;
  alias: string;
  canonical: string;
  sport: string | null;
  source: string | null;
  verified: boolean;
  created_at: string;
  llm_reason: string | null;
  proposed_for_event_id: string | null;
}

function TeamAliasesPanel({ sport }: { sport: string }) {
  const [filter, setFilter] = useState<'pending' | 'verified' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<TeamAliasRow[]>([]);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [newAlias, setNewAlias] = useState('');
  const [newCanonical, setNewCanonical] = useState('');
  const [newSport, setNewSport] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (filter === 'pending') params.set('verified', 'false');
      if (filter === 'verified') params.set('verified', 'true');
      if (sport) params.set('sport', sport.toLowerCase());
      if (search) params.set('q', search);
      params.set('limit', '200');
      const r = await fetch('/api/admin/team-aliases?' + params.toString());
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setRows(d.rows ?? []);
      setPending(d.pending ?? 0);
      setSelectedIds(new Set());
    } catch (e: any) {
      setMessage(`Errore: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [filter, sport, search]);

  useEffect(() => { void load(); }, [load]);

  async function act(action: string, payload: any) {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/team-aliases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setMessage(`✓ ${action} ok`);
      void load();
    } catch (e: any) {
      setMessage(`Errore ${action}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setSelectedIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header summary */}
      <div style={{
        padding: 10, border: '1px solid var(--admin-border)', borderRadius: 8,
        background: 'var(--admin-card)', display: 'flex', gap: 12, alignItems: 'baseline',
        flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--admin-text-muted)' }}>
          🏷 Team aliases dictionary
        </div>
        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
          Aliasing variants in mente del LLM e dell'operatore. LLM propone, operatore approva/rigetta.
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: pending > 0 ? '#f59e0b' : 'var(--admin-text-muted)' }}>
          <strong>{pending}</strong> in attesa di review
        </div>
      </div>

      {/* Create new (operator-curated, verified=true) */}
      <div style={{
        padding: 10, border: '1px dashed var(--admin-border)', borderRadius: 8,
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11,
      }}>
        <span style={{ color: 'var(--admin-text-muted)' }}>Aggiungi alias manuale:</span>
        <input
          value={newAlias} onChange={(e) => setNewAlias(e.target.value)}
          placeholder="alias (es. psg)"
          style={{ padding: '4px 8px', fontSize: 11, background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, color: 'var(--admin-text)', width: 160 }}
        />
        <span style={{ color: 'var(--admin-text-muted)' }}>→</span>
        <input
          value={newCanonical} onChange={(e) => setNewCanonical(e.target.value)}
          placeholder="canonical (es. paris saint-germain)"
          style={{ padding: '4px 8px', fontSize: 11, background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, color: 'var(--admin-text)', width: 220 }}
        />
        <input
          value={newSport} onChange={(e) => setNewSport(e.target.value)}
          placeholder="sport (es. football)"
          style={{ padding: '4px 8px', fontSize: 11, background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, color: 'var(--admin-text)', width: 140 }}
        />
        <button
          onClick={async () => {
            if (!newAlias.trim() || !newCanonical.trim()) return;
            await act('create', { alias: newAlias, canonical: newCanonical, sport: newSport || null });
            setNewAlias(''); setNewCanonical('');
          }}
          disabled={busy || !newAlias.trim() || !newCanonical.trim()}
          style={{
            padding: '4px 12px', fontSize: 11, background: '#10b981', color: '#fff', border: 0,
            borderRadius: 4, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
          }}
        >
          + Aggiungi
        </button>
      </div>

      {/* Filters + bulk */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['pending', 'verified', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: filter === f ? '#8b5cf6' : 'transparent',
              color: filter === f ? '#fff' : 'var(--admin-text)',
              border: '1px solid ' + (filter === f ? '#8b5cf6' : 'var(--admin-border)'),
              borderRadius: 4, cursor: 'pointer',
              fontWeight: filter === f ? 700 : 400,
            }}
          >
            {f === 'pending' ? `⏳ Pending (${pending})` : f === 'verified' ? '✅ Verificati' : 'Tutti'}
          </button>
        ))}
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="cerca alias o canonical…"
          style={{ marginLeft: 8, padding: '4px 8px', fontSize: 11, background: 'var(--admin-bg)', border: '1px solid var(--admin-border)', borderRadius: 4, color: 'var(--admin-text)', width: 220 }}
        />
        {selectedIds.size > 0 && (
          <>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => act('bulk-verify', { ids: Array.from(selectedIds) })}
              disabled={busy}
              style={{ padding: '4px 12px', fontSize: 11, background: '#10b981', color: '#fff', border: 0, borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
            >
              ✅ Approva {selectedIds.size}
            </button>
            <button
              onClick={() => act('bulk-reject', { ids: Array.from(selectedIds) })}
              disabled={busy}
              style={{ padding: '4px 12px', fontSize: 11, background: '#ef4444', color: '#fff', border: 0, borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
            >
              ❌ Rifiuta {selectedIds.size}
            </button>
          </>
        )}
      </div>

      {message && (
        <div style={{ padding: 8, background: 'var(--admin-surface)', borderRadius: 4, fontSize: 11, color: 'var(--admin-text)' }}>
          {message}
        </div>
      )}

      <AdminTable>
        <AdminThead>
          <AdminTh align="center">
            <input
              type="checkbox"
              checked={rows.length > 0 && selectedIds.size === rows.length}
              onChange={(e) => setSelectedIds(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
            />
          </AdminTh>
          <AdminTh>Alias</AdminTh>
          <AdminTh>→ Canonical</AdminTh>
          <AdminTh>Sport</AdminTh>
          <AdminTh>Source</AdminTh>
          <AdminTh>Stato</AdminTh>
          <AdminTh>LLM reason</AdminTh>
          <AdminTh align="center">Azioni</AdminTh>
        </AdminThead>
        <tbody>
          {rows.map((r) => (
            <AdminTr key={r.id} style={selectedIds.has(r.id) ? { background: 'rgba(139,92,246,0.06)' } : undefined}>
              <AdminTd align="center">
                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggle(r.id)} />
              </AdminTd>
              <AdminTd style={{ fontFamily: 'monospace' }}>{r.alias}</AdminTd>
              <AdminTd style={{ fontFamily: 'monospace' }}>{r.canonical}</AdminTd>
              <AdminTd>{r.sport ?? '—'}</AdminTd>
              <AdminTd>
                <span style={{
                  padding: '2px 6px', fontSize: 10, fontWeight: 700, borderRadius: 3,
                  background: r.source === 'llm' ? '#8b5cf622' : r.source === 'operator' ? '#10b98122' : 'var(--admin-surface)',
                  color: r.source === 'llm' ? '#8b5cf6' : r.source === 'operator' ? '#10b981' : 'var(--admin-text-muted)',
                }}>{r.source ?? 'seed'}</span>
              </AdminTd>
              <AdminTd>
                {r.verified
                  ? <span style={{ color: '#10b981' }}>✅ verificato</span>
                  : <span style={{ color: '#f59e0b' }}>⏳ pending</span>}
              </AdminTd>
              <AdminTd style={{ fontSize: 11, maxWidth: 320, color: 'var(--admin-text-muted)' }}>
                {r.llm_reason ?? '—'}
              </AdminTd>
              <AdminTd align="center">
                {!r.verified && (
                  <>
                    <button onClick={() => act('verify', { id: r.id })} disabled={busy}
                      title="Approva alias"
                      style={{ padding: '4px 10px', marginRight: 4, background: '#10b981', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>✅</button>
                    <button onClick={() => act('reject', { id: r.id })} disabled={busy}
                      title="Rifiuta ed elimina"
                      style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer' }}>❌</button>
                  </>
                )}
                {r.verified && (
                  <button onClick={() => act('reject', { id: r.id })} disabled={busy}
                    title="Rimuovi alias verificato"
                    style={{ padding: '4px 10px', background: 'transparent', color: 'var(--admin-text-muted)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>🗑</button>
                )}
              </AdminTd>
            </AdminTr>
          ))}
          {rows.length === 0 && !busy && (
            <AdminEmptyRow colSpan={8}>Nessun alias.</AdminEmptyRow>
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
