"use client";

// E4 — Market Explorer (previously "Market Catalog").
// Two tabs:
//   - Explorer: sport → event → cross-source odds table (legacy column layout
//     preserved; columns currently bound to legacy source keys for backward
//     compatibility — to be repointed to flashscore/odds-api in a future pass).
//   - Dictionary: legacy source group/outcome dictionary (preserved as
//     read-only secondary tab; underlying DB tables still exist).

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";
import { Kpi as SharedKpi, KpiRow } from "@/components/admin/ui";

// ═══ TYPES ═══

interface GroupRow { twobet_g: number; name_it: string; outcome_count: number; updated_at: string; }
interface OutcomeRow { twobet_t: number; twobet_g: number; name_template_it: string; }
interface Stats {
  groups: number;
  outcomes: number;
  normalization_rows: number;
  last_sync: { at: string; groups_upserted: number; outcomes_upserted: number; duration_ms: number; bundle_bytes: number } | null;
  sports: { sport_slug: string; sport_name: string; groups_used: number }[];
}

interface SportOpt { id: string; slug: string; name: string; }
interface EventOpt { flashscore_id: string; home_team: string; away_team: string; starts_at: string; sources: string[]; }
interface OutcomeOdds { name: string; kambi: number | null; twobet: number | null; betfair: number | null; }
interface MarketBucket { canonical_key: string; canonical_name_it: string; period: string | null; handicap: number | null; outcomes: OutcomeOdds[]; }

// ═══ PAGE ═══

export default function MarketExplorerPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "var(--admin-text-muted)" }}>Caricamento…</div>}>
      <MarketExplorerContent />
    </Suspense>
  );
}

function MarketExplorerContent() {
  const { filters, updateFilter } = useAdminFilters({
    tab: "explorer" as "explorer" | "dictionary",
  });
  const tab = filters.tab;

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--admin-text)", margin: 0 }}>
          Market Explorer
        </h1>
        <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 4, marginBottom: 0 }}>
          Esplora mercati e quote cross-source per evento; seconda scheda è il dizionario legacy.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--admin-border)" }}>
        <TabButton label="Explorer" active={tab === "explorer"} onClick={() => updateFilter("tab", "explorer")} />
        <TabButton label="Dizionario (legacy)" active={tab === "dictionary"} onClick={() => updateFilter("tab", "dictionary")} />
      </div>

      {tab === "explorer" ? <ExplorerTab /> : <DictionaryTab />}
    </div>
  );
}

// ═══ EXPLORER TAB ═══

