"use client";

import { useEffect, useState, useCallback } from "react";

// ═══ TYPES ═══

interface MatchingStats {
  total: number;
  matched: number;
  unmatched: number;
  percentage: number;
}

interface UnmatchedEvent {
  id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  status: string;
  starts_at: string;
  score_home: number | null;
  score_away: number | null;
  sports: { name: string };
}

interface FsSearchResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  scoreHome?: number;
  scoreAway?: number;
  status?: string;
  timestamp?: number;
  country?: string;
  league?: string;
  sport?: string;
}

interface DebugCandidate {
  fsId: string;
  fsHome: string;
  fsAway: string;
  fsTimestamp: number;
  homeScore: number;
  awayScore: number;
  combined: number;
  timeDelta: number;
  failReason: string;
  homeNorm: string;
  awayNorm: string;
  fsHomeNorm: string;
  fsAwayNorm: string;
  homeMethod: string;
  awayMethod: string;
}

interface DebugResult {
  event: {
    id: string;
    home_team: string;
    away_team: string;
    sport: string;
    starts_at: string;
    source: string;
    status: string;
  };
  candidates: DebugCandidate[];
  bestCandidate: DebugCandidate | null;
  suggestion: string;
}

interface DebugSummary {
  nearMiss: number;
  noCandidates: number;
  timeMismatch: number;
  aliasNeeded: number;
}

interface AliasEntry {
  id: number;
  canonical: string;
  alias: string;
  created_at: string;
}

type Tab = "overview" | "unmatched" | "search" | "debug";

// ═══ HELPERS ═══

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDelta(seconds: number): string {
  if (!isFinite(seconds)) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function scoreColor(score: number): string {
  if (score >= 1.0) return "#fbbf24"; // yellow — near-match
  if (score >= 0.5) return "#f97316"; // orange — partial
  return "#ef4444"; // red — poor
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const colors: Record<string, string> = {
    prematch: "#3b82f6",
    live: "#ef4444",
    finished: "#6b7280",
    ended: "#4b5563",
  };
  return (
    <span
      style={{
        background: colors[s] || "#6b7280",
        color: "#fff",
        padding: "3px 10px",
        borderRadius: "4px",
        fontSize: "13px",
        fontWeight: 600,
        textTransform: "uppercase",
      }}
    >
      {status}
    </span>
  );
}

function SuggestionBadge({ suggestion }: { suggestion: string }) {
  const config: Record<string, { bg: string; label: string }> = {
    lower_threshold: { bg: "#fbbf24", label: "Soglia" },
    add_alias: { bg: "#f97316", label: "Alias" },
    time_window: { bg: "#8b5cf6", label: "Tempo" },
    no_data: { bg: "#6b7280", label: "No dati" },
  };
  const c = config[suggestion] || config.no_data;
  return (
    <span style={{ background: c.bg, color: "#fff", padding: "3px 10px", borderRadius: 4, fontSize: 13, fontWeight: 600, textTransform: "uppercase" }}>
      {c.label}
    </span>
  );
}

// ═══ SHARED STYLES ═══

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  borderBottom: "1px solid var(--admin-border, #1e3a5f)",
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  color: "var(--admin-muted, #94a3b8)",
};

const TD_STYLE: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--admin-border, #1e3a5f)",
  fontSize: 15,
};

