"use client";

import { useEffect, useState, useCallback } from "react";

// ═══ TYPES ═══

interface FixtureRow {
  id: string;
  sport: string;
  country: string | null;
  league: string | null;
  home_team: string;
  away_team: string;
  match_date: string;
  match_url: string;
  be_match_id: string | null;
  odds_1: number | null;
  odds_x: number | null;
  odds_2: number | null;
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
  football: "\u26BD",
  tennis: "\uD83C\uDFBE",
  basketball: "\uD83C\uDFC0",
  hockey: "\uD83C\uDFD2",
  volleyball: "\uD83C\uDFD0",
  handball: "\uD83E\uDD3E",
  baseball: "\u26BE",
};

const SPORT_LABELS: Record<string, string> = {
  football: "Calcio",
  tennis: "Tennis",
  basketball: "Basket",
  hockey: "Hockey",
  volleyball: "Volley",
  handball: "Pallamano",
  baseball: "Baseball",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatOdds(val: number | null): string {
  if (val == null) return "-";
  return val.toFixed(2);
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

// ═══ FETCH HELPERS ═══

async function fetchApi(action: string, params: Record<string, string> = {}) {
  const sp = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/admin/fixtures?${sp}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ═══ MAIN COMPONENT ═══

export default function FixturesDashboard() {
  // ─── State ───
  const [stats, setStats] = useState<Stats | null>(null);
  const [sports, setSports] = useState<SportOption[]>([]);
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [fixtures, setFixtures] = useState<FixtureRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Filters
  const [selectedSport, setSelectedSport] = useState<string>("");
  const [selectedLeague, setSelectedLeague] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // ─── Load stats + sports on mount ───
  useEffect(() => {
    fetchApi("stats").then(setStats).catch(console.error);
    fetchApi("sports").then((r) => setSports(r.sports || [])).catch(console.error);
  }, []);

  // ─── Load leagues when sport changes ───
  useEffect(() => {
    if (!selectedSport) {
      setLeagues([]);
      return;
    }
    fetchApi("leagues", { sport: selectedSport })
      .then((r) => setLeagues(r.leagues || []))
      .catch(console.error);
    setSelectedLeague("");
  }, [selectedSport]);

  // ─── Load fixtures ───
  const loadFixtures = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: "50" };
      if (selectedSport) params.sport = selectedSport;
      if (selectedLeague) params.league = selectedLeague;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (search) params.search = search;
      const r = await fetchApi("list", params);
      setFixtures(r.fixtures || []);
      setTotal(r.total || 0);
      setPages(r.pages || 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedSport, selectedLeague, dateFrom, dateTo, search, page]);

  useEffect(() => {
    loadFixtures();
  }, [loadFixtures]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedSport, selectedLeague, dateFrom, dateTo, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "16px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text, #e2e8f0)" }}>
          BetExplorer Fixtures
        </h2>
        {stats?.last_updated && (
          <span style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>
            Aggiornato: {timeAgo(stats.last_updated)}
          </span>
        )}
      </div>

      {/* KPI bar */}
      <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
      }}>
        <KpiCard label="Totale" value={stats?.total || 0} />
        {(["football", "tennis", "basketball", "hockey", "volleyball", "handball", "baseball"] as const).map((s) => {
          const count = stats?.by_sport[s] || 0;
          if (count === 0) return null;
          return (
            <KpiCard
              key={s}
              label={`${SPORT_ICONS[s] || ""} ${SPORT_LABELS[s] || s}`}
              value={count}
              active={selectedSport === s}
              onClick={() => setSelectedSport(selectedSport === s ? "" : s)}
            />
          );
        })}
      </div>

      {/* Filters */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "12px 20px",
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <FilterSelect
          label="Sport"
          value={selectedSport}
          onChange={setSelectedSport}
          options={[
            { value: "", label: "Tutti" },
            ...sports.map((s) => ({
              value: s.sport,
              label: `${SPORT_ICONS[s.sport] || ""} ${SPORT_LABELS[s.sport] || s.sport} (${s.count})`,
            })),
          ]}
        />
        {leagues.length > 0 && (
          <FilterSelect
            label="Lega"
            value={selectedLeague}
            onChange={setSelectedLeague}
            options={[
              { value: "", label: `Tutte (${leagues.length})` },
              ...leagues.map((l) => ({
                value: l.league,
                label: `${l.country ? l.country + " · " : ""}${l.league} (${l.count})`,
              })),
            ]}
          />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)" }}>
            Da:
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)" }}>
            A:
          </span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="text"
            placeholder="Cerca squadra..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 180 }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        overflow: "hidden",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
                {["Data", "Ora", "Sport", "Paese", "Campionato", "Casa", "Trasferta", "1", "X", "2"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 12px",
                      textAlign: "left",
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: "var(--admin-text-muted, #94a3b8)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && fixtures.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 40, textAlign: "center", color: "var(--admin-text-muted, #94a3b8)" }}>
                    Caricamento...
                  </td>
                </tr>
              ) : fixtures.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 40, textAlign: "center", color: "var(--admin-text-muted, #94a3b8)" }}>
                    Nessuna fixture trovata
                  </td>
                </tr>
              ) : (
                fixtures.map((f) => (
                  <tr
                    key={f.id}
                    style={{ borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}
                  >
                    <td style={cellStyle}>{formatDate(f.match_date)}</td>
                    <td style={cellStyle}>{formatTime(f.match_date)}</td>
                    <td style={cellStyle}>
                      <span title={f.sport}>{SPORT_ICONS[f.sport] || f.sport}</span>
                    </td>
                    <td style={{ ...cellStyle, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.country || "-"}
                    </td>
                    <td style={{ ...cellStyle, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.league || "-"}
                    </td>
                    <td style={{ ...cellStyle, fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                      {f.home_team}
                    </td>
                    <td style={{ ...cellStyle, fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
                      {f.away_team}
                    </td>
                    <td style={oddsStyle(f.odds_1)}>{formatOdds(f.odds_1)}</td>
                    <td style={oddsStyle(f.odds_x)}>{formatOdds(f.odds_x)}</td>
                    <td style={oddsStyle(f.odds_2)}>{formatOdds(f.odds_2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderTop: "1px solid var(--admin-border, #1e3a5f)",
          }}>
            <span style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
              {total.toLocaleString("it-IT")} fixture totali — Pagina {page} di {pages}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <PaginationButton
                label="Prec"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              />
              {/* Show page numbers around current */}
              {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, pages - 4));
                const p = start + i;
                if (p > pages) return null;
                return (
                  <PaginationButton
                    key={p}
                    label={String(p)}
                    active={p === page}
                    onClick={() => setPage(p)}
                  />
                );
              })}
              <PaginationButton
                label="Succ"
                disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        fontSize: 11,
        color: "var(--admin-text-muted, #94a3b8)",
        textAlign: "right",
        padding: "4px 8px",
      }}>
        {stats?.total != null && `${stats.total.toLocaleString("it-IT")} fixture in DB`}
        {stats?.last_updated && ` · Aggiornato ${formatDateTime(stats.last_updated)}`}
        {loading && " · Caricamento..."}
      </div>
    </div>
  );
}

// ═══ SHARED STYLES ═══

const inputStyle: React.CSSProperties = {
  background: "var(--admin-bg, #0a1929)",
  border: "1px solid var(--admin-border, #1e3a5f)",
  borderRadius: 4,
  color: "var(--admin-text, #e2e8f0)",
  padding: "6px 10px",
  fontSize: 13,
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  whiteSpace: "nowrap",
  color: "var(--admin-text-muted, #94a3b8)",
};

function oddsStyle(val: number | null): React.CSSProperties {
  return {
    ...cellStyle,
    textAlign: "center",
    fontFamily: "monospace",
    fontWeight: 600,
    color: val != null ? "#10b981" : "var(--admin-text-muted, #94a3b8)",
  };
}

// ═══ SUB-COMPONENTS ═══

function KpiCard({ label, value, active, onClick }: {
  label: string;
  value: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? "rgba(37, 99, 235, 0.15)" : "var(--admin-card, #0f1f35)",
        border: `1px solid ${active ? "#2563eb" : "var(--admin-border, #1e3a5f)"}`,
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 90,
        cursor: onClick ? "pointer" : "default",
        textAlign: "center",
        transition: "border-color 0.15s",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
        {value.toLocaleString("it-IT")}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)", marginTop: 2 }}>
        {label}
      </div>
    </div>
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
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)" }}>
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
          padding: "6px 10px",
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

function PaginationButton({ label, active, disabled, onClick }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 10px",
        borderRadius: 4,
        border: `1px solid ${active ? "#2563eb" : "var(--admin-border, #1e3a5f)"}`,
        background: active ? "#2563eb" : "transparent",
        color: active ? "#fff" : disabled ? "var(--admin-border, #1e3a5f)" : "var(--admin-text-muted, #94a3b8)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}
