"use client";

// E10 — tab + audit filters persisted in URL.
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";
import { Kpi, KpiRow } from "@/components/admin/ui";

type Tab = "suspended" | "overrides" | "expired" | "audit";

interface OverrideRow {
  outcome_id: string;
  outcome_name: string;
  live_odds: number;
  is_active: boolean;
  is_suspended: boolean;
  manual_suspended: boolean;
  manual_odds: number | null;
  manual_reason: string | null;
  manual_expires_at: string | null;
  manual_set_at: string | null;
  manual_set_by: string | null;
  market_id: string;
  market_type: string;
  market_line: number | null;
  event_id: string;
  home_team: string;
  away_team: string;
  event_starts_at: string;
  source: string;
  event_status: string;
  sport: string;
}

interface AuditRow {
  audit_id: number;
  outcome_id: string;
  action_type: string;
  old_value: any;
  new_value: any;
  reason: string | null;
  source: string;
  consensus_id: number | null;
  created_at: string;
  created_by: string | null;
  outcome_name: string;
  market_type: string;
  market_line: number | null;
  home_team: string;
  away_team: string;
  event_starts_at: string;
  event_source: string;
  sport: string;
}

interface Kpis {
  active_suspended: number;
  active_overrides: number;
  actions_last_24h: number;
}

export default function ManualOverridesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "var(--admin-text-muted, #94a3b8)" }}>Caricamento…</div>}>
      <ManualOverridesInner />
    </Suspense>
  );
}