function ExplorerTab() {
  const { filters, setFilters, updateFilter } = useAdminFilters({
    sport_id: "",
    flashscore_id: "",
  });
  const sportId = filters.sport_id;
  const flashscoreId = filters.flashscore_id;

  const [sports, setSports] = useState<SportOpt[]>([]);
  const [events, setEvents] = useState<EventOpt[]>([]);
  const [markets, setMarkets] = useState<MarketBucket[]>([]);
  const [loadingSports, setLoadingSports] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [error, setError] = useState("");

  // Load sports on mount
  useEffect(() => {
    fetch("/api/admin/market-catalog?action=sports")
      .then((r) => r.json())
      .then((r) => { if (r.error) setError(r.error); else setSports(r.sports ?? []); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingSports(false));
  }, []);

  // Load events when sport changes
  useEffect(() => {
    if (!sportId) { setEvents([]); return; }
    setLoadingEvents(true);
    setError("");
    fetch(`/api/admin/market-catalog?action=events&sport_id=${sportId}`)
      .then((r) => r.json())
      .then((r) => { if (r.error) setError(r.error); else setEvents(r.events ?? []); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingEvents(false));
  }, [sportId]);

  // Load markets when event changes
  useEffect(() => {
    if (!flashscoreId) { setMarkets([]); return; }
    setLoadingMarkets(true);
    setError("");
    fetch(`/api/admin/market-catalog?action=event_markets&flashscore_id=${encodeURIComponent(flashscoreId as string)}`)
      .then((r) => r.json())
      .then((r) => {
        if (r.error) setError(r.error);
        else setMarkets((r.markets ?? []).sort((a: MarketBucket, b: MarketBucket) => {
          // Sort: canonical_keys first (non-raw:), then by handicap, then by name
          const aRaw = a.canonical_key.startsWith("raw:");
          const bRaw = b.canonical_key.startsWith("raw:");
          if (aRaw !== bRaw) return aRaw ? 1 : -1;
          return a.canonical_name_it.localeCompare(b.canonical_name_it);
        }));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingMarkets(false));
  }, [flashscoreId]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.flashscore_id === flashscoreId),
    [events, flashscoreId]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Drill-down controls */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: 12, border: "1px solid var(--admin-border)", borderRadius: 10, background: "var(--admin-card)" }}>
        <label style={labelStyle}>Sport</label>
        <select
          value={sportId as string}
          onChange={(e) => setFilters({ sport_id: e.target.value, flashscore_id: "" })}
          style={selectStyle}
          disabled={loadingSports}
        >
          <option value="">{loadingSports ? "Caricamento…" : `Scegli sport (${sports.length})`}</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <label style={labelStyle}>Evento</label>
        <select
          value={flashscoreId as string}
          onChange={(e) => updateFilter("flashscore_id", e.target.value)}
          style={{ ...selectStyle, minWidth: 340 }}
          disabled={!sportId || loadingEvents}
        >
          <option value="">
            {!sportId ? "Seleziona sport prima" : loadingEvents ? "Caricamento eventi…" : `Scegli evento (${events.length})`}
          </option>
          {events.map((e) => (
            <option key={e.flashscore_id} value={e.flashscore_id}>
              {fmtStart(e.starts_at)} · {e.home_team} vs {e.away_team} [{e.sources.join(",")}]
            </option>
          ))}
        </select>

        {flashscoreId && (
          <button onClick={() => updateFilter("flashscore_id", "")} style={btnStyle("#334155")}>Pulisci</button>
        )}
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}

      {/* Markets cross-source table */}
      {!flashscoreId && <div style={emptyStyle}>Seleziona uno sport e un evento per vedere le quote cross-source.</div>}
      {flashscoreId && loadingMarkets && <div style={emptyStyle}>Caricamento mercati…</div>}
      {flashscoreId && !loadingMarkets && markets.length === 0 && (
        <div style={emptyStyle}>Nessun mercato attivo trovato per questo evento.</div>
      )}
      {flashscoreId && markets.length > 0 && (
        <div>
          {selectedEvent && (
            <div style={{ marginBottom: 10, fontSize: 13, color: "var(--admin-text-muted)" }}>
              Evento: <strong style={{ color: "var(--admin-text)" }}>{selectedEvent.home_team} vs {selectedEvent.away_team}</strong>
              {" "}· Fonti: {selectedEvent.sources.map((s) => <SourceDot key={s} source={s} />)}
              {" "}· <code style={{ color: "#06b6d4" }}>{flashscoreId}</code>
            </div>
          )}
          <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                  <Th>Canonical key</Th>
                  <Th>Nome (IT)</Th>
                  <Th>Periodo</Th>
                  <Th align="right">Handicap</Th>
                  <Th>Outcome</Th>
                  <Th align="right">Kambi</Th>
                  <Th align="right">22bet</Th>
                  <Th align="right">Betfair</Th>
                </tr>
              </thead>
              <tbody>
                {markets.flatMap((m) =>
                  m.outcomes.map((o, idx) => (
                    <tr key={`${m.canonical_key}-${m.handicap ?? ""}-${m.period ?? ""}-${o.name}`} style={{ borderTop: "1px solid var(--admin-border)" }}>
                      {idx === 0 ? (
                        <>
                          <td rowSpan={m.outcomes.length} style={{ ...tdStyle, verticalAlign: "top", fontFamily: "monospace", fontSize: 11, color: m.canonical_key.startsWith("raw:") ? "var(--admin-text-muted)" : "#8b5cf6" }}>
                            {m.canonical_key.startsWith("raw:") ? m.canonical_key.replace("raw:", "⚠ ") : m.canonical_key}
                          </td>
                          <td rowSpan={m.outcomes.length} style={{ ...tdStyle, verticalAlign: "top", fontWeight: 600 }}>{m.canonical_name_it}</td>
                          <td rowSpan={m.outcomes.length} style={{ ...tdStyle, verticalAlign: "top", color: "var(--admin-text-muted)" }}>{m.period ?? "—"}</td>
                          <td rowSpan={m.outcomes.length} style={{ ...tdStyle, verticalAlign: "top", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.handicap ?? "—"}</td>
                        </>
                      ) : null}
                      <td style={tdStyle}>{o.name}</td>
                      <OddsCell v={o.kambi} source="kambi" />
                      <OddsCell v={o.twobet} source="22bet" />
                      <OddsCell v={o.betfair} source="betfair" />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ DICTIONARY TAB (preserved legacy source dictionary) ═══

function DictionaryTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [expanded, setExpanded] = useState<Record<number, OutcomeRow[] | "loading">>({});
  const [q, setQ] = useState("");
  const [sport, setSport] = useState("");
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [error, setError] = useState("");

  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => setDebouncedQ(q), 300);
    return () => { if (qTimer.current) clearTimeout(qTimer.current); };
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ action: "groups", limit: String(limit) });
      if (debouncedQ) params.set("q", debouncedQ);
      if (sport) params.set("sport", sport);
      const [g, s] = await Promise.all([
        fetch(`/api/admin/market-catalog?${params}`).then((r) => r.json()),
        fetch(`/api/admin/market-catalog?action=stats`).then((r) => r.json()),
      ]);
      setGroups(g.rows ?? []);
      setStats(s);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, sport, limit]);

  useEffect(() => { load(); }, [load]);

  const toggleGroup = async (g: number) => {
    if (expanded[g]) {
      setExpanded((prev) => { const cp = { ...prev }; delete cp[g]; return cp; });
      return;
    }
    setExpanded((prev) => ({ ...prev, [g]: "loading" }));
    try {
      const r = await fetch(`/api/admin/market-catalog?action=outcomes&g=${g}`).then((r) => r.json());
      setExpanded((prev) => ({ ...prev, [g]: r.rows ?? [] }));
    } catch {
      setExpanded((prev) => { const cp = { ...prev }; delete cp[g]; return cp; });
    }
  };

  const triggerSync = async () => {
    setSyncing(true);
    setError("");
    setSyncToast(null);
    try {
      const r = await fetch(`/api/admin/market-catalog?action=sync`, { method: "POST" }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setSyncToast(`Sync completato: ${r.groups_upserted ?? 0} gruppi, ${r.outcomes_upserted ?? 0} outcomes in ${r.duration_ms ?? 0}ms.`);
      setTimeout(() => setSyncToast(null), 5000);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPIs — E9 shared primitive */}
      <KpiRow minWidth={180}>
        <SharedKpi label="Gruppi (legacy)" value={stats?.groups ?? "—"} accent="#f97316" sub="template del dizionario" />
        <SharedKpi label="Outcomes" value={stats?.outcomes ?? "—"} accent="#f97316" sub="template del dizionario" />
        <SharedKpi
          label="Righe normalizzazione"
          value={stats?.normalization_rows ?? "—"}
          accent="#8b5cf6"
          href="/admin/market-normalization"
        />
        <SharedKpi
          label="Ultimo sync"
          value={stats?.last_sync?.at ? timeAgo(stats.last_sync.at) : "mai"}
          sub={stats?.last_sync ? `${(stats.last_sync.bundle_bytes / 1024).toFixed(0)} KB · cron ogni 20 min` : "cron ogni 20 min"}
        />
      </KpiRow>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, border: "1px solid var(--admin-border)", borderRadius: 10, background: "var(--admin-card)", flexWrap: "wrap" }}>
        <select value={sport} onChange={(e) => setSport(e.target.value)} style={selectStyle}>
          <option value="">Tutti gli sport ({stats?.groups ?? 0})</option>
          {(stats?.sports ?? []).map((s) => (
            <option key={s.sport_slug} value={s.sport_slug}>{s.sport_name} ({s.groups_used})</option>
          ))}
        </select>
        <input
          placeholder="Cerca nome mercato (debounce 300ms)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 13 }}
        />
        <select value={String(limit)} onChange={(e) => setLimit(parseInt(e.target.value, 10))} style={selectStyle}>
          <option value="50">50 per pagina</option>
          <option value="100">100 per pagina</option>
          <option value="200">200 per pagina</option>
          <option value="500">500 per pagina</option>
        </select>
        <button onClick={triggerSync} disabled={syncing} style={btnStyle("#f97316")}>
          {syncing ? "Sync…" : "Aggiorna dizionario (legacy)"}
        </button>
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}
      {syncToast && (
        <div style={{ padding: 10, background: "rgba(16,185,129,0.1)", border: "1px solid #10b981", borderRadius: 8, color: "#10b981", fontSize: 13 }}>
          ✓ {syncToast}
        </div>
      )}

      <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
              <Th style={{ width: 80 }}>G</Th>
              <Th>Nome mercato (IT)</Th>
              <Th align="right" style={{ width: 140 }}>Outcomes template</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRowView key={g.twobet_g} row={g} outcomes={expanded[g.twobet_g]} onToggle={() => toggleGroup(g.twobet_g)} />
            ))}
            {!loading && groups.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 32, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun gruppo. {stats?.groups === 0 && 'Clicca "Aggiorna dizionario (legacy)".'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRowView({ row, outcomes, onToggle }: { row: GroupRow; outcomes: OutcomeRow[] | "loading" | undefined; onToggle: () => void }) {
  const open = !!outcomes;
  return (
    <>
      <tr style={{ borderTop: "1px solid var(--admin-border)", cursor: "pointer" }} onClick={onToggle}>
        <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#f97316" }}>{open ? "▼" : "▶"} {row.twobet_g}</td>
        <td style={{ padding: "10px 12px", fontWeight: 500 }}>{row.name_it}</td>
        <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--admin-text-muted)", fontVariantNumeric: "tabular-nums" }}>{row.outcome_count}</td>
      </tr>
      {open && outcomes !== "loading" && outcomes && outcomes.length > 0 && (
        <tr>
          <td colSpan={3} style={{ padding: "0 24px 12px", background: "rgba(255,255,255,0.02)" }}>
            <table style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--admin-text-muted)", fontSize: 10, textTransform: "uppercase", width: 100 }}>T code</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "var(--admin-text-muted)", fontSize: 10, textTransform: "uppercase" }}>Outcome template</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.twobet_t}>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace", color: "var(--admin-text-muted)" }}>{o.twobet_t}</td>
                    <td style={{ padding: "4px 8px" }}>{o.name_template_it}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
      {open && outcomes === "loading" && (
        <tr><td colSpan={3} style={{ padding: 12, textAlign: "center", color: "var(--admin-text-muted)", fontSize: 12 }}>Caricamento…</td></tr>
      )}
    </>
  );
}