const BTN_PRIMARY: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  padding: "8px 18px",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const BTN_SUCCESS: React.CSSProperties = {
  background: "#10b981",
  color: "#fff",
  border: "none",
  padding: "8px 18px",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const BTN_DANGER: React.CSSProperties = {
  background: "transparent",
  color: "#ef4444",
  border: "1px solid #ef4444",
  padding: "5px 12px",
  borderRadius: 4,
  fontSize: 13,
  cursor: "pointer",
};

const INPUT_STYLE: React.CSSProperties = {
  background: "var(--admin-card, #0d2137)",
  color: "var(--admin-text, #e2e8f0)",
  border: "1px solid var(--admin-border, #1e3a5f)",
  padding: "8px 14px",
  borderRadius: 4,
  fontSize: 15,
};

// ═══ DASHBOARD ═══

export default function EventMatchingDashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<MatchingStats | null>(null);
  const [events, setEvents] = useState<UnmatchedEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(0);
  const [sportFilter, setSportFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FsSearchResult[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<UnmatchedEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoMatchResult, setAutoMatchResult] = useState<string | null>(null);
  const [recentMatches, setRecentMatches] = useState<any[]>([]);

  // Debug state
  const [debugResults, setDebugResults] = useState<DebugResult[]>([]);
  const [debugSummary, setDebugSummary] = useState<DebugSummary | null>(null);
  const [debugSportFilter, setDebugSportFilter] = useState("");
  const [debugStatusFilter, setDebugStatusFilter] = useState("");
  const [debugSuggestionFilter, setDebugSuggestionFilter] = useState("");
  const [debugLoading, setDebugLoading] = useState(false);
  const [aliasDialog, setAliasDialog] = useState<{ canonical: string; alias: string } | null>(null);
  const [expandedDebugRow, setExpandedDebugRow] = useState<string | null>(null);

  // ── API helper ──
  const apiCall = useCallback(async (body: any) => {
    const res = await fetch("/api/admin/event-matching", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }, []);

  // ── Load stats ──
  const loadStats = useCallback(async () => {
    const data = await apiCall({ action: "stats" });
    setStats({
      total: data.total,
      matched: data.matched,
      unmatched: data.unmatched,
      percentage: data.percentage,
    });
    setRecentMatches(data.recentMatches || []);
  }, [apiCall]);

  // ── Load unmatched events ──
  const loadEvents = useCallback(async () => {
    setLoading(true);
    const data = await apiCall({
      action: "unmatched-events",
      sport: sportFilter || undefined,
      status: statusFilter || undefined,
      page: eventsPage,
    });
    setEvents(data.events || []);
    setEventsTotal(data.total || 0);
    setLoading(false);
  }, [apiCall, sportFilter, statusFilter, eventsPage]);

  // ── Search Flashscore ──
  const doSearch = useCallback(async () => {
    if (searchQuery.length < 2) return;
    setLoading(true);
    const data = await apiCall({ action: "search-fs", query: searchQuery });
    setSearchResults(data.results || []);
    setLoading(false);
  }, [apiCall, searchQuery]);

  // ── Match event ──
  const doMatch = useCallback(
    async (eventId: string, flashscoreId: string) => {
      await apiCall({ action: "match", eventId, flashscoreId });
      loadStats();
      loadEvents();
      setSelectedEvent(null);
    },
    [apiCall, loadStats, loadEvents]
  );

  // ── Unmatch event ──
  const doUnmatch = useCallback(
    async (eventId: string) => {
      await apiCall({ action: "unmatch", eventId });
      loadStats();
    },
    [apiCall, loadStats]
  );

  // ── Auto-match ──
  const doAutoMatch = useCallback(async () => {
    setLoading(true);
    setAutoMatchResult(null);
    const data = await apiCall({ action: "auto-match" });
    setAutoMatchResult(
      `Auto-match: ${data.matched} eventi matchati su ${data.sports_processed} sport` +
        (data.errors?.length ? ` (${data.errors.length} errori)` : "")
    );
    loadStats();
    loadEvents();
    setLoading(false);
  }, [apiCall, loadStats, loadEvents]);

  // ── Debug matching ──
  const loadDebug = useCallback(async () => {
    setDebugLoading(true);
    const data = await apiCall({
      action: "debug-matching",
      sport: debugSportFilter || undefined,
      status: debugStatusFilter || undefined,
      limit: 50,
    });
    setDebugResults(data.results || []);
    setDebugSummary(data.summary || null);
    setDebugLoading(false);
  }, [apiCall, debugSportFilter, debugStatusFilter]);

  // ── Save alias ──
  const doSaveAlias = useCallback(async (canonical: string, alias: string) => {
    await apiCall({ action: "save-alias", canonical, alias });
    setAliasDialog(null);
  }, [apiCall]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (tab === "unmatched") loadEvents();
  }, [tab, loadEvents]);

  // ═══ RENDER ═══

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ── KPI Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <KpiCard label="EVENTI TOTALI" value={stats?.total ?? "—"} />
        <KpiCard label="MATCHATI" value={stats?.matched ?? "—"} color="#10b981" />
        <KpiCard label="NON MATCHATI" value={stats?.unmatched ?? "—"} color="#f59e0b" />
        <KpiCard
          label="COPERTURA"
          value={stats ? `${stats.percentage}%` : "—"}
          color={stats && stats.percentage > 70 ? "#10b981" : "#f59e0b"}
        />
      </div>

      {/* ── Tabs ── */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--admin-border, #1e3a5f)",
          marginBottom: 20,
        }}
      >
        {(["overview", "unmatched", "search", "debug"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 20px",
              background: tab === t ? "var(--admin-card, #0d2137)" : "transparent",
              color: tab === t ? "#60a5fa" : "var(--admin-muted, #94a3b8)",
              border: "none",
              borderBottom: tab === t ? "2px solid #60a5fa" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
              textTransform: "uppercase",
            }}
          >
            {t === "overview" ? "Panoramica" : t === "unmatched" ? "Non Matchati" : t === "search" ? "Cerca FS" : "Debug"}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {tab === "overview" && (
        <OverviewTab
          recentMatches={recentMatches}
          onAutoMatch={doAutoMatch}
          autoMatchResult={autoMatchResult}
          loading={loading}
          onUnmatch={doUnmatch}
        />
      )}

      {tab === "unmatched" && (
        <UnmatchedTab
          events={events}
          total={eventsTotal}
          page={eventsPage}
          onPageChange={setEventsPage}
          sportFilter={sportFilter}
          onSportFilter={setSportFilter}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          loading={loading}
          onSelect={setSelectedEvent}
          selectedEvent={selectedEvent}
          searchResults={searchResults}
          searchQuery={searchQuery}
          onSearchQuery={setSearchQuery}
          onSearch={doSearch}
          onMatch={doMatch}
        />
      )}

      {tab === "search" && (
        <SearchTab
          searchQuery={searchQuery}
          onSearchQuery={setSearchQuery}
          onSearch={doSearch}
          results={searchResults}
          loading={loading}
        />
      )}

      {tab === "debug" && (
        <DebugTab
          results={debugResults}
          summary={debugSummary}
          loading={debugLoading}
          sportFilter={debugSportFilter}
          onSportFilter={setDebugSportFilter}
          statusFilter={debugStatusFilter}
          onStatusFilter={setDebugStatusFilter}
          suggestionFilter={debugSuggestionFilter}
          onSuggestionFilter={setDebugSuggestionFilter}
          onLoad={loadDebug}
          onMatch={doMatch}
          onOpenAlias={setAliasDialog}
          expandedRow={expandedDebugRow}
          onExpandRow={setExpandedDebugRow}
        />
      )}

      {/* ── Alias Dialog ── */}
      {aliasDialog && (
        <AliasDialog
          initial={aliasDialog}
          onSave={doSaveAlias}
          onClose={() => setAliasDialog(null)}
        />
      )}
    </div>
  );
}