function ManualOverridesInner() {
  const { filters, updateFilter } = useAdminFilters({
    tab: "suspended" as Tab,
    action: "",
    source: "",
  });
  const tab = filters.tab;
  const actionFilter = filters.action;
  const sourceFilter = filters.source;
  const setTab = (v: Tab) => updateFilter("tab", v);
  const setActionFilter = (v: string) => updateFilter("action", v);
  const setSourceFilter = (v: string) => updateFilter("source", v);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadKpis = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/manual-overrides?action=kpis`).then((r) => r.json());
      setKpis(r);
    } catch {}
  }, []);

  const loadTab = useCallback(
    async (t: Tab) => {
      setLoading(true);
      setError("");
      try {
        if (t === "audit") {
          const params = new URLSearchParams({ action: "audit", limit: "200" });
          if (actionFilter) params.set("action_type", actionFilter);
          if (sourceFilter) params.set("source", sourceFilter);
          const r = await fetch(`/api/admin/manual-overrides?${params}`).then((r) => r.json());
          if (r.error) throw new Error(r.error);
          setAuditRows(r.rows ?? []);
        } else if (t === "expired") {
          const r = await fetch(`/api/admin/manual-overrides?action=expired-recent&limit=200`).then((r) => r.json());
          if (r.error) throw new Error(r.error);
          setAuditRows(r.rows ?? []);
        } else {
          const key = t === "suspended" ? "active-suspended" : "active-overrides";
          const r = await fetch(`/api/admin/manual-overrides?action=${key}&limit=200`).then((r) => r.json());
          if (r.error) throw new Error(r.error);
          setRows(r.rows ?? []);
        }
      } catch (err: any) {
        setError(err.message ?? String(err));
      } finally {
        setLoading(false);
      }
    },
    [actionFilter, sourceFilter]
  );

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);
  useEffect(() => {
    loadTab(tab);
  }, [tab, loadTab]);

  const flashToast = (kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  };

  const quickRestore = async (outcomeId: string, label: string) => {
    if (!confirm(`Ripristinare outcome "${label}"? Cancella manual_suspended e manual_odds.`)) return;
    try {
      const res = await fetch(`/api/admin/outcomes/${outcomeId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      flashToast("ok", "Ripristinato");
      loadKpis();
      loadTab(tab);
    } catch (err: any) {
      flashToast("err", err.message ?? String(err));
    }
  };

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPIs — E9 shared primitive */}
      <KpiRow minWidth={180}>
        <Kpi label="Suspend attivi" value={kpis?.active_suspended ?? "—"} accent="#ef4444" />
        <Kpi label="Override attivi" value={kpis?.active_overrides ?? "—"} accent="#f97316" />
        <Kpi label="Azioni ultime 24h" value={kpis?.actions_last_24h ?? "—"} accent="#8b5cf6" />
      </KpiRow>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--admin-border)" }}>
        <TabBtn active={tab === "suspended"} onClick={() => setTab("suspended")}>
          🔴 Sospesi attivi {kpis?.active_suspended ? `(${kpis.active_suspended})` : ""}
        </TabBtn>
        <TabBtn active={tab === "overrides"} onClick={() => setTab("overrides")}>
          ⚙️ Override quota attivi {kpis?.active_overrides ? `(${kpis.active_overrides})` : ""}
        </TabBtn>
        <TabBtn active={tab === "expired"} onClick={() => setTab("expired")}>
          ⏱️ Scaduti (ultimi 7 giorni)
        </TabBtn>
        <TabBtn active={tab === "audit"} onClick={() => setTab("audit")}>
          📜 Audit log
        </TabBtn>
      </div>

      {error && (
        <div style={{ padding: 12, background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5" }}>{error}</div>
      )}

      {tab === "audit" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Select
            label="Action"
            value={actionFilter}
            onChange={setActionFilter}
            options={[
              { value: "", label: "Tutti" },
              { value: "suspend", label: "suspend" },
              { value: "override", label: "override" },
              { value: "restore", label: "restore" },
              { value: "auto_suspend", label: "auto_suspend" },
              { value: "auto_restore", label: "auto_restore" },
              { value: "expire", label: "expire" },
            ]}
          />
          <Select
            label="Source"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: "", label: "Tutti" },
              { value: "manual", label: "manual" },
              { value: "auto_consensus", label: "auto_consensus" },
              { value: "cron_expiry", label: "cron_expiry" },
            ]}
          />
        </div>
      )}

      {/* Table */}
      <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
        {(tab === "suspended" || tab === "overrides") && (
          <ActiveTable rows={rows} loading={loading} tab={tab} onRestore={quickRestore} />
        )}
        {(tab === "expired" || tab === "audit") && <AuditTable rows={auditRows} loading={loading} />}
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            right: 24,
            bottom: 24,
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: toast.kind === "ok" ? "#10b98122" : "#ef444422",
            border: `1px solid ${toast.kind === "ok" ? "#10b981" : "#ef4444"}`,
            color: toast.kind === "ok" ? "#6ee7b7" : "#fca5a5",
            zIndex: 1000,
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ActiveTable({
  rows,
  loading,
  tab,
  onRestore,
}: {
  rows: OverrideRow[];
  loading: boolean;
  tab: "suspended" | "overrides";
  onRestore: (id: string, label: string) => void;
}) {
  const showOdds = tab === "overrides";
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
          <Th>Evento</Th>
          <Th>Sport</Th>
          <Th>Mercato</Th>
          <Th>Outcome</Th>
          {showOdds && <Th align="right">Live</Th>}
          {showOdds && <Th align="right">Override</Th>}
          <Th>Motivo</Th>
          <Th>Set at</Th>
          <Th>Scade</Th>
          <Th align="right">Azioni</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.outcome_id} style={{ borderTop: "1px solid var(--admin-border)" }}>
            <td style={tdStyle}>
              <div style={{ fontWeight: 600, color: "var(--admin-text)" }}>{r.home_team}</div>
              <div style={{ color: "var(--admin-text-muted)", fontSize: 12 }}>
                vs {r.away_team} · <code>{r.source}</code>
              </div>
            </td>
            <td style={tdStyle}>{r.sport}</td>
            <td style={tdStyle}>
              {r.market_type}
              {r.market_line != null && (
                <span style={{ color: "var(--admin-text-muted)" }}> {r.market_line}</span>
              )}
            </td>
            <td style={tdStyle}>
              <code style={{ fontSize: 12 }}>{r.outcome_name}</code>
              {r.manual_suspended && <Badge color="#ef4444">SUSPEND</Badge>}
              {r.is_suspended && <Badge color="#64748b">scraper-susp</Badge>}
            </td>
            {showOdds && (
              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(r.live_odds).toFixed(2)}</td>
            )}
            {showOdds && (
              <td
                style={{
                  ...tdStyle,
                  textAlign: "right",
                  fontWeight: 700,
                  color: "#f97316",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {r.manual_odds != null ? Number(r.manual_odds).toFixed(2) : "—"}
              </td>
            )}
            <td style={{ ...tdStyle, color: "var(--admin-text-muted)", maxWidth: 260 }}>{r.manual_reason ?? "—"}</td>
            <td style={{ ...tdStyle, color: "var(--admin-text-muted)" }}>{r.manual_set_at ? timeAgo(r.manual_set_at) : "—"}</td>
            <td style={{ ...tdStyle, color: "var(--admin-text-muted)" }}>
              {r.manual_expires_at ? <ExpiryPill iso={r.manual_expires_at} /> : <span style={{ color: "#a78bfa" }}>permanente</span>}
            </td>
            <td style={{ ...tdStyle, textAlign: "right" }}>
              <button
                onClick={() => onRestore(r.outcome_id, `${r.home_team} vs ${r.away_team} · ${r.market_type} / ${r.outcome_name}`)}
                style={btnStyle("#10b981")}
              >
                ↩️ Ripristina
              </button>
            </td>
          </tr>
        ))}
        {!loading && rows.length === 0 && (
          <tr>
            <td colSpan={showOdds ? 10 : 8} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>
              Nessun override attivo.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function AuditTable({ rows, loading }: { rows: AuditRow[]; loading: boolean }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
          <Th>Quando</Th>
          <Th>Action</Th>
          <Th>Source</Th>
          <Th>Evento</Th>
          <Th>Mercato</Th>
          <Th>Outcome</Th>
          <Th>Diff manual_*</Th>
          <Th>Motivo / Ref</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.audit_id} style={{ borderTop: "1px solid var(--admin-border)" }}>
            <td style={{ ...tdStyle, color: "var(--admin-text-muted)", whiteSpace: "nowrap" }}>{timeAgo(r.created_at)}</td>
            <td style={tdStyle}>
              <Badge color={actionColor(r.action_type)}>{r.action_type}</Badge>
            </td>
            <td style={{ ...tdStyle, color: "var(--admin-text-muted)", fontSize: 12 }}>{r.source}</td>
            <td style={tdStyle}>
              <div style={{ fontWeight: 600, color: "var(--admin-text)" }}>{r.home_team}</div>
              <div style={{ color: "var(--admin-text-muted)", fontSize: 12 }}>vs {r.away_team}</div>
            </td>
            <td style={tdStyle}>{r.market_type}</td>
            <td style={tdStyle}>
              <code style={{ fontSize: 12 }}>{r.outcome_name}</code>
            </td>
            <td style={{ ...tdStyle, fontSize: 11, color: "var(--admin-text-muted)", maxWidth: 260 }}>
              <ValueDiff old={r.old_value} newVal={r.new_value} />
            </td>
            <td style={{ ...tdStyle, maxWidth: 300 }}>
              {r.reason && <div>{r.reason}</div>}
              {r.consensus_id && (
                <div style={{ fontSize: 11, color: "var(--admin-text-muted)" }}>
                  consensus #{r.consensus_id}
                </div>
              )}
            </td>
          </tr>
        ))}
        {!loading && rows.length === 0 && (
          <tr>
            <td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>
              Nessun audit entry.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function ValueDiff({ old: oldV, newVal }: { old: any; newVal: any }) {
  if (!oldV || !newVal) return <span>—</span>;
  const fields = ["manual_suspended", "manual_odds"] as const;
  const changes: string[] = [];
  for (const f of fields) {
    const a = oldV?.[f];
    const b = newVal?.[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push(`${f}: ${formatVal(a)} → ${formatVal(b)}`);
    }
  }
  if (changes.length === 0) return <span>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {changes.map((c, i) => (
        <code key={i} style={{ fontSize: 11 }}>
          {c}
        </code>
      ))}
    </div>
  );
}

function formatVal(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function actionColor(action: string): string {
  switch (action) {
    case "suspend":
    case "auto_suspend":
      return "#ef4444";
    case "override":
      return "#f97316";
    case "restore":
    case "auto_restore":
      return "#10b981";
    case "expire":
      return "#64748b";
    default:
      return "#8b5cf6";
  }
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        marginLeft: 6,
        padding: "1px 6px",
        borderRadius: 4,
        background: `${color}22`,
        border: `1px solid ${color}`,
        color,
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

function ExpiryPill({ iso }: { iso: string }) {
  const diff = new Date(iso).getTime() - Date.now();
  const expired = diff < 0;
  const mins = Math.abs(Math.round(diff / 60000));
  const label = expired
    ? `scaduto ${fmtMinsAgo(mins)}`
    : mins < 60
    ? `tra ${mins}m`
    : mins < 1440
    ? `tra ${Math.round(mins / 60)}h`
    : `tra ${Math.round(mins / 1440)}g`;
  return (
    <span style={{ color: expired ? "#ef4444" : "#10b981" }}>
      {label}
    </span>
  );
}

function fmtMinsAgo(mins: number): string {
  if (mins < 60) return `${mins}m fa`;
  if (mins < 1440) return `${Math.round(mins / 60)}h fa`;
  return `${Math.round(mins / 1440)}g fa`;
}

// ─── Primitives (match consensus page style) ───
const tdStyle: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        textAlign: align,
        fontSize: 11,
        textTransform: "uppercase",
        color: "var(--admin-text-muted)",
        fontWeight: 700,
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 16px",
        border: "none",
        background: "transparent",
        color: active ? "var(--admin-text)" : "var(--admin-text-muted)",
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
        borderBottom: `2px solid ${active ? "#8b5cf6" : "transparent"}`,
        marginBottom: -1,
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        fontSize: 11,
        color: "var(--admin-text-muted)",
        textTransform: "uppercase",
        fontWeight: 700,
      }}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid var(--admin-border)",
          background: "var(--admin-bg)",
          color: "var(--admin-text)",
          fontSize: 13,
          minWidth: 160,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    background: bg,
    color: "#fff",
    fontSize: 12,
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
