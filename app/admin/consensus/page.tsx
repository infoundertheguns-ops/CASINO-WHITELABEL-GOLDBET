"use client";

// E10 — sport/market/min_delta/only_unreviewed filters persisted in URL.
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";
import { Kpi, KpiRow, GlossaryTerm } from "@/components/admin/ui";

interface Outlier {
  id: number;
  sport: string;
  home_team: string;
  away_team: string;
  event_starts_at: string;
  market_type: string;
  outcome_name: string;
  kambi_odds: number;
  twobet_odds: number | null;
  betfair_odds: number | null;
  delta_pct: number;
  abs_delta_pct: number;
  snapshot_at: string;
  reviewed: boolean;
  notes: string | null;
  kambi_event_id: string;
  twobet_event_id: string | null;
  betfair_event_id: string | null;
}

type ActionKind = "suspend" | "override" | "restore" | "dismiss";
interface ActionModal {
  row: Outlier;
  kind: ActionKind;
}

interface Kpis {
  total: number;
  unreviewed: number;
  max_delta: number | null;
  last_refresh: { at: string; upserted: number; scanned_pairs: number; candidate_deltas: number; duration_ms: number; threshold_pct: number } | null;
}

interface SportCount { sport: string; count: number; }

export default function ConsensusPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "var(--admin-text-muted, #94a3b8)" }}>Caricamento…</div>}>
      <ConsensusPageInner />
    </Suspense>
  );
}

