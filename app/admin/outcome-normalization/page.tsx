"use client";

// 2026-04-25 review #3 hardening:
//  - alert() → error banner (UX B)
//  - brand voice IT (F), live search (G), ConfBadge color (H)
//  - notes inline col (I), updated_at relative (J), source col auto-hide (K)
//  - shared Pagination primitive (D)
//  - bulk-clear + bulk-assign with autocomplete + warn (E)
//  - canonical dropdown shows only in-use canonicals + count (C, mig 113)
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CanonicalMarketDetailModal } from "@/components/admin/canonical/canonical-market-detail-modal";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";
import {
  NormalizationKpiCard,
  NormalizationKpiRow,
  SourceBadge,
  ConfBadge,
  ExtractedByBadge,
  EngineRunBar,
} from "@/components/admin/normalization/primitives";
import { Pagination } from "@/components/admin/ui";

interface Row {
  id: number;
  source: "flashscore" | "odds-api";
  source_market_type: string;
  source_outcome_name: string;
  canonical_key: string | null;
  canonical_outcome_key: string | null;
  extracted_by: string | null;
  confidence: number | null;
  verified: boolean;
  notes: string | null;
  updated_at: string;
}
interface Kpis {
  total: number; mapped: number; unmapped: number;
  verified: number; unverified: number; coverage_pct: number;
}
interface CanonicalMarket { canonical_key: string; canonical_name_it: string; count: number; }

const SOURCES = [
  { value: "all",        label: "Tutti",      color: "#64748b" },
  { value: "flashscore", label: "Flashscore", color: "#8b5cf6" },
  { value: "odds-api",   label: "Odds-API",   color: "#22c55e" },
] as const;

export default function OutcomeNormalizationPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "var(--admin-text-muted)" }}>Caricamento…</div>}>
      <OutcomeNormalizationContent />
    </Suspense>
  );
}

