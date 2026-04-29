"use client";

// 2026-04-25 review #2 hardening:
//  - canonical filter from URL (drill from canonical-markets) — Bug C
//  - Save uses server-returned row instead of guessing extracted_by/conf — Bug B
//  - notes editable inline — UX H
//  - shared Pagination primitive — UX I
//  - canonical_key validation hint vs canonical_keys list — UX K
//  - link to Market Catalog for source dictionary rows — UX M
//  - bulk-clear + bulk-assign buttons — spec L
//  - lang filter scope hint — UX G
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CanonicalMarketDetailModal } from "@/components/admin/canonical/canonical-market-detail-modal";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";
import {
  NormalizationKpiCard,
  NormalizationKpiRow,
  SourceBadge,
  StatusPill,
  ConfBadge,
  ExtractedByBadge,
  EngineRunBar,
} from "@/components/admin/normalization/primitives";
import { GlossaryTerm, Pagination } from "@/components/admin/ui";

interface Row {
  source: "flashscore" | "odds-api";
  source_market_type: string;
  event_count: number;
  market_count: number;
  canonical_key: string | null;
  canonical_line: number | null;
  canonical_name_it: string | null;
  verified: boolean;
  extracted_by: string | null;
  confidence: number | null;
  notes: string | null;
  last_mapped_at: string | null;
  is_italian: boolean;
}
interface Kpis {
  total_volume: number;
  mapped_volume: number;
  unmapped_volume: number;
  verified_volume: number;
  coverage_pct: number;
  total: number;
  mapped: number;
  unmapped: number;
  verified: number;
}
interface CanonicalKey { canonical_key: string; canonical_name_it: string; count: number; }
interface EngineSummary { processed: number; matched: { regex: number; dictionary: number; propagation: number }; unmatched: number; remaining: number; took_ms: number; }

const SOURCE_OPTS = [
  { value: "all",        label: "Tutti" },
  { value: "flashscore", label: "Flashscore" },
  { value: "odds-api",   label: "Odds-API" },
];

const CONF_OPTS = [
  { value: "all",  label: "Tutte" },
  { value: "high", label: "Alta (>85)" },
  { value: "med",  label: "Media (50-85)" },
  { value: "low",  label: "Bassa (<50)" },
];

const EXTRACTED_BY_OPTS = [
  { value: "",            label: "Tutti" },
  { value: "regex",       label: "Regex (rx)" },
  { value: "dictionary",  label: "Dictionary (dc)" },
  { value: "propagation", label: "Cross-source (xs)" },
  { value: "manual",      label: "Manuale" },
];

const LANG_OPTS = [
  { value: "",   label: "Tutte" },
  { value: "it", label: "IT" },
  { value: "en", label: "EN" },
];

export default function MarketNormalizationPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "var(--admin-text-muted)" }}>Caricamento…</div>}>
      <MarketNormalizationContent />
    </Suspense>
  );
}