function ConsensusPageInner() {
  const { filters, updateFilter } = useAdminFilters({
    sport: "",
    market: "",
    min_delta: 15,
    only_unreviewed: false as boolean,
  });
  const sportFilter = filters.sport;
  const marketFilter = filters.market;
  const minDelta = filters.min_delta;
  const onlyUnreviewed = filters.only_unreviewed;
  const setSportFilter = (v: string) => updateFilter("sport", v);
  const setMarketFilter = (v: string) => updateFilter("market", v);
  const setMinDelta = (v: number) => updateFilter("min_delta", v);
  const setOnlyUnreviewed = (v: boolean) => updateFilter("only_unreviewed", v);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [sports, setSports] = useState<SportCount[]>([]);
  const [rows, setRows] = useState<Outlier[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ action: "list", min_delta: String(minDelta), limit: "200" });
      if (sportFilter) params.set("sport", sportFilter);
      if (marketFilter) params.set("market_type", marketFilter);
      if (onlyUnreviewed) params.set("only_unreviewed", "1");

      const [listRes, kpisRes, sportsRes] = await Promise.all([
        fetch(`/api/admin/consensus?${params}`).then(r => r.json()),
        fetch(`/api/admin/consensus?action=kpis`).then(r => r.json()),
        fetch(`/api/admin/consensus?action=sports`).then(r => r.json()),
      ]);
      if (listRes?.error) throw new Error(`list: ${listRes.error}`);
      if (kpisRes?.error) throw new Error(`kpis: ${kpisRes.error}`);
      if (sportsRes?.error) throw new Error(`sports: ${sportsRes.error}`);
      setRows(listRes.rows ?? []);
      setKpis(kpisRes);
      setSports(Array.isArray(sportsRes) ? sportsRes : []);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [sportFilter, marketFilter, minDelta, onlyUnreviewed]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/admin/consensus?action=refresh&threshold=${minDelta}`).then(r => r.json());
      if (r.error) throw new Error(r.error);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleReview = async (id: number, reviewed: boolean) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, reviewed } : r));
    await fetch(`/api/admin/consensus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reviewed }),
    });
  };

  const [modal, setModal] = useState<ActionModal | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const closeModal = () => setModal(null);
  const flashToast = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4000);
  };

  const submitAction = async (payload: {
    consensusId: number;
    kind: ActionKind;
    body: Record<string, unknown>;
  }) => {
    const endpoint = `/api/admin/consensus/${payload.consensusId}/${payload.kind}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      flashToast("err", json.error ?? `HTTP ${res.status}`);
      return;
    }
    flashToast("ok", `${payload.kind} ok`);
    // mark row reviewed locally on any successful action, refresh list
    setRows(prev => prev.map(r => r.id === payload.consensusId ? { ...r, reviewed: true } : r));
    closeModal();
  };

  const quickRestore = (row: Outlier) => {
    if (!confirm(`Ripristinare outcome "${row.outcome_name}"? Cancella eventuale suspend/override manuale.`)) return;
    submitAction({ consensusId: row.id, kind: "restore", body: {} });
  };

  // Market dropdown: show sport context because the same market_type (e.g. "U/O 6.5",
  // "1X2") appears across calcio/tennis/baseball — without the sport suffix the label
  // is ambiguous.
  const marketTypes = useMemo(() => {
    const bySport = new Map<string, Set<string>>();
    for (const r of rows) {
      let set = bySport.get(r.market_type);
      if (!set) { set = new Set(); bySport.set(r.market_type, set); }
      set.add(r.sport);
    }
    return Array.from(bySport.entries())
      .map(([market_type, sports]) => ({
        value: market_type,
        label: sports.size === 1
          ? `${market_type} · ${Array.from(sports)[0]}`
          : `${market_type} · ${Array.from(sports).sort().join(", ")}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const deltaColor = (d: number) => {
    const abs = Math.abs(d);
    if (abs >= 30) return "#ef4444";
    if (abs >= 20) return "#f97316";
    return "#f0b429";
  };

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI row \u2014 E9 shared primitive */}
      <KpiRow minWidth={180}>
        <Kpi label="Outliers totali" value={kpis?.total ?? "\u2014"} />
        <Kpi label="Da revisionare" value={kpis?.unreviewed ?? "\u2014"} accent="#ef4444" />
        <Kpi label={<GlossaryTerm term="candidate_delta">Delta massimo</GlossaryTerm>} value={kpis?.max_delta != null ? `${Number(kpis.max_delta).toFixed(1)}%` : "\u2014"} accent="#f97316" />
        <Kpi label="Ultimo refresh" value={kpis?.last_refresh?.at ? timeAgo(kpis.last_refresh.at) : "mai"} sub={kpis?.last_refresh ? `+${kpis.last_refresh.upserted} su ${kpis.last_refresh.scanned_pairs} match` : undefined} />
      </KpiRow>

      {/* Controls */}
      <div style={{
        display: "flex", gap: 12, flexWrap: "wrap", padding: 12,
        border: "1px solid var(--admin-border)", borderRadius: 10,
        background: "var(--admin-card)",
      }}>
        <Select label="Sport" value={sportFilter} onChange={setSportFilter}
          options={[{ value: "", label: `Tutti (${sports.reduce((s, x) => s + x.count, 0)})` }, ...sports.map(s => ({ value: s.sport, label: `${s.sport} (${s.count})` }))]} />
        <Select label="Mercato" value={marketFilter} onChange={setMarketFilter}
          options={[{ value: "", label: "Tutti" }, ...marketTypes]} />
        <NumField label="Delta min %" value={minDelta} onChange={setMinDelta} step={5} min={5} max={100} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--admin-text-muted)", fontSize: 13 }}>
          <input type="checkbox" checked={onlyUnreviewed} onChange={e => setOnlyUnreviewed(e.target.checked)} />
          Solo da revisionare
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={loadAll} disabled={loading}
            style={btnStyle("#334155")}>
            {loading ? "Caricamento…" : "Ricarica"}
          </button>
          <button onClick={triggerRefresh} disabled={refreshing}
            style={btnStyle("#8b5cf6")}>
            {refreshing ? "Refresh…" : "Esegui refresh RPC"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
              <Th>Evento</Th>
              <Th>Sport</Th>
              <Th>Mercato</Th>
              <Th>Outcome</Th>
              <Th align="right">Kambi</Th>
              <Th align="right">22bet</Th>
              <Th align="right">Betfair</Th>
              <Th align="right">Δ % vs media</Th>
              <Th>Inizio</Th>
              <Th>Rilevato</Th>
              <Th>Revisionato</Th>
              <Th align="right">Azioni</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--admin-border)", opacity: r.reviewed ? 0.55 : 1 }}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600, color: "var(--admin-text)" }}>{r.home_team}</div>
                  <div style={{ color: "var(--admin-text-muted)", fontSize: 12 }}>vs {r.away_team}</div>
                </td>
                <td style={tdStyle}>{r.sport}</td>
                <td style={tdStyle}>{r.market_type}</td>
                <td style={tdStyle}><code style={{ fontSize: 12 }}>{r.outcome_name}</code></td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(r.kambi_odds).toFixed(2)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.twobet_odds == null ? "var(--admin-text-muted)" : undefined }}>
                  {r.twobet_odds == null ? "—" : Number(r.twobet_odds).toFixed(2)}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.betfair_odds == null ? "var(--admin-text-muted)" : undefined }}>
                  {r.betfair_odds == null ? "—" : Number(r.betfair_odds).toFixed(2)}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: deltaColor(r.delta_pct), fontVariantNumeric: "tabular-nums" }}>
                  {r.delta_pct > 0 ? "+" : ""}{Number(r.delta_pct).toFixed(1)}%
                </td>
                <td style={{ ...tdStyle, color: "var(--admin-text-muted)" }}>{formatDate(r.event_starts_at)}</td>
                <td style={{ ...tdStyle, color: "var(--admin-text-muted)" }}>{timeAgo(r.snapshot_at)}</td>
                <td style={tdStyle}>
                  <input type="checkbox" checked={r.reviewed} onChange={e => toggleReview(r.id, e.target.checked)} />
                </td>
                <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                  <ActionBtn title="Sospendi outcome" onClick={() => setModal({ row: r, kind: "suspend" })}>🔴</ActionBtn>
                  <ActionBtn title="Override quota" onClick={() => setModal({ row: r, kind: "override" })}>⚙️</ActionBtn>
                  <ActionBtn title="Ripristina (clear manual)" onClick={() => quickRestore(r)}>↩️</ActionBtn>
                  <ActionBtn title="Dismiss / classifica" onClick={() => setModal({ row: r, kind: "dismiss" })}>✅</ActionBtn>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={12} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun outlier con i filtri correnti.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <ActionModalView
          modal={modal}
          onClose={closeModal}
          onSubmit={(kind, body) => submitAction({ consensusId: modal.row.id, kind, body })}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", right: 24, bottom: 24, padding: "10px 16px",
          borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: toast.kind === "ok" ? "#10b98122" : "#ef444422",
          border: `1px solid ${toast.kind === "ok" ? "#10b981" : "#ef4444"}`,
          color: toast.kind === "ok" ? "#6ee7b7" : "#fca5a5",
          zIndex: 1000,
        }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        border: "1px solid var(--admin-border)",
        background: "transparent",
        borderRadius: 6,
        padding: "4px 8px",
        marginLeft: 4,
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      {children}
    </button>
  );
}

