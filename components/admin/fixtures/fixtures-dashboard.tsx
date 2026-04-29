"use client";

// E6 — Fixtures ↔ Event Normalization bridge.
// - Dynamic sport KPIs from /api/admin/fixtures?action=sports (no hardcoded list).
// - KPI cards are the single source of filter for sport (dropdown removed).
// - be_match_id column rendered as link → Event Normalization filtered by flashscore_id.
// - Mapping count badge "N" shown next to be_match_id (from action=mapping_counts).
// - Status column (upcoming/live/finished) derived from match_date.
// - Date preset chips: Oggi / Domani / Weekend / 7 giorni / Tutto.
// - Search extended to team + league + country (API already ORs them).
// - Page-size selector 25/50/100/200.
// - All filters synced to URL via useAdminFilters (deep-linkable).

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useAdminFilters } from "@/lib/hooks/use-admin-filters";
import {
  PresetChip as SharedPresetChip,
  Pagination as SharedPagination,
} from "@/components/admin/ui";

interface FixtureRow {
  id: string;
  sport: string;
  country: string | null;
  league: string | null;
  home_team: string;
  away_team: string;
  match_date: string;
  be_match_id: string | null;
  updated_at: string;
}

interface Stats {
  total: number;
  by_sport: Record<string, number>;
  by_date: Record<string, number>;
  last_updated: string | null;
}

interface SportOption {
  sport: string;
  count: number;
}

interface LeagueOption {
  league: string;
  country: string | null;
  count: number;
}

// ═══ HELPERS ═══

const SPORT_ICONS: Record<string, string> = {
  football: "⚽",
  tennis: "🎾",
  basketball: "🏀",
  hockey: "🏒",
  volleyball: "🏐",
  handball: "🤾",
  baseball: "⚾",
  rugby: "🏉",
  snooker: "🎱",
  darts: "🎯",
  cricket: "🏏",
  esports: "🎮",
  tennis_tavolo: "🏓",
};

const SPORT_LABELS: Record<string, string> = {
  football: "Calcio",
  tennis: "Tennis",
  basketball: "Basket",
  hockey: "Hockey",
  volleyball: "Volley",
  handball: "Pallamano",
  baseball: "Baseball",
  rugby: "Rugby",
  snooker: "Snooker",
  darts: "Darts",
  cricket: "Cricket",
  esports: "Esports",
  tennis_tavolo: "Tennis Tavolo",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ora";
  if (mins < 60) return `${mins}m fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h fa`;
  return `${Math.floor(hours / 24)}g fa`;
}

// Derive upcoming/live/finished from match_date. Live window = ±4h from start.
type Status = "upcoming" | "live" | "finished";
function deriveStatus(matchDate: string): Status {
  const ts = new Date(matchDate).getTime();
  const now = Date.now();
  const diff = (now - ts) / 60000; // minutes
  if (diff < -10) return "upcoming";
  if (diff > 240) return "finished";
  return "live";
}

// Date preset → {from, to} ISO date strings
function presetRange(preset: string): { from: string; to: string } | null {
  const today = new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "today") {
    const d = toISO(today);
    return { from: d, to: d };
  }
  if (preset === "tomorrow") {
    const t = new Date(today);
    t.setDate(today.getDate() + 1);
    const d = toISO(t);
    return { from: d, to: d };
  }
  if (preset === "weekend") {
    // Next Sat-Sun (if today is Sat/Sun, cover current weekend).
    const dow = today.getDay(); // 0 Sun ... 6 Sat
    const sat = new Date(today);
    if (dow === 0) sat.setDate(today.getDate() - 1);
    else if (dow === 6) sat.setDate(today.getDate());
    else sat.setDate(today.getDate() + (6 - dow));
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    return { from: toISO(sat), to: toISO(sun) };
  }
  if (preset === "7d") {
    const end = new Date(today);
    end.setDate(today.getDate() + 7);
    return { from: toISO(today), to: toISO(end) };
  }
  return null;
}

// ═══ FETCH ═══