// ═══ SHARED ═══

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 18px",
        borderBottom: active ? "2px solid #8b5cf6" : "2px solid transparent",
        background: "transparent",
        border: "none",
        color: active ? "var(--admin-text)" : "var(--admin-text-muted)",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Th({ children, align = "left", style }: { children: React.ReactNode; align?: "left" | "right" | "center"; style?: React.CSSProperties }) {
  return <th style={{ padding: "10px 12px", textAlign: align, fontSize: 11, textTransform: "uppercase", color: "var(--admin-text-muted)", fontWeight: 700, letterSpacing: 0.5, ...style }}>{children}</th>;
}

function OddsCell({ v, source }: { v: number | null; source: string }) {
  const color = source === "kambi" ? "#8b5cf6" : source === "22bet" ? "#f97316" : "#eab308";
  return (
    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: v != null ? color : "var(--admin-text-muted)", fontWeight: v != null ? 700 : 400 }}>
      {v != null ? v.toFixed(2) : "—"}
    </td>
  );
}

function SourceDot({ source }: { source: string }) {
  const color = source === "kambi" ? "#8b5cf6" : source === "22bet" ? "#f97316" : source === "betfair" ? "#eab308" : "#64748b";
  return (
    <span style={{ display: "inline-block", padding: "1px 6px", marginLeft: 4, borderRadius: 4, fontSize: 9, fontWeight: 700, color, background: `${color}22`, border: `1px solid ${color}55`, textTransform: "uppercase" }}>
      {source}
    </span>
  );
}

function fmtStart(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return `${Math.floor(diff / 86400)}g fa`;
}

// ═══ STYLES ═══

const tdStyle: React.CSSProperties = { padding: "6px 10px", color: "var(--admin-text)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--admin-text-muted)", letterSpacing: 0.5 };
const selectStyle: React.CSSProperties = { padding: "7px 10px", border: "1px solid var(--admin-border)", borderRadius: 6, background: "var(--admin-bg)", color: "var(--admin-text)", fontSize: 12, minWidth: 200 };
const emptyStyle: React.CSSProperties = { padding: 24, textAlign: "center", color: "var(--admin-text-muted)", border: "1px dashed var(--admin-border)", borderRadius: 10 };
const errorBoxStyle: React.CSSProperties = { padding: 12, background: "#ef444420", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5", fontSize: 12 };

function btnStyle(bg: string): React.CSSProperties {
  return { padding: "7px 14px", borderRadius: 6, border: "none", background: bg, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" };
}