function ActionModalView({
  modal,
  onClose,
  onSubmit,
}: {
  modal: ActionModal;
  onClose: () => void;
  onSubmit: (kind: ActionKind, body: Record<string, unknown>) => Promise<void>;
}) {
  const { row, kind } = modal;
  const [reason, setReason] = useState("");
  const [durationPreset, setDurationPreset] = useState<string>("30");
  // Default override value: mean of available non-kambi sources (same formula used by consensus)
  const _defaultMean = (() => {
    const vals = [row.twobet_odds, row.betfair_odds].filter((v): v is number => v != null && v > 0);
    if (vals.length === 0) return "";
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return m.toFixed(2);
  })();
  const [newOdds, setNewOdds] = useState<string>(_defaultMean);
  const [dismissType, setDismissType] = useState<string>("bug_kambi");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const duration =
    durationPreset === "permanent" ? null : Number(durationPreset);

  const title = {
    suspend: "Sospendi outcome manualmente",
    override: "Override quota outcome",
    restore: "Ripristina outcome",
    dismiss: "Dismiss outlier",
  }[kind];

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (kind === "suspend") {
        await onSubmit("suspend", {
          reason: reason || null,
          duration_minutes: duration,
        });
      } else if (kind === "override") {
        const n = Number(newOdds);
        if (!Number.isFinite(n) || n <= 1) {
          alert("La nuova quota deve essere > 1");
          return;
        }
        await onSubmit("override", {
          new_odds: n,
          reason: reason || null,
          duration_minutes: duration,
        });
      } else if (kind === "dismiss") {
        await onSubmit("dismiss", {
          dismiss_type: dismissType,
          notes: notes || null,
        });
      } else if (kind === "restore") {
        await onSubmit("restore", {});
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 900,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--admin-card)", border: "1px solid var(--admin-border)",
        borderRadius: 12, padding: 24, minWidth: 480, maxWidth: 600,
        boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--admin-text)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--admin-text-muted)", marginBottom: 16 }}>
          <strong>{row.home_team}</strong> vs {row.away_team} — {row.market_type} · <code>{row.outcome_name}</code>
          <div style={{ marginTop: 2 }}>
            Kambi <b style={{ color: "var(--admin-text)" }}>{Number(row.kambi_odds).toFixed(2)}</b>
            {" · "}22bet <b style={{ color: "var(--admin-text)" }}>{row.twobet_odds == null ? "—" : Number(row.twobet_odds).toFixed(2)}</b>
            {" · "}Betfair <b style={{ color: "var(--admin-text)" }}>{row.betfair_odds == null ? "—" : Number(row.betfair_odds).toFixed(2)}</b>
            {" — "}Δ vs media {row.delta_pct.toFixed(1)}%
          </div>
        </div>

        {kind === "override" && (
          <Field label="Nuova quota">
            <input
              type="number"
              value={newOdds}
              onChange={e => setNewOdds(e.target.value)}
              step="0.01"
              min="1.01"
              style={inputStyle}
              placeholder="Es. 1.85"
            />
            <div style={hintStyle}>
              Default = media(22bet, Betfair) delle quote disponibili. Deve essere &gt; 1.00
            </div>
          </Field>
        )}

        {(kind === "suspend" || kind === "override") && (
          <>
            <Field label="Motivo">
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                style={inputStyle}
                placeholder={kind === "suspend" ? "Es. Bug scraper Kambi" : "Es. Consensus outlier - value genuino"}
              />
            </Field>

            <Field label="Durata">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  ["30", "30 min"],
                  ["60", "1 ora"],
                  ["180", "3 ore"],
                  ["720", "12 ore"],
                  ["1440", "24 ore"],
                  ["permanent", "Permanente"],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setDurationPreset(val)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: `1px solid ${durationPreset === val ? "#8b5cf6" : "var(--admin-border)"}`,
                      background: durationPreset === val ? "#8b5cf622" : "transparent",
                      color: "var(--admin-text)",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}

        {kind === "dismiss" && (
          <>
            <Field label="Classificazione">
              <select value={dismissType} onChange={e => setDismissType(e.target.value)} style={inputStyle}>
                <option value="bug_kambi">Bug scraper Kambi</option>
                <option value="bug_22bet">Bug scraper 22bet</option>
                <option value="mismatch_normalization">Mismatch normalizzazione</option>
                <option value="value_genuine">Value bet genuino</option>
                <option value="other">Altro</option>
              </select>
              <div style={hintStyle}>
                bug_kambi / bug_22bet / mismatch_normalization crea un row in <code>normalization_issues</code> per follow-up.
              </div>
            </Field>

            <Field label="Note (opzionale)">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                style={{ ...inputStyle, minHeight: 80, fontFamily: "inherit" }}
                placeholder="Contesto, riproduzione del bug, evidenze…"
              />
            </Field>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} disabled={submitting} style={btnStyle("#475569")}>
            Annulla
          </button>
          <button onClick={handleSubmit} disabled={submitting} style={btnStyle(kind === "dismiss" ? "#10b981" : kind === "override" ? "#f97316" : "#ef4444")}>
            {submitting ? "Invio…" : "Conferma"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "var(--admin-text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--admin-border)",
  background: "var(--admin-bg)",
  color: "var(--admin-text)",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

const hintStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: "var(--admin-text-muted)",
};

// ─── UI primitives ───
const tdStyle: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ padding: "10px 12px", textAlign: align, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)", fontWeight: 700, letterSpacing: 0.5 }}>{children}</th>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--admin-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--admin-border)", background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 13, minWidth: 140 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function NumField({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--admin-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
      {label}
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))} step={step} min={min} max={max}
        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--admin-border)", background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 13, width: 90 }} />
    </label>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    background: bg,
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function timeAgo(iso: string): string {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return `${Math.floor(diff / 86400)}g fa`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
