"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface Outcome { key: string; name_it: string }
interface CanonicalMarket {
  canonical_key: string;
  base_key: string;
  period: string;
  canonical_name_it: string;
  has_line: boolean;
  outcomes: Outcome[];
  notes: string | null;
  mapped_count?: number;
  outcome_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface MappedMarketRow {
  source: string;
  source_market_type: string;
  canonical_line: number | null;
  verified: boolean;
  extracted_by: string | null;
  confidence: number | null;
  updated_at: string;
}
interface MappedOutcomeRow {
  id: number;
  source: string;
  source_market_type: string;
  source_outcome_name: string;
  canonical_outcome_key: string | null;
  verified: boolean;
  extracted_by: string | null;
  confidence: number | null;
  updated_at: string;
}

type Tab = "overview" | "markets" | "outcomes";
type Mode = "view" | "create";

const EMPTY_EDIT: CanonicalMarket = {
  canonical_key: "",
  base_key: "",
  period: "ft",
  canonical_name_it: "",
  has_line: false,
  outcomes: [],
  notes: null,
};

export function CanonicalMarketDetailModal({
  canonicalKey,
  mode = "view",
  onClose,
  onSaved,
}: {
  canonicalKey: string | null;
  mode?: Mode;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  // internalMode lets us flip view→create when user clicks "Clona".
  const [internalMode, setInternalMode] = useState<Mode>(mode);
  useEffect(() => { setInternalMode(mode); }, [mode]);

  const [row, setRow] = useState<CanonicalMarket | null>(null);
  const [markets, setMarkets] = useState<MappedMarketRow[]>([]);
  const [outcomes, setOutcomes] = useState<MappedOutcomeRow[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<CanonicalMarket>(EMPTY_EDIT);
  const [periodFreeText, setPeriodFreeText] = useState(false);

  // Realtime canonical_key uniqueness check (create mode only).
  const [keyExists, setKeyExists] = useState<null | boolean>(null);
  const [keyChecking, setKeyChecking] = useState(false);

  // Mapped tabs: filter toggles (review #1bis — usage routes accept onlyVerified/onlyManual).
  const [usageOnlyVerified, setUsageOnlyVerified] = useState(false);
  const [usageOnlyManual, setUsageOnlyManual] = useState(false);

  // Inline 2-step delete confirmation (replaces native confirm()).
  const [deleteArmed, setDeleteArmed] = useState(false);

  // Esc key closes modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Initial load — abortable so closing the modal mid-fetch doesn't setState
  // on an unmounted component.
  useEffect(() => {
    if (internalMode === "create" && !canonicalKey) {
      // create-from-scratch: don't load, just fetch periods
      const ac = new AbortController();
      let alive = true;
      (async () => {
        try {
          const r = await fetch(`/api/admin/canonical-markets?action=periods`, { signal: ac.signal }).then((r) => r.json());
          if (alive) setPeriods(r.periods ?? []);
        } catch (e: any) {
          if (e?.name === "AbortError") return;
          if (alive) setError(e?.message ?? String(e));
        }
      })();
      return () => { alive = false; ac.abort(); };
    }

    if (internalMode === "view" && canonicalKey) {
      const ac = new AbortController();
      let alive = true;
      setLoading(true);
      setError("");
      const usageQs = new URLSearchParams();
      if (usageOnlyVerified) usageQs.set("onlyVerified", "true");
      if (usageOnlyManual) usageQs.set("onlyManual", "true");
      const usageUrl = `/api/admin/canonical-markets/${encodeURIComponent(canonicalKey)}/usage${usageQs.toString() ? "?" + usageQs.toString() : ""}`;
      (async () => {
        try {
          const [periodsRes, detail, usage] = await Promise.all([
            fetch(`/api/admin/canonical-markets?action=periods`, { signal: ac.signal }).then((r) => r.json()),
            fetch(`/api/admin/canonical-markets?action=get&canonical_key=${encodeURIComponent(canonicalKey)}`, { signal: ac.signal }).then((r) => r.json()),
            fetch(usageUrl, { signal: ac.signal }).then((r) => r.json()),
          ]);
          if (!alive) return;
          if (detail.error) throw new Error(detail.error);
          if (usage.error) throw new Error(usage.error);
          setPeriods(periodsRes.periods ?? []);
          const r = detail.row as CanonicalMarket;
          setRow(r);
          setEdit({ ...r, outcomes: Array.isArray(r.outcomes) ? [...r.outcomes] : [] });
          setMarkets(usage.markets ?? []);
          setOutcomes(usage.outcomes ?? []);
        } catch (e: any) {
          if (e?.name === "AbortError") return;
          if (alive) setError(e?.message ?? String(e));
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => { alive = false; ac.abort(); };
    }
  }, [canonicalKey, internalMode, usageOnlyVerified, usageOnlyManual]);

  // Debounced uniqueness check on canonical_key in create mode.
  useEffect(() => {
    if (internalMode !== "create") { setKeyExists(null); return; }
    const k = edit.canonical_key.trim();
    if (!k) { setKeyExists(null); return; }
    const ac = new AbortController();
    setKeyChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/admin/canonical-markets?action=check_key&canonical_key=${encodeURIComponent(k)}`,
          { signal: ac.signal }
        ).then((r) => r.json());
        setKeyExists(!!r.exists);
      } catch (e: any) {
        if (e?.name !== "AbortError") setKeyExists(null);
      } finally {
        setKeyChecking(false);
      }
    }, 350);
    return () => { clearTimeout(t); ac.abort(); setKeyChecking(false); };
  }, [edit.canonical_key, internalMode]);

  // Auto-suggest canonical_key from base_key + period in create mode (only if user hasn't typed).
  const userTouchedKey = useRef(false);
  useEffect(() => {
    if (internalMode !== "create") return;
    if (userTouchedKey.current) return;
    const auto = `${edit.base_key.trim()}_${edit.period.trim()}`;
    if (auto.length > 1 && auto !== edit.canonical_key) {
      setEdit((x) => ({ ...x, canonical_key: auto }));
    }
  }, [edit.base_key, edit.period, internalMode]);

  // Outcome editor helpers.
  const addOutcome = () => setEdit((e) => ({ ...e, outcomes: [...e.outcomes, { key: "", name_it: "" }] }));
  const removeOutcome = (i: number) => setEdit((e) => ({ ...e, outcomes: e.outcomes.filter((_, ix) => ix !== i) }));
  const updateOutcome = (i: number, patch: Partial<Outcome>) => setEdit((e) => ({
    ...e, outcomes: e.outcomes.map((o, ix) => ix === i ? { ...o, ...patch } : o),
  }));

  // Detect duplicate outcome keys client-side.
  const outcomeDuplicates = useMemo(() => {
    const seen = new Map<string, number[]>();
    edit.outcomes.forEach((o, i) => {
      const k = o.key.trim();
      if (!k) return;
      const arr = seen.get(k) ?? [];
      arr.push(i);
      seen.set(k, arr);
    });
    const dupIndexes = new Set<number>();
    for (const [, idxs] of seen) {
      if (idxs.length > 1) idxs.forEach((i) => dupIndexes.add(i));
    }
    return dupIndexes;
  }, [edit.outcomes]);

  const periodNotInDb = periodFreeText && edit.period && !periods.includes(edit.period);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // Client validation mirrors server.
      if (outcomeDuplicates.size > 0) {
        throw new Error("Outcomes con key duplicato — risolvi prima di salvare.");
      }
      const payload = {
        canonical_key: edit.canonical_key.trim(),
        base_key: edit.base_key.trim(),
        period: edit.period.trim(),
        canonical_name_it: edit.canonical_name_it.trim(),
        has_line: edit.has_line,
        outcomes: edit.outcomes.filter((o) => o.key.trim()).map((o) => ({ key: o.key.trim(), name_it: o.name_it.trim() })),
        notes: edit.notes,
      };
      if (!payload.canonical_key || !payload.base_key || !payload.period || !payload.canonical_name_it) {
        throw new Error("canonical_key, base_key, period, canonical_name_it sono richiesti");
      }
      if (payload.outcomes.length === 0) throw new Error("Aggiungi almeno un outcome");
      const res = await fetch(`/api/admin/canonical-markets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error + (res.suggested ? ` → suggerito: ${res.suggested}` : ""));
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!row) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/canonical-markets?canonical_key=${encodeURIComponent(row.canonical_key)}`, {
        method: "DELETE",
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
      setDeleteArmed(false);
    }
  };

  // Convert current view into a fresh "create" form prefilled from this canonical.
  const cloneFromCurrent = () => {
    if (!row) return;
    setInternalMode("create");
    setRow(null);
    setMarkets([]);
    setOutcomes([]);
    setTab("overview");
    setKeyExists(null);
    userTouchedKey.current = false;
    setEdit({
      canonical_key: "", // user must rename — auto-suggest will fire from base_key+period
      base_key: row.base_key,
      period: row.period,
      canonical_name_it: row.canonical_name_it + " (copia)",
      has_line: row.has_line,
      outcomes: [...(row.outcomes ?? [])],
      notes: row.notes,
    });
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const title = internalMode === "create" ? (edit.canonical_key || "Nuovo Canonical") : (row?.canonical_key ?? "Caricamento…");
  const mappedCount = row?.mapped_count ?? 0;
  const outcomeCount = row?.outcome_count ?? 0;
  // canDelete now considers BOTH market and outcome refs (review #1bis bug A).
  const canDelete = internalMode === "view" && mappedCount === 0 && outcomeCount === 0;
  const deleteBlockReason =
    !canDelete && internalMode === "view"
      ? `${[
          mappedCount > 0 ? `${mappedCount} market` : null,
          outcomeCount > 0 ? `${outcomeCount} outcome` : null,
        ].filter(Boolean).join(" + ")} mapping bloccano la cancellazione — unmap first`
      : "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={stop}
        style={{
          width: "min(900px, 100%)", maxHeight: "90vh", overflow: "auto",
          background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, padding: 20, color: "var(--admin-text, #e2e8f0)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--admin-text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Canonical Market {internalMode === "create" ? "(nuovo)" : ""}
            </div>
            <h2 style={{ margin: "2px 0 0 0", fontSize: 20, fontWeight: 800, fontFamily: "monospace" }}>{title}</h2>
            {internalMode === "view" && row?.updated_at && (
              <div style={{ fontSize: 10, color: "var(--admin-text-muted)", marginTop: 2 }}>
                ultima modifica: {new Date(row.updated_at).toLocaleString("it-IT")}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Chiudi modal (Esc)" style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text-muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {/* Tabs */}
        {internalMode === "view" && (
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--admin-border)", marginBottom: 14 }}>
            {([
              ["overview", "Overview"],
              ["markets", `Mapped markets (${markets.length})`],
              ["outcomes", `Mapped outcomes (${outcomes.length})`],
            ] as [Tab, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: "8px 14px", borderBottom: tab === id ? "2px solid #8b5cf6" : "2px solid transparent",
                background: "transparent", border: "none", color: tab === id ? "var(--admin-text)" : "var(--admin-text-muted)",
                cursor: "pointer", fontWeight: tab === id ? 700 : 500, fontSize: 13,
              }}>{label}</button>
            ))}
          </div>
        )}

        {error && (
          <div style={{ padding: 10, marginBottom: 12, background: "#ef444422", border: "1px solid #ef4444", borderRadius: 6, color: "#fca5a5", fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading && <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Caricamento…</div>}

        {/* Overview tab */}
        {!loading && tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="canonical_key">
              <input
                value={edit.canonical_key}
                onChange={(e) => { userTouchedKey.current = true; setEdit((x) => ({ ...x, canonical_key: e.target.value })); }}
                disabled={internalMode === "view"}
                placeholder="es. u_o_ft"
                style={inputStyle(internalMode === "view")}
              />
              {internalMode === "create" && edit.canonical_key && (
                <div style={{ fontSize: 11, marginTop: 4, color: keyExists ? "#ef4444" : keyExists === false ? "#10b981" : "var(--admin-text-muted)" }}>
                  {keyChecking ? "verifica…" : keyExists === true ? "⚠ esiste già" : keyExists === false ? "✓ disponibile" : ""}
                </div>
              )}
            </Field>

            <Field label="base_key">
              <input
                value={edit.base_key}
                onChange={(e) => setEdit((x) => ({ ...x, base_key: e.target.value }))}
                disabled={internalMode === "view"}
                placeholder="es. u_o"
                style={inputStyle(internalMode === "view")}
              />
            </Field>

            <Field label="period">
              <div style={{ display: "flex", gap: 8 }}>
                {!periodFreeText ? (
                  <select
                    value={edit.period}
                    onChange={(e) => {
                      if (e.target.value === "__other__") { setPeriodFreeText(true); }
                      else setEdit((x) => ({ ...x, period: e.target.value }));
                    }}
                    disabled={internalMode === "view"}
                    style={inputStyle(internalMode === "view")}
                  >
                    {periods.map((p) => <option key={p} value={p}>{p}</option>)}
                    {!periods.includes(edit.period) && edit.period && (
                      <option value={edit.period}>{edit.period}</option>
                    )}
                    {internalMode !== "view" && <option value="__other__">Altro…</option>}
                  </select>
                ) : (
                  <input
                    value={edit.period}
                    onChange={(e) => setEdit((x) => ({ ...x, period: e.target.value }))}
                    placeholder="nuovo period (es. 11T, etp)"
                    style={inputStyle(false)}
                  />
                )}
                {internalMode !== "view" && (
                  <button
                    onClick={() => setPeriodFreeText((v) => !v)}
                    style={{ padding: "6px 10px", fontSize: 11, background: "transparent", border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text-muted)", cursor: "pointer" }}
                  >
                    {periodFreeText ? "Da lista" : "Altro"}
                  </button>
                )}
              </div>
              {periodNotInDb && (
                <div style={{ fontSize: 11, marginTop: 4, color: "#eab308" }}>
                  ⚠ "{edit.period}" non è ancora un period esistente. Save fallirà se la CHECK constraint del DB non lo include — esegui prima ALTER constraint via migration.
                </div>
              )}
            </Field>

            <Field label="canonical_name_it">
              <input
                value={edit.canonical_name_it}
                onChange={(e) => setEdit((x) => ({ ...x, canonical_name_it: e.target.value }))}
                placeholder="Over/Under Tempo Pieno"
                style={inputStyle(false)}
              />
            </Field>

            <Field label="">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={edit.has_line}
                  onChange={(e) => setEdit((x) => ({ ...x, has_line: e.target.checked }))}
                />
                has_line (mercato con linea numerica)
              </label>
            </Field>

            <Field label={`outcomes (${edit.outcomes.length})${outcomeDuplicates.size > 0 ? " — ⚠ duplicati" : ""}`}>
              <div style={{ maxHeight: 280, overflow: "auto", border: outcomeDuplicates.size > 0 ? "1px solid #ef4444" : "1px solid var(--admin-border)", borderRadius: 6 }}>
                <table style={{ width: "100%", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                      <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, color: "var(--admin-text-muted)", textTransform: "uppercase", width: 180 }}>key</th>
                      <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, color: "var(--admin-text-muted)", textTransform: "uppercase" }}>name_it</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {edit.outcomes.map((o, i) => {
                      const isDup = outcomeDuplicates.has(i);
                      return (
                        <tr key={i} style={{ borderTop: "1px solid var(--admin-border)", background: isDup ? "#ef444415" : "transparent" }}>
                          <td style={{ padding: 4 }}>
                            <input
                              value={o.key}
                              onChange={(e) => updateOutcome(i, { key: e.target.value })}
                              placeholder="over"
                              style={{ ...inputStyle(false), fontFamily: "monospace", fontSize: 11, borderColor: isDup ? "#ef4444" : undefined }}
                              title={isDup ? "Duplicato — risolvi prima di salvare" : ""}
                            />
                          </td>
                          <td style={{ padding: 4 }}>
                            <input value={o.name_it} onChange={(e) => updateOutcome(i, { name_it: e.target.value })} placeholder="Over" style={inputStyle(false)} />
                          </td>
                          <td style={{ padding: 4, textAlign: "center" }}>
                            <button onClick={() => removeOutcome(i)} title="Rimuovi outcome" aria-label={`Rimuovi outcome ${o.key || i+1}`} style={{ padding: "3px 8px", background: "transparent", border: "1px solid #ef444455", color: "#ef4444", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                    {edit.outcomes.length === 0 && (
                      <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 12 }}>Nessun outcome — aggiungi almeno uno.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button onClick={addOutcome} style={{ marginTop: 6, padding: "5px 10px", background: "#10b98122", border: "1px solid #10b981", color: "#10b981", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Aggiungi outcome</button>
            </Field>

            <Field label="notes">
              <textarea
                value={edit.notes ?? ""}
                onChange={(e) => setEdit((x) => ({ ...x, notes: e.target.value }))}
                rows={3}
                placeholder="note opzionali"
                style={{ ...inputStyle(false), resize: "vertical" }}
              />
            </Field>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={save}
                disabled={saving || (internalMode === "create" && keyExists === true) || outcomeDuplicates.size > 0}
                title={
                  outcomeDuplicates.size > 0 ? "Risolvi outcome duplicati" :
                  (internalMode === "create" && keyExists === true) ? "canonical_key esiste già" : ""
                }
                style={{ padding: "8px 16px", background: "#10b981", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: saving || (internalMode === "create" && keyExists === true) || outcomeDuplicates.size > 0 ? 0.5 : 1 }}
              >
                {saving ? "Salvataggio…" : internalMode === "create" ? "Crea" : "Salva"}
              </button>
              {internalMode === "view" && row && (
                <>
                  <button
                    onClick={cloneFromCurrent}
                    disabled={saving}
                    title="Crea un nuovo canonical prefilled con questi valori"
                    style={{ padding: "8px 16px", background: "transparent", color: "#8b5cf6", border: "1px solid #8b5cf6", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  >
                    Clona
                  </button>
                  {!deleteArmed ? (
                    <button
                      onClick={() => setDeleteArmed(true)}
                      disabled={!canDelete || saving}
                      title={deleteBlockReason}
                      style={{ padding: "8px 16px", background: canDelete ? "#ef4444" : "#334155", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: canDelete ? "pointer" : "not-allowed", opacity: canDelete ? 1 : 0.5 }}
                    >
                      Cancella
                    </button>
                  ) : (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#ef444422", border: "1px solid #ef4444", borderRadius: 6 }}>
                      <span style={{ fontSize: 12, color: "#fca5a5" }}>Confermi?</span>
                      <button
                        onClick={del}
                        disabled={saving}
                        style={{ padding: "4px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                      >
                        {saving ? "…" : "Sì, cancella"}
                      </button>
                      <button
                        onClick={() => setDeleteArmed(false)}
                        disabled={saving}
                        style={{ padding: "4px 10px", background: "transparent", color: "var(--admin-text-muted)", border: "1px solid var(--admin-border)", borderRadius: 4, fontSize: 12, cursor: "pointer" }}
                      >
                        Annulla
                      </button>
                    </div>
                  )}
                  <span style={{ marginLeft: "auto", color: "var(--admin-text-muted)", fontSize: 11 }}>
                    {mappedCount} market · {outcomeCount} outcome ref
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Mapped markets tab */}
        {!loading && tab === "markets" && internalMode === "view" && (
          <div style={{ overflow: "auto" }}>
            <UsageFilters
              onlyVerified={usageOnlyVerified}
              onlyManual={usageOnlyManual}
              onChange={(v, m) => { setUsageOnlyVerified(v); setUsageOnlyManual(m); }}
            />
            {markets.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun market mappato.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Market type</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Line</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Verified</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>By</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--admin-border)" }}>
                      <td style={tdStyleMono}>{m.source}</td>
                      <td style={tdStyleMono}>{m.source_market_type}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{m.canonical_line ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "center", color: m.verified ? "#10b981" : "var(--admin-text-muted)" }}>{m.verified ? "✓" : "○"}</td>
                      <td style={{ ...tdStyle, textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "var(--admin-text-muted)" }}>{m.extracted_by ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.confidence ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {row && markets.length > 0 && (
              <div style={{ marginTop: 8, textAlign: "right" }}>
                <a
                  href={`/admin/market-normalization?canonical=${encodeURIComponent(row.canonical_key)}`}
                  style={{ fontSize: 12, color: "#8b5cf6", textDecoration: "underline" }}
                >
                  Apri in Market Normalization →
                </a>
              </div>
            )}
          </div>
        )}

        {/* Mapped outcomes tab */}
        {!loading && tab === "outcomes" && internalMode === "view" && (
          <div style={{ overflow: "auto" }}>
            <UsageFilters
              onlyVerified={usageOnlyVerified}
              onlyManual={usageOnlyManual}
              onChange={(v, m) => { setUsageOnlyVerified(v); setUsageOnlyManual(m); }}
            />
            {outcomes.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun outcome mappato.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Market type</th>
                    <th style={thStyle}>Outcome name</th>
                    <th style={thStyle}>Canonical outcome</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Verified</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((o) => (
                    <tr key={o.id} style={{ borderTop: "1px solid var(--admin-border)" }}>
                      <td style={tdStyleMono}>{o.source}</td>
                      <td style={tdStyleMono}>{o.source_market_type}</td>
                      <td style={tdStyleMono}>{o.source_outcome_name}</td>
                      <td style={tdStyleMono}>{o.canonical_outcome_key ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "center", color: o.verified ? "#10b981" : "var(--admin-text-muted)" }}>{o.verified ? "✓" : "○"}</td>
                      <td style={{ ...tdStyle, textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "var(--admin-text-muted)" }}>{o.extracted_by ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {row && outcomes.length > 0 && (
              <div style={{ marginTop: 8, textAlign: "right" }}>
                <a
                  href={`/admin/outcome-normalization?canonical=${encodeURIComponent(row.canonical_key)}`}
                  style={{ fontSize: 12, color: "#8b5cf6", textDecoration: "underline" }}
                >
                  Apri in Outcome Normalization →
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── UI primitives ────────────────────────────────

function UsageFilters({
  onlyVerified, onlyManual, onChange,
}: {
  onlyVerified: boolean;
  onlyManual: boolean;
  onChange: (verified: boolean, manual: boolean) => void;
}) {
  const active = onlyVerified || onlyManual;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 11, color: "var(--admin-text-muted)" }}>
      <span style={{ textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Filtra:</span>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={onlyVerified}
          onChange={(e) => onChange(e.target.checked, onlyManual)}
        />
        solo verified
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={onlyManual}
          onChange={(e) => onChange(onlyVerified, e.target.checked)}
        />
        solo manual
      </label>
      {active && (
        <button
          onClick={() => onChange(false, false)}
          style={{ padding: "2px 8px", background: "transparent", border: "1px solid var(--admin-border)", borderRadius: 4, color: "var(--admin-text-muted)", cursor: "pointer", fontSize: 10 }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      {label && (
        <div style={{ fontSize: 10, color: "var(--admin-text-muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "6px 10px",
    background: disabled ? "rgba(255,255,255,0.02)" : "var(--admin-bg, #0a1929)",
    border: "1px solid var(--admin-border, #1e3a5f)",
    borderRadius: 6,
    color: disabled ? "var(--admin-text-muted)" : "var(--admin-text, #e2e8f0)",
    fontSize: 13,
    fontFamily: "inherit",
  };
}

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: 10,
  textTransform: "uppercase",
  color: "var(--admin-text-muted)",
  fontWeight: 700,
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  color: "var(--admin-text, #e2e8f0)",
};

const tdStyleMono: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "monospace",
  fontSize: 11,
};