// ═══ COMPONENTS ═══

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "var(--admin-card, #0d2137)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "16px 20px",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          textTransform: "uppercase",
          color: "var(--admin-muted, #94a3b8)",
          letterSpacing: "0.5px",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: color || "var(--admin-text, #e2e8f0)" }}>
        {typeof value === "number" ? value.toLocaleString("it-IT") : value}
      </div>
    </div>
  );
}

function OverviewTab({
  recentMatches,
  onAutoMatch,
  autoMatchResult,
  loading,
  onUnmatch,
}: {
  recentMatches: any[];
  onAutoMatch: () => void;
  autoMatchResult: string | null;
  loading: boolean;
  onUnmatch: (id: string) => void;
}) {
  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", gap: 16, alignItems: "center" }}>
        <button
          onClick={onAutoMatch}
          disabled={loading}
          style={{ ...BTN_PRIMARY, padding: "10px 24px", opacity: loading ? 0.6 : 1, cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Matching..." : "Auto-Match Tutti"}
        </button>
        {autoMatchResult && (
          <span style={{ color: "#10b981", fontSize: 15 }}>{autoMatchResult}</span>
        )}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: "var(--admin-text, #e2e8f0)" }}>
        ULTIMI MATCH (FLASHSCORE ID SALVATO)
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr>
              {["Evento", "Stato", "FS ID", "Verificato", ""].map((h) => (
                <th key={h} style={TH_STYLE}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentMatches.slice(0, 20).map((m: any) => (
              <tr key={m.id}>
                <td style={TD_STYLE}>{m.home_team} vs {m.away_team}</td>
                <td style={TD_STYLE}><StatusBadge status={m.status} /></td>
                <td style={{ ...TD_STYLE, fontFamily: "monospace", fontSize: 14, color: "#60a5fa" }}>{m.flashscore_id}</td>
                <td style={TD_STYLE}>
                  {(m.live_data as any)?.verified_by === "flashscore" ? (
                    <span style={{ color: "#10b981" }}>FS</span>
                  ) : (m.live_data as any)?.verified_by ? (
                    <span style={{ color: "#f59e0b" }}>{(m.live_data as any).verified_by}</span>
                  ) : "—"}
                </td>
                <td style={TD_STYLE}>
                  <button onClick={() => onUnmatch(m.id)} style={BTN_DANGER}>Unmatch</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnmatchedTab({
  events, total, page, onPageChange,
  sportFilter, onSportFilter, statusFilter, onStatusFilter,
  loading, onSelect, selectedEvent,
  searchResults, searchQuery, onSearchQuery, onSearch, onMatch,
}: {
  events: UnmatchedEvent[];
  total: number;
  page: number;
  onPageChange: (p: number) => void;
  sportFilter: string;
  onSportFilter: (s: string) => void;
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  loading: boolean;
  onSelect: (e: UnmatchedEvent | null) => void;
  selectedEvent: UnmatchedEvent | null;
  searchResults: FsSearchResult[];
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  onSearch: () => void;
  onMatch: (eventId: string, fsId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: selectedEvent ? "1fr 1fr" : "1fr", gap: 20 }}>
      <div>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <select value={sportFilter} onChange={(e) => { onSportFilter(e.target.value); onPageChange(0); }} style={INPUT_STYLE}>
            <option value="">Tutti gli sport</option>
            <option value="Calcio">Calcio</option>
            <option value="Tennis">Tennis</option>
            <option value="Basket">Basket</option>
            <option value="Hockey Ghiaccio">Hockey</option>
            <option value="Volley">Volley</option>
            <option value="Pallamano">Pallamano</option>
          </select>
          <select value={statusFilter} onChange={(e) => { onStatusFilter(e.target.value); onPageChange(0); }} style={INPUT_STYLE}>
            <option value="">Tutti gli stati</option>
            <option value="prematch">Prematch</option>
            <option value="live">Live</option>
            <option value="finished">Finished</option>
          </select>
          <span style={{ color: "var(--admin-muted, #94a3b8)", fontSize: 15, alignSelf: "center" }}>
            {total.toLocaleString("it-IT")} eventi
          </span>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--admin-muted, #94a3b8)", fontSize: 15 }}>Caricamento...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead>
                <tr>{["Evento", "Sport", "Stato", "Data", ""].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={ev.id}
                    style={{ cursor: "pointer", background: selectedEvent?.id === ev.id ? "rgba(59,130,246,0.1)" : "transparent" }}
                    onClick={() => { onSelect(ev); onSearchQuery(ev.home_team); }}
                  >
                    <td style={TD_STYLE}>
                      {ev.home_team} vs {ev.away_team}
                      {ev.score_home != null && <span style={{ color: "#60a5fa", marginLeft: 8 }}>{ev.score_home}:{ev.score_away}</span>}
                    </td>
                    <td style={TD_STYLE}>{ev.sports?.name || "—"}</td>
                    <td style={TD_STYLE}><StatusBadge status={ev.status} /></td>
                    <td style={{ ...TD_STYLE, fontSize: 14 }}>{formatTime(ev.starts_at)}</td>
                    <td style={TD_STYLE}>
                      <button onClick={(e) => { e.stopPropagation(); onSelect(ev); onSearchQuery(ev.home_team); }} style={BTN_PRIMARY}>Cerca</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
          <button
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
            style={{ ...INPUT_STYLE, cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.4 : 1, padding: "6px 16px" }}
          >Prec</button>
          <span style={{ color: "var(--admin-muted, #94a3b8)", alignSelf: "center", fontSize: 15 }}>
            Pag {page + 1} / {Math.max(1, Math.ceil(total / 50))}
          </span>
          <button
            disabled={(page + 1) * 50 >= total}
            onClick={() => onPageChange(page + 1)}
            style={{ ...INPUT_STYLE, cursor: (page + 1) * 50 >= total ? "not-allowed" : "pointer", opacity: (page + 1) * 50 >= total ? 0.4 : 1, padding: "6px 16px" }}
          >Succ</button>
        </div>
      </div>

      {selectedEvent && (
        <div style={{ background: "var(--admin-card, #0d2137)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: "var(--admin-text, #e2e8f0)" }}>
            MATCH: {selectedEvent.home_team} vs {selectedEvent.away_team}
          </h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={searchQuery}
              onChange={(e) => onSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder="Cerca su Flashscore..."
              style={{ ...INPUT_STYLE, flex: 1, background: "var(--admin-bg, #0a1929)", padding: "8px 12px" }}
            />
            <button onClick={onSearch} style={BTN_PRIMARY}>Cerca</button>
          </div>
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            {searchResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: 20, color: "var(--admin-muted, #94a3b8)", fontSize: 15 }}>
                Premi &quot;Cerca&quot; per trovare match su Flashscore
              </div>
            ) : searchResults.map((r) => (
              <div key={r.matchId} style={{ padding: "10px 12px", borderBottom: "1px solid var(--admin-border, #1e3a5f)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{r.homeTeam} vs {r.awayTeam}</div>
                  <div style={{ fontSize: 13, color: "var(--admin-muted, #94a3b8)" }}>
                    {r.country && `${r.country} — `}{r.league && `${r.league} — `}
                    {r.scoreHome != null && `${r.scoreHome}:${r.scoreAway} — `}{r.status || ""}
                    {r.timestamp ? ` — ${formatTs(r.timestamp)}` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#60a5fa", fontFamily: "monospace" }}>ID: {r.matchId}</div>
                </div>
                <button onClick={() => onMatch(selectedEvent.id, r.matchId)} style={BTN_SUCCESS}>Match</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchTab({
  searchQuery, onSearchQuery, onSearch, results, loading,
}: {
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  onSearch: () => void;
  results: FsSearchResult[];
  loading: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          value={searchQuery}
          onChange={(e) => onSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="Cerca team su Flashscore (es. 'Inter', 'Juventus')..."
          style={{ ...INPUT_STYLE, flex: 1, padding: "10px 16px", fontSize: 16 }}
        />
        <button onClick={onSearch} disabled={loading} style={{ ...BTN_PRIMARY, padding: "10px 24px", opacity: loading ? 0.6 : 1 }}>
          {loading ? "..." : "Cerca"}
        </button>
      </div>

      {results.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
            <thead>
              <tr>{["Match", "Punteggio", "Stato", "Lega", "Data", "FS ID"].map((h) => <th key={h} style={TH_STYLE}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.matchId}>
                  <td style={TD_STYLE}>{r.homeTeam} vs {r.awayTeam}</td>
                  <td style={TD_STYLE}>{r.scoreHome != null ? `${r.scoreHome}:${r.scoreAway}` : "—"}</td>
                  <td style={TD_STYLE}>{r.status || "—"}</td>
                  <td style={TD_STYLE}>{r.country ? `${r.country}/${r.league}` : r.league || "—"}</td>
                  <td style={{ ...TD_STYLE, fontSize: 14 }}>{r.timestamp ? formatTs(r.timestamp) : "—"}</td>
                  <td style={{ ...TD_STYLE, fontFamily: "monospace", fontSize: 14, color: "#60a5fa" }}>{r.matchId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══ DEBUG TAB ═══

function DebugTab({
  results, summary, loading,
  sportFilter, onSportFilter, statusFilter, onStatusFilter,
  suggestionFilter, onSuggestionFilter,
  onLoad, onMatch, onOpenAlias,
  expandedRow, onExpandRow,
}: {
  results: DebugResult[];
  summary: DebugSummary | null;
  loading: boolean;
  sportFilter: string;
  onSportFilter: (s: string) => void;
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  suggestionFilter: string;
  onSuggestionFilter: (s: string) => void;
  onLoad: () => void;
  onMatch: (eventId: string, fsId: string) => void;
  onOpenAlias: (a: { canonical: string; alias: string }) => void;
  expandedRow: string | null;
  onExpandRow: (id: string | null) => void;
}) {
  const filtered = results.filter((r) => {
    if (suggestionFilter && r.suggestion !== suggestionFilter) return false;
    return true;
  });

  return (
    <div>
      {/* Summary cards */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
          <KpiCard label="NEAR-MISS (1.0-1.2)" value={summary.nearMiss} color="#fbbf24" />
          <KpiCard label="NO CANDIDATI" value={summary.noCandidates} color="#ef4444" />
          <KpiCard label="TEMPO ERRATO" value={summary.timeMismatch} color="#8b5cf6" />
          <KpiCard label="SERVE ALIAS" value={summary.aliasNeeded} color="#f97316" />
        </div>
      )}

      {/* Filters + load */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={sportFilter} onChange={(e) => onSportFilter(e.target.value)} style={INPUT_STYLE}>
          <option value="">Tutti gli sport</option>
          <option value="Calcio">Calcio</option>
          <option value="Tennis">Tennis</option>
          <option value="Basket">Basket</option>
          <option value="Hockey Ghiaccio">Hockey</option>
          <option value="Volley">Volley</option>
          <option value="Pallamano">Pallamano</option>
        </select>
        <select value={statusFilter} onChange={(e) => onStatusFilter(e.target.value)} style={INPUT_STYLE}>
          <option value="">Tutti gli stati</option>
          <option value="prematch">Prematch</option>
          <option value="live">Live</option>
          <option value="finished">Finished</option>
        </select>
        <select value={suggestionFilter} onChange={(e) => onSuggestionFilter(e.target.value)} style={INPUT_STYLE}>
          <option value="">Tutti i suggerimenti</option>
          <option value="lower_threshold">Soglia</option>
          <option value="add_alias">Alias</option>
          <option value="time_window">Tempo</option>
          <option value="no_data">No dati</option>
        </select>
        <button onClick={onLoad} disabled={loading} style={{ ...BTN_PRIMARY, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Analisi..." : "Analizza Matching"}
        </button>
        <span style={{ color: "var(--admin-muted, #94a3b8)", fontSize: 15, alignSelf: "center" }}>
          {filtered.length} risultati
        </span>
      </div>

      {/* Results table */}
      {filtered.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Evento DB", "Best FS Candidate", "H", "A", "Tot", "Delta", "Motivo", "Suggerimento", "Azioni"].map((h) => (
                  <th key={h} style={TH_STYLE}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const bc = r.bestCandidate;
                const isExpanded = expandedRow === r.event.id;
                return (
                  <>
                    <tr
                      key={r.event.id}
                      style={{ cursor: "pointer", background: isExpanded ? "rgba(59,130,246,0.05)" : "transparent" }}
                      onClick={() => onExpandRow(isExpanded ? null : r.event.id)}
                    >
                      <td style={TD_STYLE}>
                        <div style={{ fontWeight: 600 }}>{r.event.home_team}</div>
                        <div style={{ fontWeight: 600 }}>{r.event.away_team}</div>
                        <div style={{ fontSize: 12, color: "var(--admin-muted, #94a3b8)" }}>
                          {r.event.sport} | {formatTime(r.event.starts_at)}
                        </div>
                      </td>
                      <td style={TD_STYLE}>
                        {bc ? (
                          <>
                            <div>{bc.fsHome}</div>
                            <div>{bc.fsAway}</div>
                            <div style={{ fontSize: 12, color: "#60a5fa", fontFamily: "monospace" }}>{bc.fsId}</div>
                          </>
                        ) : <span style={{ color: "var(--admin-muted, #94a3b8)" }}>Nessuno</span>}
                      </td>
                      <td style={{ ...TD_STYLE, color: bc ? scoreColor(bc.homeScore) : "#6b7280", fontWeight: 700 }}>
                        {bc ? bc.homeScore.toFixed(2) : "—"}
                      </td>
                      <td style={{ ...TD_STYLE, color: bc ? scoreColor(bc.awayScore) : "#6b7280", fontWeight: 700 }}>
                        {bc ? bc.awayScore.toFixed(2) : "—"}
                      </td>
                      <td style={{ ...TD_STYLE, color: bc ? scoreColor(bc.combined / 2) : "#6b7280", fontWeight: 700, fontSize: 16 }}>
                        {bc ? bc.combined.toFixed(2) : "—"}
                      </td>
                      <td style={{ ...TD_STYLE, fontSize: 14 }}>
                        {bc ? formatDelta(bc.timeDelta) : "—"}
                      </td>
                      <td style={{ ...TD_STYLE, fontSize: 14 }}>
                        {bc ? bc.failReason : "—"}
                      </td>
                      <td style={TD_STYLE}>
                        <SuggestionBadge suggestion={r.suggestion} />
                      </td>
                      <td style={TD_STYLE}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {bc && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onMatch(r.event.id, bc.fsId); }}
                              style={{ ...BTN_SUCCESS, padding: "5px 10px", fontSize: 12 }}
                              title="Forza match anche se sotto soglia"
                            >
                              Forza
                            </button>
                          )}
                          {bc && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenAlias({ canonical: r.event.home_team.toLowerCase(), alias: bc.fsHome.toLowerCase() });
                              }}
                              style={{ ...BTN_PRIMARY, padding: "5px 10px", fontSize: 12, background: "#f97316" }}
                              title="Aggiungi alias per home team"
                            >
                              +Alias
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr key={`${r.event.id}-detail`}>
                        <td colSpan={9} style={{ padding: "12px 16px", background: "rgba(59,130,246,0.03)", borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
                          <DebugDetail result={r} onMatch={onMatch} onOpenAlias={onOpenAlias} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && filtered.length === 0 && results.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--admin-muted, #94a3b8)", fontSize: 15 }}>
          Premi &quot;Analizza Matching&quot; per vedere i risultati del debug
        </div>
      )}
    </div>
  );
}

// ═══ DEBUG DETAIL (expanded row) ═══

function DebugDetail({
  result, onMatch, onOpenAlias,
}: {
  result: DebugResult;
  onMatch: (eventId: string, fsId: string) => void;
  onOpenAlias: (a: { canonical: string; alias: string }) => void;
}) {
  const { event, candidates } = result;

  return (
    <div>
      <div style={{ fontSize: 14, marginBottom: 12, color: "var(--admin-muted, #94a3b8)" }}>
        <strong>DB Home norm:</strong> {candidates[0]?.homeNorm || "—"} |{" "}
        <strong>DB Away norm:</strong> {candidates[0]?.awayNorm || "—"} |{" "}
        <strong>Source:</strong> {event.source || "goldbet"}
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-muted, #94a3b8)", marginBottom: 8 }}>
        TOP {candidates.length} CANDIDATI
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["FS Home", "FS Away", "H Score", "A Score", "Totale", "Delta", "H Method", "A Method", "Motivo", ""].map((h) => (
              <th key={h} style={{ ...TH_STYLE, fontSize: 12, padding: "6px 10px" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => (
            <tr key={i}>
              <td style={{ ...TD_STYLE, padding: "6px 10px" }}>
                <div>{c.fsHome}</div>
                <div style={{ fontSize: 11, color: "var(--admin-muted, #94a3b8)" }}>{c.fsHomeNorm}</div>
              </td>
              <td style={{ ...TD_STYLE, padding: "6px 10px" }}>
                <div>{c.fsAway}</div>
                <div style={{ fontSize: 11, color: "var(--admin-muted, #94a3b8)" }}>{c.fsAwayNorm}</div>
              </td>
              <td style={{ ...TD_STYLE, padding: "6px 10px", color: scoreColor(c.homeScore), fontWeight: 700 }}>
                {c.homeScore.toFixed(2)}
              </td>
              <td style={{ ...TD_STYLE, padding: "6px 10px", color: scoreColor(c.awayScore), fontWeight: 700 }}>
                {c.awayScore.toFixed(2)}
              </td>
              <td style={{ ...TD_STYLE, padding: "6px 10px", color: scoreColor(c.combined / 2), fontWeight: 700 }}>
                {c.combined.toFixed(2)}
              </td>
              <td style={{ ...TD_STYLE, padding: "6px 10px" }}>{formatDelta(c.timeDelta)}</td>
              <td style={{ ...TD_STYLE, padding: "6px 10px", fontSize: 12, fontFamily: "monospace" }}>{c.homeMethod}</td>
              <td style={{ ...TD_STYLE, padding: "6px 10px", fontSize: 12, fontFamily: "monospace" }}>{c.awayMethod}</td>
              <td style={{ ...TD_STYLE, padding: "6px 10px" }}>{c.failReason}</td>
              <td style={{ ...TD_STYLE, padding: "6px 10px" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => onMatch(event.id, c.fsId)}
                    style={{ ...BTN_SUCCESS, padding: "4px 8px", fontSize: 12 }}
                  >
                    Match
                  </button>
                  <button
                    onClick={() => onOpenAlias({ canonical: event.home_team.toLowerCase(), alias: c.fsHome.toLowerCase() })}
                    style={{ ...BTN_PRIMARY, padding: "4px 8px", fontSize: 12, background: "#f97316" }}
                  >
                    Alias H
                  </button>
                  <button
                    onClick={() => onOpenAlias({ canonical: event.away_team.toLowerCase(), alias: c.fsAway.toLowerCase() })}
                    style={{ ...BTN_PRIMARY, padding: "4px 8px", fontSize: 12, background: "#f97316" }}
                  >
                    Alias A
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══ ALIAS DIALOG ═══

function AliasDialog({
  initial, onSave, onClose,
}: {
  initial: { canonical: string; alias: string };
  onSave: (canonical: string, alias: string) => void;
  onClose: () => void;
}) {
  const [canonical, setCanonical] = useState(initial.canonical);
  const [alias, setAlias] = useState(initial.alias);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--admin-card, #0d2137)", border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8, padding: 24, minWidth: 400,
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: "var(--admin-text, #e2e8f0)" }}>
          Aggiungi Alias Team
        </h3>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-muted, #94a3b8)", display: "block", marginBottom: 4 }}>
            Canonical (nome standard)
          </label>
          <input value={canonical} onChange={(e) => setCanonical(e.target.value)} style={{ ...INPUT_STYLE, width: "100%" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-muted, #94a3b8)", display: "block", marginBottom: 4 }}>
            Alias (variante)
          </label>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} style={{ ...INPUT_STYLE, width: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...INPUT_STYLE, cursor: "pointer", padding: "8px 20px" }}>Annulla</button>
          <button
            onClick={() => onSave(canonical, alias)}
            disabled={!canonical.trim() || !alias.trim()}
            style={{ ...BTN_SUCCESS, padding: "8px 20px", opacity: (!canonical.trim() || !alias.trim()) ? 0.4 : 1 }}
          >
            Salva Alias
          </button>
        </div>
      </div>
    </div>
  );
}