function MarketNormalizationContent() {
  const { filters, updateFilter, setFilters } = useAdminFilters({
    source: "all" as "all" | "flashscore" | "odds-api",
    q: "",
    only_unmapped: false as boolean,
    only_unverified: false as boolean,
    conf: "all",
    extracted_by: "",
    lang: "",
    canonical: "", // Bug C — drill from canonical-markets persists in URL
    page: 1,
  });
  const source         = filters.source;
  const q              = filters.q as string;
  const onlyUnmapped   = filters.only_unmapped as boolean;
  const onlyUnverified = filters.only_unverified as boolean;
  const confBucket     = filters.conf as string;
  const extractedBy    = filters.extracted_by as string;
  const lang           = filters.lang as string;
  const canonicalFilter = filters.canonical as string;
  const page           = Number(filters.page) || 1;
  const setSource         = (v: "all" | "flashscore" | "odds-api") => setFilters({ source: v, page: 1 });
  const setQ              = (v: string)  => setFilters({ q: v, page: 1 });
  const setOnlyUnmapped   = (v: boolean) => setFilters({ only_unmapped: v, page: 1 });
  const setOnlyUnverified = (v: boolean) => setFilters({ only_unverified: v, page: 1 });
  const setConfBucket     = (v: string)  => setFilters({ conf: v, page: 1 });
  const setExtractedBy    = (v: string)  => setFilters({ extracted_by: v, page: 1 });
  const setLang           = (v: string)  => setFilters({ lang: v, page: 1 });
  const clearCanonicalFilter = ()        => setFilters({ canonical: "", page: 1 });
  const setPage           = (v: number)  => updateFilter("page", v);

  const [rows, setRows]               = useState<Row[]>([]);
  const [kpis, setKpis]               = useState<Kpis | null>(null);
  const [keys, setKeys]               = useState<CanonicalKey[]>([]);
  const [perPage]                     = useState(100);
  const [totalRows, setTotalRows]     = useState(0);
  const [langFilteredInPage, setLangFilteredInPage] = useState<number | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [savingRow, setSavingRow]     = useState<string | null>(null);
  const [editing, setEditing]         = useState<Record<string, Partial<Row>>>({});
  const [selected, setSelected]       = useState<Set<string>>(new Set()); // keys = "source:market_type"
  const [running, setRunning]         = useState(false);
  const [lastSummary, setLastSummary] = useState<EngineSummary | null>(null);
  const [modalKey, setModalKey]       = useState<string | null>(null);
  const [bulkAssignKey, setBulkAssignKey] = useState<string>("");
  const [bulkBusy, setBulkBusy]       = useState(false);

  const rowKey = (r: { source: string; source_market_type: string }) => `${r.source}:${r.source_market_type}`;

  // Quick lookup of canonical_keys → name (for inline validation hint).
  const knownKeys = useMemo(() => new Set(keys.map((k) => k.canonical_key)), [keys]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        action: "list", source: String(source),
        page: String(page), per_page: String(perPage),
        conf: confBucket,
      });
      if (q)              params.set("q", q);
      if (onlyUnmapped)   params.set("only_unmapped", "1");
      if (onlyUnverified) params.set("only_unverified", "1");
      if (extractedBy)    params.set("extracted_by", extractedBy);
      if (lang)           params.set("lang", lang);
      if (canonicalFilter) params.set("canonical_key", canonicalFilter);

      const [listRes, keysRes] = await Promise.all([
        fetch(`/api/admin/market-normalization?${params}`).then((r) => r.json()),
        fetch(`/api/admin/market-normalization?action=canonical-keys&source=all`).then((r) => r.json()),
      ]);

      if (listRes.error) throw new Error(listRes.error);
      setRows(listRes.rows ?? []);
      setKpis(listRes.kpis ?? null);
      setTotalRows(listRes.total_rows ?? 0);
      setLangFilteredInPage(listRes.lang_filtered_in_page ?? null);
      setKeys(keysRes.keys ?? []);
      setEditing({});
      setSelected(new Set());
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [source, q, onlyUnmapped, onlyUnverified, confBucket, extractedBy, lang, canonicalFilter, page, perPage]);

  useEffect(() => { load(); }, [load]);

  const save = async (row: Row) => {
    const edit = editing[rowKey(row)] ?? {};
    const body = {
      source: row.source,
      source_market_type: row.source_market_type,
      canonical_key:     edit.canonical_key     ?? row.canonical_key,
      canonical_name_it: edit.canonical_name_it ?? row.canonical_name_it,
      canonical_line:    edit.canonical_line    ?? row.canonical_line,
      verified:          edit.verified          ?? row.verified,
      notes:             edit.notes             ?? row.notes,
    };
    setSavingRow(rowKey(row));
    try {
      const r = await fetch(`/api/admin/market-normalization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      // Bug B: use server response to overwrite local state, not guesses.
      const saved = r.row || {};
      setRows((prev) => prev.map((x) => rowKey(x) === rowKey(row)
        ? ({
            ...x,
            canonical_key:     saved.canonical_key     ?? x.canonical_key,
            canonical_name_it: saved.canonical_name_it ?? x.canonical_name_it,
            canonical_line:    saved.canonical_line    ?? x.canonical_line,
            verified:          saved.verified          ?? x.verified,
            notes:             saved.notes             ?? x.notes,
            extracted_by:      saved.extracted_by      ?? x.extracted_by,
            confidence:        saved.confidence        ?? x.confidence,
            last_mapped_at:    saved.updated_at        ?? x.last_mapped_at,
          } as Row)
        : x));
      setEditing((prev) => { const cp = { ...prev }; delete cp[rowKey(row)]; return cp; });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingRow(null);
    }
  };

  const clearMapping = async (row: Row) => {
    if (!confirm(`Rimuovere mappatura per "${row.source_market_type}" (${row.source})?`)) return;
    setSavingRow(rowKey(row));
    try {
      const params = new URLSearchParams({ source: row.source, source_market_type: row.source_market_type });
      const r = await fetch(`/api/admin/market-normalization?${params}`, { method: "DELETE" }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setSavingRow(null); }
  };

  const bulkAction = async (action: "bulk-confirm" | "bulk-clear" | "bulk-assign", extras: any = {}) => {
    if (selected.size === 0) return;
    if (action === "bulk-clear" && !confirm(`Rimuovere mapping da ${selected.size} righe selezionate?`)) return;
    const items = Array.from(selected).map((k) => {
      const [src, ...rest] = k.split(":");
      return { source: src, source_market_type: rest.join(":") };
    });
    setBulkBusy(true);
    try {
      const r = await fetch(`/api/admin/market-normalization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, items, ...extras }),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkConfirm = () => bulkAction("bulk-confirm");
  const bulkClear   = () => bulkAction("bulk-clear");
  const bulkAssign  = async () => {
    const ck = bulkAssignKey.trim();
    if (!ck) { setError("Inserisci canonical_key per bulk-assign"); return; }
    if (!knownKeys.has(ck)) {
      if (!confirm(`canonical_key "${ck}" non è nel catalogo canonical_markets — assegnare comunque?`)) return;
    }
    await bulkAction("bulk-assign", { canonical_key: ck });
    setBulkAssignKey("");
  };

  const runEngine = async () => {
    setRunning(true); setLastSummary(null);
    try {
      const r = await fetch(`/api/admin/market-normalization?action=run-engine&chunk=500`).then((r) => r.json());
      setLastSummary(r);
      await load();
    } catch (err: any) { setError(err.message); }
    finally { setRunning(false); }
  };

  const update = (key: string, patch: Partial<Row>) => setEditing((prev) => ({ ...prev, [key]: { ...(prev[key] ?? {}), ...patch } }));
  const isDirty = (key: string) => !!editing[key] && Object.keys(editing[key]!).length > 0;
  const toggleSelect = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectableRows = rows; // any row can be in bulk ops (clear/assign/confirm handle missing-canonical fine)
  const toggleSelectAll = () => {
    if (selected.size === selectableRows.length) setSelected(new Set());
    else setSelected(new Set(selectableRows.map(rowKey)));
  };

  const totalPages = Math.max(1, Math.ceil(totalRows / perPage));
  const canonicalName = canonicalFilter
    ? (keys.find((k) => k.canonical_key === canonicalFilter)?.canonical_name_it || canonicalFilter)
    : "";

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI row (volume-based; sub-text shows distinct market_type count) */}
      <NormalizationKpiRow>
        <NormalizationKpiCard label="Mercati attivi"       value={kpis?.total_volume?.toLocaleString("it-IT") ?? "—"} accent="#334155" sub={`${kpis?.total?.toLocaleString("it-IT") ?? 0} tipi distinti`} />
        <NormalizationKpiCard label="Mappati (auto+manual)" value={`${kpis?.mapped_volume?.toLocaleString("it-IT") ?? 0} / ${kpis?.total_volume?.toLocaleString("it-IT") ?? 0}`} accent="#3b82f6" sub={`${kpis?.coverage_pct ?? 0}% · ${kpis?.mapped ?? 0} tipi`} />
        <NormalizationKpiCard label={<GlossaryTerm term="canonical_verified">Verificati</GlossaryTerm>} value={kpis?.verified_volume?.toLocaleString("it-IT") ?? "—"} accent="#10b981" sub={`${kpis?.verified ?? 0} tipi`} />
        <NormalizationKpiCard label="Da mappare"           value={kpis?.unmapped_volume?.toLocaleString("it-IT") ?? "—"} accent={kpis && kpis.unmapped_volume > 0 ? "#ef4444" : "#64748b"} sub={`${kpis?.unmapped ?? 0} tipi`} />
      </NormalizationKpiRow>

      {/* Active drill banner */}
      {canonicalFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "rgba(139,92,246,0.12)", border: "1px solid #8b5cf6", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "var(--admin-text)" }}>
            Filtro canonical: <code style={{ color: "#8b5cf6", fontWeight: 700 }}>{canonicalFilter}</code> {canonicalName && canonicalName !== canonicalFilter && <span style={{ color: "var(--admin-text-muted)" }}> · {canonicalName}</span>}
          </span>
          <button onClick={() => setModalKey(canonicalFilter)} style={{ ...btnStyle("transparent"), color: "#8b5cf6", border: "1px solid #8b5cf6" }}>Apri scheda</button>
          <button onClick={clearCanonicalFilter} style={btnStyle("#334155")}>✕ Rimuovi filtro</button>
        </div>
      )}

      {/* Controls — source as dropdown filter, unified table */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, border: "1px solid var(--admin-border)", borderRadius: 10, background: "var(--admin-card)", flexWrap: "wrap" }}>
        <select value={source as string} onChange={(e) => setSource(e.target.value as any)} style={selectStyle}>
          {SOURCE_OPTS.map((o) => <option key={o.value} value={o.value}>Source: {o.label}</option>)}
        </select>
        <input placeholder="Cerca market / canonical..." value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 13 }} />
        <select value={confBucket} onChange={(e) => setConfBucket(e.target.value)} style={selectStyle}>
          {CONF_OPTS.map((o) => <option key={o.value} value={o.value}>Conf: {o.label}</option>)}
        </select>
        <select value={extractedBy} onChange={(e) => setExtractedBy(e.target.value)} style={selectStyle}>
          {EXTRACTED_BY_OPTS.map((o) => <option key={o.value} value={o.value}>By: {o.label}</option>)}
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value)} style={selectStyle}>
          {LANG_OPTS.map((o) => <option key={o.value} value={o.value}>Lingua: {o.label}</option>)}
        </select>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={onlyUnmapped}   onChange={(e) => setOnlyUnmapped(e.target.checked)} /> Solo non-mappati
        </label>
        <label style={checkLabelStyle}>
          <input type="checkbox" checked={onlyUnverified} onChange={(e) => setOnlyUnverified(e.target.checked)} /> Solo non-verificati
        </label>
        <button onClick={load} disabled={loading} style={btnStyle("#334155")}>{loading ? "…" : "Ricarica"}</button>
      </div>

      {/* Lang scope hint (UX G) */}
      {lang && langFilteredInPage != null && (
        <div style={{ padding: "6px 10px", background: "rgba(234,179,8,0.10)", border: "1px solid #eab308", borderRadius: 6, fontSize: 11, color: "#eab308" }}>
          ⚠ Filtro Lingua è applicato dopo la paginazione: {langFilteredInPage} righe {lang.toUpperCase()} su {perPage} caricate dalla pagina corrente. KPI in alto restano globali. Per uno sweep esaustivo per lingua, usa Cerca con keyword IT/EN.
        </div>
      )}

      <EngineRunBar
        running={running}
        onRun={runEngine}
        summary={lastSummary}
        renderSummary={(s: EngineSummary) => (
          <span>
            Engine: processed={s.processed}, regex={s.matched.regex}, dict={s.matched.dictionary}, prop={s.matched.propagation}, unmatched={s.unmatched}, remaining={s.remaining} ({s.took_ms}ms)
          </span>
        )}
      />

      {/* Bulk bar (UX L) */}
      {selected.size > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", background: "rgba(16,185,129,0.08)", border: "1px solid #10b981", borderRadius: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: "#10b981" }}>{selected.size} selezionati</span>
          <button onClick={bulkConfirm} disabled={bulkBusy} style={btnStyle("#10b981")}>✓ Conferma (verified=true)</button>
          <button onClick={bulkClear}   disabled={bulkBusy} style={btnStyle("#ef4444")}>✕ Clear mapping</button>
          <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)" }} />
          <input
            list="canonical-keys"
            value={bulkAssignKey}
            onChange={(e) => setBulkAssignKey(e.target.value)}
            placeholder="canonical_key per assign…"
            style={{ ...inputStyle, width: 220 }}
          />
          <button onClick={bulkAssign} disabled={bulkBusy || !bulkAssignKey.trim()} style={btnStyle("#3b82f6")}>→ Assegna canonical</button>
          <button onClick={() => setSelected(new Set())} disabled={bulkBusy} style={btnStyle("#334155")}>Annulla</button>
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Chiudi avviso errore" style={{ background: "transparent", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Unified table with source column */}
      <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
              <Th style={{ width: 32 }}>
                <input type="checkbox" checked={selected.size > 0 && selected.size === selectableRows.length} onChange={toggleSelectAll} />
              </Th>
              <Th align="center" style={{ width: 70 }}>Source</Th>
              <Th>Market type</Th>
              <Th align="center" style={{ width: 60 }}>Lingua</Th>
              <Th align="right" style={{ width: 80 }}>Volume</Th>
              <Th style={{ width: 200 }}>Canonical</Th>
              <Th align="right" style={{ width: 60 }}>Line</Th>
              <Th align="center" style={{ width: 70 }}>Conf</Th>
              <Th align="center" style={{ width: 50 }}>By</Th>
              <Th align="center" style={{ width: 60 }}>✓</Th>
              <Th style={{ width: 200 }}>Notes</Th>
              <Th align="right" style={{ width: 180 }}>Azioni</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = rowKey(r);
              const edit = editing[key] ?? {};
              const ck  = (edit.canonical_key ?? r.canonical_key ?? "") as string;
              const cl  = edit.canonical_line ?? r.canonical_line ?? null;
              const vr  = edit.verified ?? r.verified;
              const nt  = edit.notes ?? r.notes ?? "";
              const dirty = isDirty(key);
              const isSaving = savingRow === key;
              const ckUnknown = ck && !knownKeys.has(ck); // UX K
              return (
                <tr key={key} style={{ borderTop: "1px solid var(--admin-border)", background: dirty ? "rgba(249,115,22,0.04)" : undefined }}>
                  <td style={tdStyle}>
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(key)} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <SourceBadge source={r.source} />
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 500, color: "var(--admin-text)" }}>{r.source_market_type}</span>
                    </div>
                    {r.last_mapped_at && <div style={{ fontSize: 10, color: "var(--admin-text-muted)", marginTop: 2 }}>aggiornato {timeAgo(r.last_mapped_at)}</div>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <StatusPill label={r.is_italian ? "IT" : "EN"} color={r.is_italian ? "#22c55e" : "#ef4444"} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--admin-text-muted)" }}>{r.market_count}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        list="canonical-keys"
                        value={ck}
                        onChange={(e) => update(key, { canonical_key: e.target.value })}
                        placeholder="canonical_key"
                        title={ckUnknown ? `⚠ "${ck}" non è in canonical_markets — typo?` : ""}
                        style={{ ...inputStyle, flex: 1, borderColor: ckUnknown ? "#eab308" : undefined }}
                      />
                      {ck && (
                        <button
                          type="button"
                          onClick={() => setModalKey(ck)}
                          title="Apri scheda canonical"
                          style={{ padding: "4px 8px", background: "transparent", border: "1px solid var(--admin-border)", color: "#8b5cf6", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                        >🔍</button>
                      )}
                    </div>
                    {ckUnknown && (
                      <div style={{ fontSize: 10, color: "#eab308", marginTop: 2 }}>⚠ non in canonical_markets</div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <input type="number" step="0.5" value={cl ?? ""} onChange={(e) => update(key, { canonical_line: e.target.value === "" ? null : parseFloat(e.target.value) })}
                      placeholder="—" style={{ ...inputStyle, textAlign: "right" }} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}><ConfBadge confidence={r.confidence} /></td>
                  <td style={{ ...tdStyle, textAlign: "center" }}><ExtractedByBadge extracted_by={r.extracted_by} /></td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <input type="checkbox" checked={vr} onChange={(e) => update(key, { verified: e.target.checked })} />
                  </td>
                  <td style={tdStyle}>
                    <input
                      value={nt}
                      onChange={(e) => update(key, { notes: e.target.value })}
                      placeholder="—"
                      style={{ ...inputStyle, fontSize: 11 }}
                    />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button onClick={() => save(r)} disabled={!dirty || isSaving} style={{ ...btnStyle(dirty ? "#10b981" : "#334155"), padding: "4px 8px", opacity: dirty ? 1 : 0.5 }}>{isSaving ? "…" : "Salva"}</button>
                      {r.canonical_key && <button onClick={() => clearMapping(r)} disabled={isSaving} aria-label="Rimuovi mapping canonical" style={{ ...btnStyle("#64748b"), padding: "4px 8px" }} title="Rimuovi mapping">✕</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={12} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun market type con i filtri correnti.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Shared pagination primitive (UX I) */}
      <Pagination page={page} totalPages={totalPages} onPage={setPage} totalRows={totalRows} />

      <datalist id="canonical-keys">
        {keys.map((k) => <option key={k.canonical_key} value={k.canonical_key}>{k.canonical_name_it || k.canonical_key} ({k.count})</option>)}
      </datalist>

      {modalKey && (
        <CanonicalMarketDetailModal
          canonicalKey={modalKey}
          mode="view"
          onClose={() => setModalKey(null)}
          onSaved={() => { setModalKey(null); load(); }}
        />
      )}
    </div>
  );
}

// UI primitives
const tdStyle: React.CSSProperties = { padding: "6px 8px", verticalAlign: "middle" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "4px 8px", border: "1px solid var(--admin-border)", borderRadius: 4, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 12 };
const selectStyle: React.CSSProperties = { padding: "6px 10px", border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 12 };
const checkLabelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, color: "var(--admin-text-muted)", fontSize: 12 };

function Th({ children, align = "left", style }: { children: React.ReactNode; align?: "left"|"right"|"center"; style?: React.CSSProperties }) {
  return <th style={{ padding: "8px 10px", textAlign: align, fontSize: 10, textTransform: "uppercase", color: "var(--admin-text-muted)", fontWeight: 700, letterSpacing: 0.5, ...style }}>{children}</th>;
}
function btnStyle(bg: string): React.CSSProperties {
  return { padding: "5px 10px", borderRadius: 5, border: "none", background: bg, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" };
}
function timeAgo(iso: string): string {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return `${Math.floor(diff / 86400)}g fa`;
}