async function fetchApi(action: string, params: Record<string, string> = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/admin/fixtures?${sp}`, { signal });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Stats freshness SLA: Flashscore-scraper updates fixtures via daily cron.
// >24h since last update means we're likely missing new matches → autopilot
// degraded.
const FIXTURES_SLA_HOURS = 24;
function fixturesSlaStatus(lastUpdated: string | null): { stale: boolean; hoursAgo: number } {
  if (!lastUpdated) return { stale: true, hoursAgo: Infinity };
  const hoursAgo = (Date.now() - new Date(lastUpdated).getTime()) / 3600_000;
  return { stale: hoursAgo > FIXTURES_SLA_HOURS, hoursAgo };
}

// ═══ MAIN ═══

export default function FixturesDashboard() {
  return (
    <Suspense fallback={<div style={{ padding: 20, color: "var(--admin-text-muted, #94a3b8)" }}>Caricamento…</div>}>
      <FixturesDashboardInner />
    </Suspense>
  );
}

function FixturesDashboardInner() {
  const { filters, updateFilter, setFilters } = useAdminFilters({
    sport: "",
    league: "",
    date_preset: "",         // one of: today, tomorrow, weekend, 7d, custom, ""
    date_from: "",
    date_to: "",
    search: "",
    mapped: "",              // "" = all, "true" = solo mapped, "false" = solo unmapped
    page_size: 50,
    page: 1,
  });
  const selectedSport = filters.sport;
  const selectedLeague = filters.league;
  const datePreset = filters.date_preset;
  const dateFrom = filters.date_from;
  const dateTo = filters.date_to;
  const search = filters.search;
  const mappedFilter = filters.mapped;
  const pageSize = filters.page_size;
  const page = filters.page;

  const [stats, setStats] = useState<Stats | null>(null);
  const [sports, setSports] = useState<SportOption[]>([]);
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRow[]>([]);
  const [mappingCounts, setMappingCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);

  // Load stats + sports on mount, then refresh stats every 60s so the
  // "Aggiornato Xm fa" header reflects reality on a long-open tab.
  useEffect(() => {
    const loadOverview = () => {
      fetchApi("stats").then(setStats).catch(console.error);
      fetchApi("sports").then((r) => setSports(r.sports || [])).catch(console.error);
    };
    loadOverview();
    const interval = setInterval(loadOverview, 60_000);
    return () => clearInterval(interval);
  }, []);

  // When sport changes, reload leagues for that sport and clear league selection if orphaned
  useEffect(() => {
    if (!selectedSport) {
      setLeagues([]);
      if (selectedLeague) updateFilter("league", "");
      return;
    }
    fetchApi("leagues", { sport: selectedSport as string })
      .then((r) => setLeagues(r.leagues || []))
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport]);

  // Apply preset range whenever preset changes
  useEffect(() => {
    if (!datePreset || datePreset === "custom") return;
    const r = presetRange(datePreset as string);
    if (r && (r.from !== dateFrom || r.to !== dateTo)) {
      setFilters({ date_from: r.from, date_to: r.to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset]);

  // Review #6 P1-B: AbortController on the mapping_counts fetch. Pre-fix,
  // a fast filter change could let the previous mapping_counts response
  // arrive AFTER the new fixtures list, painting wrong badges on the table.
  const mappingAbortRef = useRef<AbortController | null>(null);

  const loadFixtures = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
      if (selectedSport) params.sport = selectedSport as string;
      if (selectedLeague) params.league = selectedLeague as string;
      if (dateFrom) params.date_from = dateFrom as string;
      if (dateTo) params.date_to = dateTo as string;
      if (search) params.search = search as string;
      if (mappedFilter) params.mapped = mappedFilter as string;
      const r = await fetchApi("list", params);
      const list: FixtureRow[] = r.fixtures || [];
      setFixtures(list);
      setTotal(r.total || 0);
      setPages(r.pages || 1);

      // Cancel any in-flight mapping_counts fetch and start a fresh one.
      mappingAbortRef.current?.abort();
      const ac = new AbortController();
      mappingAbortRef.current = ac;
      const ids = list.map((f) => f.be_match_id).filter(Boolean).join(",");
      if (ids) {
        fetchApi("mapping_counts", { ids }, ac.signal)
          .then((res) => {
            if (!ac.signal.aborted) setMappingCounts(res.counts ?? {});
          })
          .catch((e) => { if (e?.name !== "AbortError") console.error(e); });
      } else {
        setMappingCounts({});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedSport, selectedLeague, dateFrom, dateTo, search, mappedFilter, page, pageSize]);

  useEffect(() => { loadFixtures(); }, [loadFixtures]);
  useEffect(() => () => { mappingAbortRef.current?.abort(); }, []);

  // Reset page when filters (other than page/page_size) change
  useEffect(() => {
    updateFilter("page", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport, selectedLeague, dateFrom, dateTo, search, mappedFilter]);

  const setSport = (s: string) => updateFilter("sport", s);
  const setLeague = (l: string) => updateFilter("league", l);
  const setSearch = (v: string) => updateFilter("search", v);
  const setPageSize = (v: number) => setFilters({ page_size: v, page: 1 });
  const setPage = (v: number) => updateFilter("page", v);
  const applyPreset = (preset: string) => {
    if (preset === "all") {
      setFilters({ date_preset: "", date_from: "", date_to: "" });
    } else {
      setFilters({ date_preset: preset });
    }
  };
  const clearCustomDates = () => setFilters({ date_preset: "", date_from: "", date_to: "" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "18px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text, #e2e8f0)" }}>
          Fixtures
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {stats?.last_updated && (
            <span style={{ fontSize: 14, color: "var(--admin-text-muted, #94a3b8)" }}>
              Aggiornato: {timeAgo(stats.last_updated)} · {stats.total.toLocaleString("it-IT")} fixture in DB
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--admin-text-muted, #64748b)", background: "rgba(99,102,241,0.1)", padding: "3px 8px", borderRadius: 4 }}>
            Flashscore
          </span>
        </div>
      </div>

      {/* KPI bar — dynamic from /sports, click to filter (single source of sport filter) */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KpiCard
          label="Totale"
          value={stats?.total || 0}
          active={!selectedSport}
          onClick={() => setSport("")}
        />
        {sports.map((s) => (
          <KpiCard
            key={s.sport}
            label={`${SPORT_ICONS[s.sport] || ""} ${SPORT_LABELS[s.sport] || s.sport}`}
            value={s.count}
            active={selectedSport === s.sport}
            onClick={() => setSport(selectedSport === s.sport ? "" : s.sport)}
          />
        ))}
      </div>

      {/* Date preset chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 4 }}>
          Periodo:
        </span>
        {[
          { key: "today", label: "Oggi" },
          { key: "tomorrow", label: "Domani" },
          { key: "weekend", label: "Weekend" },
          { key: "7d", label: "7 giorni" },
          { key: "all", label: "Tutto" },
        ].map((p) => (
          <SharedPresetChip
            key={p.key}
            label={p.label}
            active={p.key === "all" ? !datePreset && !dateFrom : datePreset === p.key}
            onClick={() => applyPreset(p.key)}
          />
        ))}
        <span style={{ fontSize: 12, color: "var(--admin-text-muted, #64748b)" }}>oppure</span>
        <input type="date" value={dateFrom as string} onChange={(e) => setFilters({ date_from: e.target.value, date_preset: "custom" })} style={inputStyle} />
        <span style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>→</span>
        <input type="date" value={dateTo as string} onChange={(e) => setFilters({ date_to: e.target.value, date_preset: "custom" })} style={inputStyle} />
        {(dateFrom || dateTo) && (
          <button onClick={clearCustomDates} style={clearBtnStyle} title="Rimuovi filtro date">✕</button>
        )}
      </div>

      {/* Filters row */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "14px 24px",
        display: "flex",
        gap: 18,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        {leagues.length > 0 && (
          <FilterSelect
            label="Lega"
            value={selectedLeague as string}
            onChange={setLeague}
            options={[
              { value: "", label: `Tutte (${leagues.length})` },
              ...leagues.map((l) => ({
                value: l.league,
                label: `${l.country ? l.country + " · " : ""}${l.league} (${l.count})`,
              })),
            ]}
          />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 240px" }}>
          <input
            type="text"
            placeholder="Cerca squadra, lega o paese…"
            value={search as string}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>
        <FilterSelect
          label="Per pagina"
          value={String(pageSize)}
          onChange={(v) => setPageSize(parseInt(v, 10))}
          options={[
            { value: "25", label: "25" },
            { value: "50", label: "50" },
            { value: "100", label: "100" },
            { value: "200", label: "200" },
          ]}
        />
      </div>

      {/* Table */}
      <div style={{ background: "var(--admin-card, #0f1f35)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
                {["Data", "Ora", "Stato", "Sport", "Paese", "Campionato", "Casa", "Trasferta", "FS ID", "Mappati"].map((h) => (
                  <th key={h} style={{
                    padding: "10px 12px", textAlign: "left", fontSize: 11,
                    fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
                    color: "var(--admin-text-muted, #94a3b8)", whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && fixtures.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 48, textAlign: "center", fontSize: 14, color: "var(--admin-text-muted, #94a3b8)" }}>
                    Caricamento…
                  </td>
                </tr>
              ) : fixtures.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 48, textAlign: "center", fontSize: 14, color: "var(--admin-text-muted, #94a3b8)" }}>
                    Nessuna fixture trovata
                  </td>
                </tr>
              ) : (
                fixtures.map((f) => {
                  const status = deriveStatus(f.match_date);
                  const count = f.be_match_id ? mappingCounts[f.be_match_id] ?? 0 : 0;
                  return (
                    <tr key={f.id} style={{ borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
                      <td style={cellStyle}>{formatDate(f.match_date)}</td>
                      <td style={cellStyle}>{formatTime(f.match_date)}</td>
                      <td style={cellStyle}><StatusPill status={status} /></td>
                      <td style={cellStyle}>
                        <span title={SPORT_LABELS[f.sport] || f.sport} style={{ fontSize: 16 }}>
                          {SPORT_ICONS[f.sport] || f.sport}
                        </span>
                      </td>
                      <td style={{ ...cellStyle, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.country || "-"}
                      </td>
                      <td style={{ ...cellStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.league || "-"}
                      </td>
                      <td style={{ ...cellStyle, fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{f.home_team}</td>
                      <td style={{ ...cellStyle, fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{f.away_team}</td>
                      <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: 12 }}>
                        {f.be_match_id ? (
                          <span style={{ color: "#8b5cf6" }}>{f.be_match_id}</span>
                        ) : (
                          <span style={{ color: "var(--admin-text-muted, #64748b)" }}>—</span>
                        )}
                      </td>
                      <td style={cellStyle}>
                        {f.be_match_id ? (
                          <a
                            href={`/admin/event-normalization?flashscore_id=${encodeURIComponent(f.be_match_id)}`}
                            title={count > 0 ? `${count} eventi scraper mappati — apri Event Normalization` : "Nessun evento mappato — apri Event Normalization"}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              padding: "2px 10px", borderRadius: 999,
                              background: count > 0 ? "#10b98118" : "rgba(100,116,139,0.15)",
                              border: `1px solid ${count > 0 ? "#10b98166" : "var(--admin-border, #1e3a5f)"}`,
                              color: count > 0 ? "#10b981" : "var(--admin-text-muted, #94a3b8)",
                              fontSize: 12, fontWeight: 700, textDecoration: "none",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {count}
                            <span style={{ fontSize: 10 }}>→</span>
                          </a>
                        ) : (
                          <span style={{ color: "var(--admin-text-muted, #64748b)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — E9 shared primitive */}
        {pages > 1 && (
          <div style={{ padding: "14px 20px", borderTop: "1px solid var(--admin-border, #1e3a5f)" }}>
            <SharedPagination page={page as number} totalPages={pages} onPage={setPage} totalRows={total} />
          </div>
        )}
      </div>

      {/* Footer info — last_updated only (total already in header, no dupe) */}
      {stats?.last_updated && (
        <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)", textAlign: "right", padding: "4px 8px" }}>
          Aggiornato {formatDateTime(stats.last_updated)}{loading && " · Caricamento…"}
        </div>
      )}
    </div>
  );
}


// ═══ STYLES ═══

const inputStyle: React.CSSProperties = {
  background: "var(--admin-bg, #0a1929)",
  border: "1px solid var(--admin-border, #1e3a5f)",
  borderRadius: 4,
  color: "var(--admin-text, #e2e8f0)",
  padding: "7px 10px",
  fontSize: 13,
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  whiteSpace: "nowrap",
  color: "var(--admin-text-muted, #94a3b8)",
  fontSize: 13,
};

const clearBtnStyle: React.CSSProperties = {
  padding: "5px 10px",
  background: "transparent",
  border: "1px solid var(--admin-border, #1e3a5f)",
  color: "var(--admin-text-muted, #94a3b8)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};

// ═══ SUB-COMPONENTS ═══

function KpiCard({ label, value, active, onClick }: {
  label: string; value: number; active?: boolean; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? "rgba(37, 99, 235, 0.15)" : "var(--admin-card, #0f1f35)",
        border: `1px solid ${active ? "#2563eb" : "var(--admin-border, #1e3a5f)"}`,
        borderRadius: 8,
        padding: "12px 18px",
        minWidth: 100,
        cursor: onClick ? "pointer" : "default",
        textAlign: "center",
        transition: "border-color 0.15s",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--admin-text, #e2e8f0)", fontVariantNumeric: "tabular-nums" }}>
        {value.toLocaleString("it-IT")}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}


function StatusPill({ status }: { status: Status }) {
  const cfg: Record<Status, { color: string; label: string }> = {
    upcoming: { color: "#64748b", label: "Attesa" },
    live:     { color: "#22c55e", label: "Live" },
    finished: { color: "#ef4444", label: "Finita" },
  };
  const c = cfg[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "1px 8px", borderRadius: 4,
      fontSize: 10, fontWeight: 700, textTransform: "uppercase",
      color: c.color, background: `${c.color}22`, border: `1px solid ${c.color}55`,
    }}>
      {status === "live" && <span style={{ width: 5, height: 5, borderRadius: "50%", background: c.color, boxShadow: `0 0 4px ${c.color}` }} />}
      {c.label}
    </span>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)" }}>
        {label}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--admin-bg, #0a1929)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 4,
          color: "var(--admin-text, #e2e8f0)",
          padding: "7px 10px",
          fontSize: 13,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