function OutcomeNormalizationContent() {
  const { filters, updateFilter, setFilters } = useAdminFilters({
    source: "all",
    q: "",
    only_unmapped: false as boolean,
    only_unverified: false as boolean,
    canonical: "",
    page: 1,
  });
  const source           = filters.source as string;
  const q                = filters.q as string;
  const onlyUnmapped     = filters.only_unmapped as boolean;
  const onlyUnverified   = filters.only_unverified as boolean;
  const canonicalFilter  = filters.canonical as string;
  const page             = Number(filters.page) || 1;
  const setSource          = (v: string)  => setFilters({ source: v, page: 1 });
  // G: live search (no Enter required) — also reset page on type
  const setQ               = (v: string)  => setFilters({ q: v, page: 1 });
  const setOnlyUnmapped    = (v: boolean) => setFilters({ only_unmapped: v, page: 1 });
  const setOnlyUnverified  = (v: boolean) => setFilters({ only_unverified: v, page: 1 });
  const setCanonicalFilter = (v: string)  => setFilters({ canonical: v, page: 1 });
  const setPage            = (v: number)  => updateFilter("page", v);
  const clearCanonicalFilter = ()         => setFilters({ canonical: "", page: 1 });

  const [rows, setRows]               = useState<Row[]>([]);
  const [kpis, setKpis]               = useState<Kpis | null>(null);
  const [canonicals, setCanonicals]   = useState<CanonicalMarket[]>([]);
  const [perPage]                     = useState(100);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [selected, setSelected]       = useState<Set<number>>(new Set());
  const [editing, setEditing]         = useState<Record<number, Partial<Row>>>({});
  const [savingRow, setSavingRow]     = useState<number | null>(null);
  const [modalKey, setModalKey]       = useState<string | null>(null);
  const [outcomesByCanonical, setOutcomesByCanonical] = useState<Record<string, string[]>>({});
  const [running, setRunning]         = useState(false);
  const [lastSummary, setLastSummary] = useState<any>(null);
  // Bulk-assign UI state
  const [bulkCanonicalKey, setBulkCanonicalKey] = useState("");
  const [bulkOutcomeKey, setBulkOutcomeKey]     = useState("");
  const [bulkBusy, setBulkBusy]                 = useState(false);

  const knownCanonicals = useMemo(() => new Set(canonicals.map((c) => c.canonical_key)), [canonicals]);

  const loadOutcomesForCanonical = useCallback(async (ck: string) => {
    if (outcomesByCanonical[ck]) return;
    try {
      const res = await fetch(`/api/admin/canonical-markets?action=get&canonical_key=${encodeURIComponent(ck)}`).then((r) => r.json());
      if (res.error) return;
      const keys: string[] = Array.isArray(res.row?.outcomes) ? res.row.outcomes.map((o: any) => o.key).filter(Boolean) : [];
      setOutcomesByCanonical((prev) => ({ ...prev, [ck]: keys }));
    } catch { /* ignore */ }
  }, [outcomesByCanonical]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        action: "list", source, page: String(page), per_page: String(perPage),
      });
      if (q)                 params.set("q", q);
      if (onlyUnmapped)      params.set("only_unmapped", "1");
      if (onlyUnverified)    params.set("only_unverified", "1");
      if (canonicalFilter)   params.set("canonical", canonicalFilter);

      const [list, kpiRes, canonRes] = await Promise.all([
        fetch(`/api/admin/outcome-normalization?${params}`).then(r => r.json()),
        fetch(`/api/admin/outcome-normalization?action=kpis&source=${source}`).then(r => r.json()),
        canonicals.length > 0
          ? Promise.resolve({ canonicals })
          : fetch(`/api/admin/outcome-normalization?action=canonicals`).then(r => r.json()),
      ]);
      if (list.error)  throw new Error(list.error);
      if (kpiRes.error) throw new Error(kpiRes.error);

      setRows(list.rows ?? []);
      setTotal(list.total ?? 0);
      setKpis(kpiRes.kpis ?? null);
      if (canonRes.canonicals) setCanonicals(canonRes.canonicals);
      setSelected(new Set());
      setEditing({});
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  // canonicals intentionally not in deps (cached after first fetch)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, page, perPage, q, onlyUnmapped, onlyUnverified, canonicalFilter]);

  useEffect(() => { load(); }, [load]);

  const beginEdit = (r: Row) => {
    setEditing(prev => ({ ...prev, [r.id]: { ...r } }));
    if (r.canonical_key) loadOutcomesForCanonical(r.canonical_key);
  };
  const cancelEdit = (id: number) => {
    setEditing(prev => { const next = { ...prev }; delete next[id]; return next; });
  };
  const setField = (id: number, field: keyof Row, value: any) => {
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };
  const saveRow = async (id: number) => {
    const payload = editing[id];
    if (!payload) return;
    setSavingRow(id);
    try {
      const res = await fetch("/api/admin/outcome-normalization", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsert", id, ...payload }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      // Use server-returned row as source-of-truth.
      const saved = res.row;
      if (saved) {
        setRows((prev) => prev.map((x) => x.id === id ? { ...x, ...saved } : x));
        setEditing(prev => { const cp = { ...prev }; delete cp[id]; return cp; });
      } else {
        await load();
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSavingRow(null);
    }
  };
  const clearMapping = async (id: number) => {
    if (!confirm("Rimuovere la canonicalizzazione per questa riga?")) return;
    try {
      const res = await fetch("/api/admin/outcome-normalization", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-mapping", id }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      await load();
    } catch (e: any) { setError(e?.message ?? String(e)); }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectPage = () => setSelected(new Set(rows.map(r => r.id)));
  const clearSelect = () => setSelected(new Set());

  const runEngine = async () => {
    setRunning(true); setLastSummary(null); setError("");
    try {
      const r = await fetch(`/api/admin/outcome-normalization?action=run-engine&chunk=500`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setLastSummary(r);
      await load();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  };

  const bulkAction = async (action: "bulk-verify" | "bulk-clear" | "bulk-assign", extras: any = {}) => {
    if (selected.size === 0) return;
    if (action === "bulk-clear" && !confirm(`Rimuovere mapping da ${selected.size} righe selezionate?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/admin/outcome-normalization", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: Array.from(selected), ...extras }),
      }).then(r => r.json());
      if (res.error) throw new Error(res.error);
      await load();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBulkBusy(false); }
  };

  const bulkVerify = (verified: boolean) => bulkAction("bulk-verify", { verified });
  const bulkClear  = () => bulkAction("bulk-clear");
  const bulkAssign = async () => {
    const ck = bulkCanonicalKey.trim();
    if (!ck) { setError("Inserisci canonical_key per bulk-assign"); return; }
    if (!knownCanonicals.has(ck)) {
      if (!confirm(`canonical_key "${ck}" non è nel catalogo — assegnare comunque?`)) return;
    }
    const cok = bulkOutcomeKey.trim();
    await bulkAction("bulk-assign", { canonical_key: ck, canonical_outcome_key: cok || undefined });
    setBulkCanonicalKey("");
    setBulkOutcomeKey("");
  };

  // K: hide Source column when source != all (pure display, redundant info).
  const showSourceCol = source === "all";

  // L (later): "next unverified" — find first unverified row id in current page
  // Enable in the future when we add the workflow button.

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const canonicalName = canonicalFilter
    ? (canonicals.find((c) => c.canonical_key === canonicalFilter)?.canonical_name_it || canonicalFilter)
    : "";

  // Allowed outcome keys for bulk-assign (mirrors row editor logic)
  const bulkOutcomeAllowed = bulkCanonicalKey && outcomesByCanonical[bulkCanonicalKey];
  useEffect(() => {
    const ck = bulkCanonicalKey.trim();
    if (ck && knownCanonicals.has(ck)) loadOutcomesForCanonical(ck);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkCanonicalKey]);

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--admin-text)", margin: 0 }}>
          Outcome Normalization
        </h1>
        <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 4, marginBottom: 0 }}>
          Mappatura source_outcome_name → canonical_outcome_key per flashscore / odds-api. Guida shade-to-min su canonicali verified.
        </p>
      </div>

      {/* KPI cards — F: brand voice IT, parity con sister */}
      {kpis && (
        <NormalizationKpiRow>
          <NormalizationKpiCard label="Totale righe"   value={kpis.total.toLocaleString("it-IT")} />
          <NormalizationKpiCard label="Coverage"       value={`${kpis.coverage_pct}%`} accent="#f97316" />
          <NormalizationKpiCard label="Mappati"        value={kpis.mapped.toLocaleString("it-IT")} accent="#3b82f6" />
          <NormalizationKpiCard label="Verificati"     value={kpis.verified.toLocaleString("it-IT")} accent="#22c55e" />
          <NormalizationKpiCard label="Non verificati" value={kpis.unverified.toLocaleString("it-IT")} accent="#eab308" />
          <NormalizationKpiCard label="Da mappare"     value={kpis.unmapped.toLocaleString("it-IT")} accent={kpis.unmapped > 0 ? "#ef4444" : "#64748b"} />
        </NormalizationKpiRow>
      )}

      {/* Active drill banner */}
      {canonicalFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "rgba(139,92,246,0.12)", border: "1px solid #8b5cf6", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "var(--admin-text)" }}>
            Filtro canonical: <code style={{ color: "#8b5cf6", fontWeight: 700 }}>{canonicalFilter}</code> {canonicalName && canonicalName !== canonicalFilter && <span style={{ color: "var(--admin-text-muted)" }}> · {canonicalName}</span>}
          </span>
          <button onClick={() => setModalKey(canonicalFilter)} style={{ ...btnStyle, color: "#8b5cf6", borderColor: "#8b5cf6" }}>Apri scheda</button>
          <button onClick={clearCanonicalFilter} style={btnStyle}>✕ Rimuovi filtro</button>
        </div>
      )}

      {/* Source tabs */}
      <div style={{ display: "flex", gap: 6 }}>
        {SOURCES.map(s => (
          <button key={s.value} onClick={() => setSource(s.value)}
            style={{
              padding: "6px 14px", borderRadius: 18, fontSize: 12, fontWeight: 700,
              cursor: "pointer",
              border: `1px solid ${source === s.value ? s.color : "var(--admin-border)"}`,
              background: source === s.value ? `${s.color}22` : "rgba(255,255,255,0.04)",
              color: source === s.value ? s.color : "var(--admin-text-muted)",
              textTransform: "capitalize",
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Filters — G: search live (no Enter) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "12px 14px", border: "1px solid var(--admin-border)", borderRadius: 10, background: "var(--admin-card)" }}>
        <input
          type="text" placeholder="Cerca market/outcome/canonical..." value={q}
          onChange={e => setQ(e.target.value)}
          style={inputStyle}
        />
        <select value={canonicalFilter} onChange={e => setCanonicalFilter(e.target.value)} style={selectStyle}>
          <option value="">Canonical: tutti ({canonicals.length} in uso)</option>
          {canonicals.map(c => (
            <option key={c.canonical_key} value={c.canonical_key}>
              {c.canonical_key} ({c.count})
            </option>
          ))}
        </select>
        <label style={checkboxStyle}>
          <input type="checkbox" checked={onlyUnmapped} onChange={e => setOnlyUnmapped(e.target.checked)} />
          Solo non-mappati
        </label>
        <label style={checkboxStyle}>
          <input type="checkbox" checked={onlyUnverified} onChange={e => setOnlyUnverified(e.target.checked)} />
          Solo non-verificati
        </label>
        <button onClick={() => load()} style={btnStyle}>🔍 Ricarica</button>
      </div>

      <EngineRunBar
        running={running}
        onRun={runEngine}
        summary={lastSummary}
        renderSummary={(s: any) => (
          <span>
            Engine: processed={s.processed}, dict={s.matched?.dictionary ?? 0}, prop={s.matched?.propagation ?? 0}, market_lookup={s.market_lookup_applied ?? 0}, unmatched={s.unmatched}, remaining={s.remaining} ({s.took_ms}ms)
          </span>
        )}
      />

      {/* Bulk bar — E: 4 actions */}
      {selected.size > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 14px", background: "rgba(16,185,129,0.08)", border: "1px solid #10b981", borderRadius: 8 }}>
          <span style={{ fontWeight: 700, color: "#10b981" }}>{selected.size} selezionati</span>
          <button onClick={() => bulkVerify(true)}  disabled={bulkBusy} style={{ ...btnStyle, color: "#22c55e", borderColor: "#22c55e44" }}>✓ Verifica</button>
          <button onClick={() => bulkVerify(false)} disabled={bulkBusy} style={{ ...btnStyle, color: "#eab308", borderColor: "#eab30844" }}>↺ De-verifica</button>
          <button onClick={bulkClear}               disabled={bulkBusy} style={{ ...btnStyle, color: "#ef4444", borderColor: "#ef444444" }}>✕ Clear mapping</button>
          <span style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)" }} />
          <input
            list="canonical-keys-bulk"
            placeholder="canonical_key…"
            value={bulkCanonicalKey}
            onChange={(e) => { setBulkCanonicalKey(e.target.value); setBulkOutcomeKey(""); }}
            style={{ ...inputStyle, width: 200, minWidth: 0 }}
          />
          {bulkOutcomeAllowed && bulkOutcomeAllowed.length > 0 ? (
            <select value={bulkOutcomeKey} onChange={(e) => setBulkOutcomeKey(e.target.value)} style={{ ...selectStyle, width: 150, minWidth: 0 }}>
              <option value="">outcome (opt)</option>
              {bulkOutcomeAllowed.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          ) : (
            <input
              placeholder="outcome (opt)"
              value={bulkOutcomeKey}
              onChange={(e) => setBulkOutcomeKey(e.target.value)}
              style={{ ...inputStyle, width: 150, minWidth: 0 }}
            />
          )}
          <button onClick={bulkAssign} disabled={bulkBusy || !bulkCanonicalKey.trim()} style={{ ...btnStyle, color: "#3b82f6", borderColor: "#3b82f644" }}>→ Assegna</button>
          <button onClick={clearSelect} disabled={bulkBusy} style={btnStyle}>Annulla</button>
          <datalist id="canonical-keys-bulk">
            {canonicals.map((c) => <option key={c.canonical_key} value={c.canonical_key}>{c.canonical_name_it} ({c.count})</option>)}
          </datalist>
        </div>
      )}

      {error && (
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid #ef4444", color: "#ef4444", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Chiudi avviso errore" style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* List */}
      <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
              <Th>
                <input type="checkbox"
                  checked={rows.length > 0 && rows.every(r => selected.has(r.id))}
                  onChange={e => e.target.checked ? selectPage() : clearSelect()} />
              </Th>
              {showSourceCol && <Th>Source</Th>}
              <Th>Market Type</Th>
              <Th>Outcome Name</Th>
              <Th>Canonical Market</Th>
              <Th>Canonical Outcome</Th>
              <Th>Notes</Th>
              <Th>By</Th>
              <Th align="center">Conf</Th>
              <Th align="center">✓</Th>
              <Th>Aggiornato</Th>
              <Th>Azioni</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={showSourceCol ? 12 : 11} style={{ ...tdStyle, textAlign: "center", padding: 30, color: "var(--admin-text-muted)" }}>Caricamento...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={showSourceCol ? 12 : 11} style={{ ...tdStyle, textAlign: "center", padding: 30, color: "var(--admin-text-muted)" }}>Nessuna riga.</td></tr>
            ) : rows.map(r => {
              const isEditing = editing[r.id] !== undefined;
              const edit = editing[r.id] ?? r;
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--admin-border)", background: isEditing ? "rgba(249,115,22,0.05)" : undefined }}>
                  <td style={tdStyle}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  {showSourceCol && (
                    <td style={tdStyle}>
                      <SourceBadge source={r.source} />
                    </td>
                  )}
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{r.source_market_type}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, fontWeight: 600 }}>{r.source_outcome_name}</td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <select
                          value={edit.canonical_key ?? ""}
                          onChange={e => {
                            const v = e.target.value || null;
                            setField(r.id, "canonical_key", v);
                            // Reset outcome key when canonical changes (allowed set differs)
                            setField(r.id, "canonical_outcome_key", null);
                            if (v) loadOutcomesForCanonical(v);
                          }}
                          style={{ ...selectStyle, fontSize: 11, flex: 1 }}
                        >
                          <option value="">—</option>
                          {canonicals.map(c => <option key={c.canonical_key} value={c.canonical_key}>{c.canonical_key}</option>)}
                        </select>
                        {edit.canonical_key && (
                          <button type="button" onClick={() => setModalKey(edit.canonical_key as string)} title="Apri scheda canonical" style={{ padding: "2px 6px", background: "transparent", border: "1px solid var(--admin-border)", color: "#8b5cf6", borderRadius: 4, cursor: "pointer", fontSize: 10 }}>🔍</button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <code style={{ fontSize: 11 }}>{r.canonical_key ?? <span style={{ color: "var(--admin-text-muted)" }}>—</span>}</code>
                        {r.canonical_key && (
                          <button type="button" onClick={() => setModalKey(r.canonical_key as string)} title="Apri scheda canonical" style={{ padding: "1px 5px", background: "transparent", border: "1px solid var(--admin-border)", color: "#8b5cf6", borderRadius: 4, cursor: "pointer", fontSize: 10 }}>🔍</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      (() => {
                        const ck = edit.canonical_key as string | null | undefined;
                        const allowed = ck ? outcomesByCanonical[ck] : undefined;
                        if (ck && allowed && allowed.length > 0) {
                          return (
                            <select
                              value={edit.canonical_outcome_key ?? ""}
                              onChange={e => setField(r.id, "canonical_outcome_key", e.target.value || null)}
                              style={{ ...selectStyle, fontSize: 11, width: 140 }}
                            >
                              <option value="">—</option>
                              {allowed.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                          );
                        }
                        return (
                          <input
                            type="text"
                            value={edit.canonical_outcome_key ?? ""}
                            onChange={e => setField(r.id, "canonical_outcome_key", e.target.value || null)}
                            placeholder={ck ? "(caricamento…)" : ""}
                            style={{ ...inputStyle, fontSize: 11, width: 140, minWidth: 0 }}
                          />
                        );
                      })()
                    ) : (
                      <code style={{ fontSize: 11, fontWeight: 600, color: r.canonical_outcome_key ? "var(--admin-text)" : "var(--admin-text-muted)" }}>
                        {r.canonical_outcome_key ?? "—"}
                      </code>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <input
                        value={edit.notes ?? ""}
                        onChange={e => setField(r.id, "notes", e.target.value)}
                        placeholder="—"
                        style={{ ...inputStyle, fontSize: 11, width: 160, minWidth: 0 }}
                      />
                    ) : (
                      <span title={r.notes ?? ""} style={{ fontSize: 11, color: "var(--admin-text-muted)", display: "inline-block", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>
                        {truncate(r.notes ?? "", 30) || "—"}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}><ExtractedByBadge extracted_by={r.extracted_by} /></td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {/* H: ConfBadge color */}
                    <ConfBadge confidence={r.confidence} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {isEditing ? (
                      <input type="checkbox" checked={!!edit.verified} onChange={e => setField(r.id, "verified", e.target.checked)} />
                    ) : (
                      <span
                        aria-label={r.verified ? "Verificato" : "Non verificato"}
                        title={r.verified ? "Verificato" : "Non verificato"}
                        style={{ color: r.verified ? "#22c55e" : "var(--admin-text-muted)", fontWeight: 700 }}
                      >
                        {r.verified ? "✓ ok" : "○"}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 11, color: "var(--admin-text-muted)", whiteSpace: "nowrap" }}>
                    {r.updated_at ? timeAgo(r.updated_at) : "—"}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => saveRow(r.id)} disabled={savingRow === r.id} style={{ ...btnStyle, fontSize: 10, padding: "4px 8px", color: "#22c55e", borderColor: "#22c55e44" }}>
                          {savingRow === r.id ? "..." : "💾 Salva"}
                        </button>
                        <button onClick={() => cancelEdit(r.id)} aria-label="Annulla modifica" title="Annulla" style={{ ...btnStyle, fontSize: 10, padding: "4px 8px" }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => beginEdit(r)} style={{ ...btnStyle, fontSize: 10, padding: "4px 8px" }}>✏️ Modifica</button>
                        {r.canonical_outcome_key && (
                          <button onClick={() => clearMapping(r.id)} aria-label="Rimuovi mapping outcome" title="Rimuovi mapping" style={{ ...btnStyle, fontSize: 10, padding: "4px 8px", color: "#ef4444", borderColor: "#ef444444" }}>🗑</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination — D: shared primitive */}
      <Pagination page={page} totalPages={totalPages} onPage={setPage} totalRows={total} />

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

// ─── UI primitives ────────────────────────────────────────────

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th style={{
      padding: "8px 10px", textAlign: align, fontSize: 10,
      textTransform: "uppercase", color: "var(--admin-text-muted)",
      fontWeight: 700, letterSpacing: 0.5,
    }}>{children}</th>
  );
}

const tdStyle: React.CSSProperties = { padding: "6px 10px", verticalAlign: "top", color: "var(--admin-text)" };

const inputStyle: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12, background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text)",
  minWidth: 200,
};
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 140 };
const btnStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text)",
};
const checkboxStyle: React.CSSProperties = {
  display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--admin-text-muted)", cursor: "pointer",
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function timeAgo(iso: string): string {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return `${Math.floor(diff / 86400)}g fa`;
}
