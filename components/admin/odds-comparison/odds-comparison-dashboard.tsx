"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MARKET_CATEGORIES, getMarketCategoryId } from "@/lib/constants/market-categories";

// ═══ TYPES ═══

interface SportOption {
  id: string;
  name: string;
  goldbet: number;
  kambi: number;
}

interface LeagueOption {
  id: string;
  name: string;
  goldbet: number;
  kambi: number;
}

interface EventSummary {
  id: string;
  external_id: string;
  home_team: string;
  away_team: string;
  starts_at: string;
  score_home: number | null;
  score_away: number | null;
  status: string;
  is_live: boolean;
  source: string;
  sport_id: string;
  league_id: string;
  sport_name: string;
  league_name: string;
  market_count: number;
}

interface Outcome {
  id: string;
  market_id: string;
  name: string;
  odds: number;
  previous_odds: number | null;
  is_active: boolean;
}

interface MarketDetail {
  id: string;
  event_id: string;
  market_type: string;
  name: string;
  line: number | null;
  is_active: boolean;
  outcomes: Outcome[];
}

interface EventDetail {
  event: EventSummary;
  markets: MarketDetail[];
  market_count: number;
  outcome_count: number;
}

// ═══ HELPERS ═══

function formatNum(n: number): string {
  return n.toLocaleString("it-IT");
}

function diffPct(a: number, b: number): number {
  if (a === 0) return 0;
  return ((b - a) / a) * 100;
}

function diffColor(pct: number): string {
  const abs = Math.abs(pct);
  if (abs <= 2) return "#10b981";
  if (abs <= 5) return "#f59e0b";
  return "#ef4444";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function normalizeMarketName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Cross-source market name canonicalization ───
// Maps different naming conventions to a common key for matching

const MARKET_CANON: [RegExp, string][] = [
  // Esito finale / 1X2
  [/^esito finale 1x2$/, "1x2"],
  [/^1x2$/, "1x2"],
  // Doppia chance (Kambi full name + Goldbet abbreviation)
  [/^dc$/, "doppia_chance"],
  [/^doppia chance$/, "doppia_chance"],
  [/^doppia chance - 1° tempo$/, "doppia_chance_1t"],
  [/^doppia chance - 2° tempo$/, "doppia_chance_2t"],
  // Draw no bet
  [/^draw no bet$/, "draw_no_bet"],
  [/^draw no bet - 1° tempo$/, "draw_no_bet_1t"],
  [/^draw no bet - 2° tempo$/, "draw_no_bet_2t"],
  // Under/Over totale gol (Kambi "Totale gol" = GB "U/O")
  [/^totale gol$/, "uo_gol"],
  [/^under\/over$/, "uo_gol"],
  // U/O with specific line (Goldbet: "U/O 2.5")
  [/^u\/o (\d+\.?\d*)$/, "uo_gol"],
  // Totale gol 1T / 2T
  [/^totale gol - 1° tempo$/, "uo_gol_1t"],
  [/^u\/o 1t (\d+\.?\d*)$/, "uo_gol_1t"],
  [/^totale gol - 2° tempo$/, "uo_gol_2t"],
  [/^u\/o 2t (\d+\.?\d*)$/, "uo_gol_2t"],
  // Totale asiatico
  [/^totale asiatico$/, "uo_asiatico"],
  [/^totale asiatico - 1° tempo$/, "uo_asiatico_1t"],
  // Gol/NoGol
  [/^entrambe le squadre a segno \(gol\/no gol\)$/, "gg_ng"],
  [/^gol\/nogol$/, "gg_ng"],
  [/^gg\/ng$/, "gg_ng"],
  [/^entrambe le squadre segnano - 1° tempo/, "gg_ng_1t"],
  [/^entrambe le squadre segnano - 2° tempo/, "gg_ng_2t"],
  // Primo tempo / Secondo tempo
  [/^1° tempo$/, "1x2_1t"],
  [/^2° tempo$/, "1x2_2t"],
  [/^1x2 1t$/, "1x2_1t"],
  [/^1x2 2t$/, "1x2_2t"],
  // Pari/Dispari (Goldbet "P/D" + Kambi "Pari/Dispari")
  [/^p\/d$/, "pari_dispari"],
  [/^pari\/dispari$/, "pari_dispari"],
  // Risultato esatto (Goldbet "Ris.Esatto 26 Esiti" + Kambi "Risultato esatto")
  [/^ris\.esatto.*/, "esatto"],
  [/^risultato esatto$/, "esatto"],
  [/^risultato esatto - 1° tempo$/, "esatto_1t"],
  // HT/FT
  [/^primo tempo\/finale$/, "ht_ft"],
  [/^ht\/ft$/, "ht_ft"],
  // Handicap (Goldbet "1X2 H -1" + Kambi "1X2 con Handicap")
  [/^1x2 h .+$/, "handicap_1x2"],
  [/^1x2 con handicap$/, "handicap_1x2"],
  [/^handicap asiatico$/, "handicap_asiatico"],
  [/^handicap asiatico - 1° tempo$/, "handicap_asiatico_1t"],
  [/^testa a testa handicap$/, "handicap_tt"],
  // Gol squadra
  [/^gol totali - (.+)$/, "gol_squadra_$1"],
  [/^gol totali - (.+) - 1° tempo$/, "gol_squadra_$1_1t"],
  [/^gol totali - (.+) - 2° tempo$/, "gol_squadra_$1_2t"],
  // Numero esatto gol
  [/^numero totale esatto di gol$/, "esatto_gol"],
  [/^somma gol$/, "esatto_gol"],
  // Primo gol
  [/^primo gol/, "primo_gol"],
  [/^prossimo gol/, "primo_gol"],
  // Calci d'angolo totali
  [/^totale calci d'angolo$/, "corner_totale"],
  [/^totale calci d'angolo - 1° tempo$/, "corner_totale_1t"],
  [/^totale calci d'angolo - 2° tempo$/, "corner_totale_2t"],
  // Cartellini totali
  [/^totale cartellini$/, "cartellini_totale"],
];

function canonicalizeMarketName(name: string): string {
  const n = normalizeMarketName(name);
  for (const [pattern, replacement] of MARKET_CANON) {
    const match = n.match(pattern);
    if (match) {
      // If replacement has $1, substitute captured group
      if (replacement.includes("$1") && match[1]) {
        return replacement.replace("$1", match[1].trim());
      }
      return replacement;
    }
  }
  return n;
}

// Extract line from market name or outcomes for grouping
// Goldbet embeds line in name: "U/O 2.5" → 2.5
// Kambi puts all lines as outcomes in one market: "Totale gol" → outcomes have "Over 2.5", "Under 2.5"
function extractLineFromName(name: string): number | null {
  const n = normalizeMarketName(name);
  // Goldbet: "u/o 2.5", "u/o 1t 0.5", "1x2 h -1"
  const m = n.match(/\s(-?\d+\.?\d*)\s*$/);
  if (m) return parseFloat(m[1]);
  return null;
}

// Build a key for matching markets across sources
// Both Goldbet and Kambi create separate markets per line, so key = "canon|line"
function marketMatchKey(m: MarketDetail): string {
  const canon = canonicalizeMarketName(m.name);
  // For line-based markets, always include the line
  if (canon.startsWith("uo_") || canon.startsWith("handicap_")) {
    if (m.line != null) return `${canon}|${m.line}`;
    const embeddedLine = extractLineFromName(m.name);
    if (embeddedLine != null) return `${canon}|${embeddedLine}`;
  }
  // Generic: if DB has a line field, include it
  if (m.line != null) return `${canon}|${m.line}`;
  return canon;
}

// Normalize outcome names for cross-source matching
function normalizeOutcomeName(name: string, marketCanon: string): string {
  const n = name.toLowerCase().trim();
  // U/O: Kambi "Over 2.5" → "over", Goldbet "U"/"O"
  if (marketCanon.startsWith("uo_")) {
    if (n.startsWith("over") || n === "o") return "over";
    if (n.startsWith("under") || n === "u") return "under";
  }
  // GG/NG: Kambi "Si"/"No", Goldbet "GG"/"NG"
  if (marketCanon.startsWith("gg_ng")) {
    if (n === "si" || n === "gg" || n === "gol") return "gg";
    if (n === "no" || n === "ng" || n === "nogol") return "ng";
  }
  // Pari/Dispari: Kambi "Pari"/"Dispari", Goldbet "P"/"D"
  if (marketCanon === "pari_dispari") {
    if (n === "p" || n === "pari") return "pari";
    if (n === "d" || n === "dispari") return "dispari";
  }
  // Risultato esatto: normalize score format "1:0" → "1-0"
  if (marketCanon.startsWith("esatto")) {
    return n.replace(/:/g, "-");
  }
  return n;
}

// Category ID using the same logic as sportsbook
function getCategoryForMarket(m: MarketDetail): string {
  const fakeMarket = {
    name: m.name || "",
    marketType: m.market_type || "",
    id: m.id,
    eventId: m.event_id,
    line: m.line,
    isActive: m.is_active,
    selections: [],
  };
  return getMarketCategoryId(fakeMarket as any);
}

// ═══ FETCH HELPERS ═══

async function fetchApi(action: string, params: Record<string, string> = {}) {
  const sp = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/admin/odds-comparison?${sp}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ═══ MAIN COMPONENT ═══

export default function OddsComparisonDashboard() {
  // ─── State ───
  const [sports, setSports] = useState<SportOption[]>([]);
  const [selectedSport, setSelectedSport] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string>("");

  const [goldEvents, setGoldEvents] = useState<EventSummary[]>([]);
  const [kambiEvents, setKambiEvents] = useState<EventSummary[]>([]);
  const [goldSelectedId, setGoldSelectedId] = useState<string>("");
  const [kambiSelectedId, setKambiSelectedId] = useState<string>("");

  const [goldDetail, setGoldDetail] = useState<EventDetail | null>(null);
  const [kambiDetail, setKambiDetail] = useState<EventDetail | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>("principali");
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const refreshRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Load sports ───
  useEffect(() => {
    fetchApi("sports").then((r) => {
      setSports(r.sports || []);
      if (r.sports?.length > 0 && !selectedSport) {
        setSelectedSport(r.sports[0].id);
      }
    }).catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Load leagues when sport/status changes ───
  useEffect(() => {
    if (!selectedSport) return;
    const params: Record<string, string> = { sport_id: selectedSport };
    if (statusFilter !== "all") params.status = statusFilter;
    fetchApi("leagues", params).then((r) => {
      setLeagues(r.leagues || []);
    }).catch(console.error);
    setSelectedLeague("");
  }, [selectedSport, statusFilter]);

  // ─── Load events when sport/status/league changes ───
  const loadEvents = useCallback(async () => {
    if (!selectedSport) return;
    const params: Record<string, string> = { sport_id: selectedSport };
    if (statusFilter !== "all") params.status = statusFilter;
    if (selectedLeague) params.league_id = selectedLeague;

    const [goldRes, kambiRes] = await Promise.all([
      fetchApi("events", { ...params, source: "goldbet" }),
      fetchApi("events", { ...params, source: "kambi" }),
    ]);

    setGoldEvents(goldRes.events || []);
    setKambiEvents(kambiRes.events || []);
  }, [selectedSport, statusFilter, selectedLeague]);

  useEffect(() => {
    loadEvents().catch(console.error);
    // Reset selections when filters change
    setGoldSelectedId("");
    setKambiSelectedId("");
    setGoldDetail(null);
    setKambiDetail(null);
  }, [loadEvents]);

  // ─── Load event detail ───
  const loadDetail = useCallback(async (eventId: string, side: "gold" | "kambi") => {
    if (!eventId) {
      if (side === "gold") setGoldDetail(null);
      else setKambiDetail(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchApi("event-detail", { event_id: eventId });
      if (side === "gold") setGoldDetail(res);
      else setKambiDetail(res);
      setLastRefresh(new Date().toLocaleTimeString("it-IT"));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Auto-suggest match ───
  const autoSuggest = useCallback(async (eventId: string, targetSide: "gold" | "kambi") => {
    try {
      const res = await fetchApi("match-suggestions", { event_id: eventId });
      const suggestions = res.suggestions || [];
      if (suggestions.length > 0 && suggestions[0].score >= 2) {
        const best = suggestions[0];
        if (targetSide === "kambi") {
          setKambiSelectedId(best.id);
          loadDetail(best.id, "kambi");
        } else {
          setGoldSelectedId(best.id);
          loadDetail(best.id, "gold");
        }
      }
    } catch (err) {
      console.error("auto-suggest failed:", err);
    }
  }, [loadDetail]);

  // Handle goldbet selection
  const handleGoldSelect = useCallback((eventId: string) => {
    setGoldSelectedId(eventId);
    loadDetail(eventId, "gold");
    if (eventId) autoSuggest(eventId, "kambi");
  }, [loadDetail, autoSuggest]);

  // Handle kambi selection
  const handleKambiSelect = useCallback((eventId: string) => {
    setKambiSelectedId(eventId);
    loadDetail(eventId, "kambi");
    if (eventId) autoSuggest(eventId, "gold");
  }, [loadDetail, autoSuggest]);

  // ─── Auto-refresh ───
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    const isLive = goldDetail?.event?.status === "live" || kambiDetail?.event?.status === "live";
    const interval = isLive ? 15000 : 60000;

    if (goldSelectedId || kambiSelectedId) {
      refreshRef.current = setInterval(() => {
        if (goldSelectedId) loadDetail(goldSelectedId, "gold");
        if (kambiSelectedId) loadDetail(kambiSelectedId, "kambi");
      }, interval);
    }

    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [goldSelectedId, kambiSelectedId, goldDetail?.event?.status, kambiDetail?.event?.status, loadDetail]);

  // ─── Build market comparison data ───
  const comparisonData = buildComparison(goldDetail, kambiDetail, activeCategory);

  // ─── Categories with counts from both sides ───
  const categories = buildCategories(goldDetail, kambiDetail);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: "16px 20px",
      }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "var(--admin-text, #e2e8f0)" }}>
          Confronto Quote — Goldbet vs Kambi
        </h2>
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
          options={sports.map((s) => ({ value: s.id, label: `${s.name} (GB ${s.goldbet} · K ${s.kambi})` }))}
        />
        <FilterSelect
          label="Torneo"
          value={selectedLeague}
          onChange={setSelectedLeague}
          options={[
            { value: "", label: `Tutti (${leagues.length})` },
            ...leagues.map((l) => ({ value: l.id, label: `${l.name} (GB ${l.goldbet} · K ${l.kambi})` })),
          ]}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {["all", "live", "prematch"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                border: "1px solid var(--admin-border, #1e3a5f)",
                background: statusFilter === s ? "#2563eb" : "transparent",
                color: statusFilter === s ? "#fff" : "var(--admin-text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              {s === "all" ? "Tutti" : s === "live" ? "Live" : "Prematch"}
            </button>
          ))}
        </div>
      </div>

      {/* Event selectors — side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <EventSelector
          label="GOLDBET"
          color="#f59e0b"
          events={goldEvents}
          selectedId={goldSelectedId}
          onSelect={handleGoldSelect}
          detail={goldDetail}
        />
        <EventSelector
          label="KAMBI"
          color="#8b5cf6"
          events={kambiEvents}
          selectedId={kambiSelectedId}
          onSelect={handleKambiSelect}
          detail={kambiDetail}
        />
      </div>

      {/* Summary bar */}
      {(goldDetail || kambiDetail) && (
        <SummaryBar gold={goldDetail} kambi={kambiDetail} />
      )}

      {/* Category tabs */}
      {(goldDetail || kambiDetail) && (
        <div style={{
          background: "var(--admin-card, #0f1f35)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 8,
          padding: "8px 12px",
          display: "flex",
          gap: 4,
          overflowX: "auto",
          flexWrap: "wrap",
        }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: activeCategory === cat.id ? "1px solid #2563eb" : "1px solid transparent",
                background: activeCategory === cat.id ? "rgba(37, 99, 235, 0.2)" : "transparent",
                color: activeCategory === cat.id ? "#60a5fa" : "var(--admin-text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {cat.label} ({cat.goldCount + cat.kambiCount})
            </button>
          ))}
        </div>
      )}

      {/* Market comparison table */}
      {(goldDetail || kambiDetail) && (
        <MarketComparisonTable rows={comparisonData} loading={loading} />
      )}

      {/* Footer */}
      <div style={{
        fontSize: 11,
        color: "var(--admin-text-muted, #94a3b8)",
        textAlign: "right",
        padding: "4px 8px",
      }}>
        Auto-refresh: {goldDetail?.event?.status === "live" || kambiDetail?.event?.status === "live" ? "15s (live)" : "60s (prematch)"}
        {lastRefresh && ` · Ultimo: ${lastRefresh}`}
        {loading && " · Caricamento..."}
      </div>
    </div>
  );
}

// ═══ SUB-COMPONENTS ═══

// ─── Filter select ───

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

// ─── Event selector ───

function EventSelector({ label, color, events, selectedId, onSelect, detail }: {
  label: string;
  color: string;
  events: EventSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  detail: EventDetail | null;
}) {
  return (
    <div style={{
      background: "var(--admin-card, #0f1f35)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 8,
      padding: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>
          ({events.length} eventi)
        </span>
      </div>

      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        style={{
          width: "100%",
          background: "var(--admin-bg, #0a1929)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 4,
          color: "var(--admin-text, #e2e8f0)",
          padding: "8px 10px",
          fontSize: 13,
        }}
      >
        <option value="">Seleziona evento...</option>
        {(() => {
          const byLeague = new Map<string, EventSummary[]>();
          for (const e of events) {
            const lg = e.league_name || "Altro";
            const arr = byLeague.get(lg) || [];
            arr.push(e);
            byLeague.set(lg, arr);
          }
          const groups = Array.from(byLeague.entries()).sort((a, b) => b[1].length - a[1].length);
          if (groups.length <= 1) {
            return events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.home_team} vs {e.away_team} — {e.market_count} mkt
              </option>
            ));
          }
          return groups.map(([lg, evts]) => (
            <optgroup key={lg} label={`${lg} (${evts.length})`}>
              {evts.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.home_team} vs {e.away_team} — {e.market_count} mkt
                </option>
              ))}
            </optgroup>
          ));
        })()}
      </select>

      {/* Info card */}
      {detail && (
        <div style={{
          marginTop: 10,
          padding: "10px 12px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 6,
          border: `1px solid ${color}33`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>
            {detail.event.home_team} vs {detail.event.away_team}
          </div>
          <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{detail.event.sport_name} · {detail.event.league_name}</span>
            <span style={{ color: detail.event.status === "live" ? "#10b981" : "#94a3b8", fontWeight: 600 }}>
              {detail.event.status === "live"
                ? `LIVE ${detail.event.score_home ?? 0}-${detail.event.score_away ?? 0}`
                : formatTime(detail.event.starts_at)}
            </span>
          </div>
          <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 6 }}>
            {formatNum(detail.market_count)} mercati · {formatNum(detail.outcome_count)} esiti
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Summary bar ───

function SummaryBar({ gold, kambi }: { gold: EventDetail | null; kambi: EventDetail | null }) {
  const gm = gold?.market_count || 0;
  const km = kambi?.market_count || 0;
  const go = gold?.outcome_count || 0;
  const ko = kambi?.outcome_count || 0;

  const mktDiff = gm > 0 ? ((km - gm) / gm * 100).toFixed(0) : "—";
  const outDiff = go > 0 ? ((ko - go) / go * 100).toFixed(0) : "—";

  return (
    <div style={{
      background: "var(--admin-card, #0f1f35)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 8,
      padding: "12px 20px",
      display: "flex",
      gap: 24,
      alignItems: "center",
      justifyContent: "center",
      flexWrap: "wrap",
    }}>
      <SumStat label="Goldbet" value={`${formatNum(gm)} mkt`} sub={`${formatNum(go)} esiti`} color="#f59e0b" />
      <div style={{ width: 1, height: 32, background: "var(--admin-border, #1e3a5f)" }} />
      <SumStat label="Kambi" value={`${formatNum(km)} mkt`} sub={`${formatNum(ko)} esiti`} color="#8b5cf6" />
      <div style={{ width: 1, height: 32, background: "var(--admin-border, #1e3a5f)" }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", textTransform: "uppercase", fontWeight: 600 }}>
          Diff Mercati
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: typeof mktDiff === "string" && mktDiff !== "—" ? (Number(mktDiff) > 0 ? "#10b981" : "#ef4444") : "var(--admin-text, #e2e8f0)" }}>
          {mktDiff !== "—" ? `${Number(mktDiff) > 0 ? "+" : ""}${mktDiff}%` : "—"}
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", textTransform: "uppercase", fontWeight: 600 }}>
          Diff Esiti
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: typeof outDiff === "string" && outDiff !== "—" ? (Number(outDiff) > 0 ? "#10b981" : "#ef4444") : "var(--admin-text, #e2e8f0)" }}>
          {outDiff !== "—" ? `${Number(outDiff) > 0 ? "+" : ""}${outDiff}%` : "—"}
        </div>
      </div>
    </div>
  );
}

function SumStat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>{sub}</div>
    </div>
  );
}

// ─── Market comparison table ───

interface ComparisonRow {
  marketName: string;
  canon: string;
  line: number | null;
  category: string;
  goldOutcomes: { name: string; normalizedName: string; odds: number }[];
  kambiOutcomes: { name: string; normalizedName: string; odds: number }[];
  onlyGold: boolean;
  onlyKambi: boolean;
}

function MarketComparisonTable({ rows, loading }: { rows: ComparisonRow[]; loading: boolean }) {
  if (rows.length === 0 && !loading) {
    return (
      <div style={{
        background: "var(--admin-card, #0f1f35)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 8,
        padding: 40,
        textAlign: "center",
        color: "var(--admin-text-muted, #94a3b8)",
        fontSize: 13,
      }}>
        Seleziona due eventi per confrontare i mercati
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--admin-card, #0f1f35)",
      border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 8,
      overflow: "hidden",
    }}>
      {/* Table header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(200px, 1.5fr) 1fr 1fr 80px",
        padding: "10px 16px",
        background: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid var(--admin-border, #1e3a5f)",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        color: "var(--admin-text-muted, #94a3b8)",
        letterSpacing: 0.5,
      }}>
        <div>Mercato</div>
        <div style={{ textAlign: "center", color: "#f59e0b" }}>Goldbet</div>
        <div style={{ textAlign: "center", color: "#8b5cf6" }}>Kambi</div>
        <div style={{ textAlign: "center" }}>Diff</div>
      </div>

      {/* Market rows */}
      <div style={{ maxHeight: 600, overflowY: "auto" }}>
        {rows.map((row, i) => (
          <MarketRow key={`${row.marketName}-${row.line}-${i}`} row={row} index={i} />
        ))}
      </div>
    </div>
  );
}

function MarketRow({ row, index }: { row: ComparisonRow; index: number }) {
  // Find matching outcomes by normalized name
  const allNormalized = new Set([
    ...row.goldOutcomes.map((o) => o.normalizedName),
    ...row.kambiOutcomes.map((o) => o.normalizedName),
  ]);

  const bgBase = index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)";
  const exclusiveHighlight = row.onlyKambi
    ? "rgba(139, 92, 246, 0.05)"
    : row.onlyGold
      ? "rgba(245, 158, 11, 0.05)"
      : bgBase;

  return (
    <div>
      {/* Market name row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(200px, 1.5fr) 1fr 1fr 80px",
        padding: "8px 16px 4px",
        background: exclusiveHighlight,
        borderBottom: "1px solid rgba(255,255,255,0.03)",
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--admin-text, #e2e8f0)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          {row.marketName}
          {row.line != null && (
            <span style={{ fontSize: 10, color: "var(--admin-text-muted, #94a3b8)" }}>({row.line})</span>
          )}
          {row.onlyKambi && <span style={{ fontSize: 9, background: "#8b5cf620", color: "#8b5cf6", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>SOLO KAMBI</span>}
          {row.onlyGold && <span style={{ fontSize: 9, background: "#f59e0b20", color: "#f59e0b", padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>SOLO GB</span>}
        </div>
        <div />
        <div />
        <div />
      </div>

      {/* Outcomes */}
      {Array.from(allNormalized).map((normName) => {
        const gOut = row.goldOutcomes.find((o) => o.normalizedName === normName);
        const kOut = row.kambiOutcomes.find((o) => o.normalizedName === normName);
        const diff = gOut && kOut ? diffPct(gOut.odds, kOut.odds) : null;
        const displayName = gOut?.name || kOut?.name || normName;

        return (
          <div
            key={normName}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(200px, 1.5fr) 1fr 1fr 80px",
              padding: "3px 16px 3px 32px",
              background: exclusiveHighlight,
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
              {displayName}
            </div>
            <OddsCell odds={gOut?.odds} />
            <OddsCell odds={kOut?.odds} />
            <div style={{ textAlign: "center" }}>
              {diff != null ? (
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: diffColor(diff),
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: `${diffColor(diff)}15`,
                }}>
                  {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                </span>
              ) : (
                <span style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)" }}>—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OddsCell({ odds }: { odds: number | undefined }) {
  if (odds == null) {
    return (
      <div style={{ textAlign: "center", fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>—</div>
    );
  }
  return (
    <div style={{
      textAlign: "center",
      fontSize: 13,
      fontWeight: 600,
      color: "var(--admin-text, #e2e8f0)",
      fontFamily: "monospace",
    }}>
      {odds.toFixed(2)}
    </div>
  );
}

// ═══ DATA BUILDERS ═══

function buildCategories(gold: EventDetail | null, kambi: EventDetail | null) {
  const catMap = new Map<string, { id: string; label: string; goldCount: number; kambiCount: number }>();

  // Init all categories
  for (const cat of MARKET_CATEGORIES) {
    catMap.set(cat.id, { id: cat.id, label: cat.label, goldCount: 0, kambiCount: 0 });
  }

  for (const m of gold?.markets || []) {
    const catId = getCategoryForMarket(m);
    const entry = catMap.get(catId);
    if (entry) entry.goldCount++;
  }

  for (const m of kambi?.markets || []) {
    const catId = getCategoryForMarket(m);
    const entry = catMap.get(catId);
    if (entry) entry.kambiCount++;
  }

  // Principali = virtual, count as number of key markets found
  const principali = catMap.get("principali")!;
  principali.goldCount = gold?.markets ? Math.min(4, gold.markets.length) : 0;
  principali.kambiCount = kambi?.markets ? Math.min(4, kambi.markets.length) : 0;

  return Array.from(catMap.values()).filter((c) => c.goldCount + c.kambiCount > 0);
}

interface FlatMarketEntry {
  key: string;
  canon: string;
  name: string;
  line: number | null;
  outcomes: { name: string; normalizedName: string; odds: number }[];
  source: "gold" | "kambi";
}

function flattenMarket(m: MarketDetail, source: "gold" | "kambi"): FlatMarketEntry {
  const key = marketMatchKey(m);
  const canon = canonicalizeMarketName(m.name);
  const line = m.line ?? extractLineFromName(m.name);
  return {
    key,
    canon,
    name: m.name,
    line,
    outcomes: m.outcomes.map((o) => ({
      name: o.name,
      normalizedName: normalizeOutcomeName(o.name, canon),
      odds: o.odds,
    })),
    source,
  };
}

function buildComparison(gold: EventDetail | null, kambi: EventDetail | null, categoryId: string): ComparisonRow[] {
  const goldMarkets = (gold?.markets || []).filter((m) => {
    if (categoryId === "principali") return true;
    return getCategoryForMarket(m) === categoryId;
  });

  const kambiMarkets = (kambi?.markets || []).filter((m) => {
    if (categoryId === "principali") return true;
    return getCategoryForMarket(m) === categoryId;
  });

  const gFiltered = categoryId === "principali" ? pickPrincipali(goldMarkets) : goldMarkets;
  const kFiltered = categoryId === "principali" ? pickPrincipali(kambiMarkets) : kambiMarkets;

  // Both sources: 1 market = 1 entry with unified marketMatchKey
  const goldByKey = new Map<string, FlatMarketEntry>();
  for (const m of gFiltered) {
    const entry = flattenMarket(m, "gold");
    goldByKey.set(entry.key, entry);
  }

  const kambiByKey = new Map<string, FlatMarketEntry>();
  for (const m of kFiltered) {
    const entry = flattenMarket(m, "kambi");
    kambiByKey.set(entry.key, entry);
  }

  const allKeys = new Set([...goldByKey.keys(), ...kambiByKey.keys()]);
  const rows: ComparisonRow[] = [];

  for (const key of allKeys) {
    const gm = goldByKey.get(key);
    const km = kambiByKey.get(key);

    rows.push({
      marketName: gm?.name || km?.name || key,
      canon: gm?.canon || km?.canon || key,
      line: gm?.line ?? km?.line ?? null,
      category: categoryId,
      goldOutcomes: gm?.outcomes || [],
      kambiOutcomes: km?.outcomes || [],
      onlyGold: !!gm && !km,
      onlyKambi: !gm && !!km,
    });
  }

  // Sort: matched first, then exclusive
  rows.sort((a, b) => {
    if (a.onlyGold === b.onlyGold && a.onlyKambi === b.onlyKambi) {
      // Sort by line for same canon
      if (a.canon === b.canon && a.line != null && b.line != null) return a.line - b.line;
      return a.marketName.localeCompare(b.marketName);
    }
    if (!a.onlyGold && !a.onlyKambi) return -1;
    if (!b.onlyGold && !b.onlyKambi) return 1;
    return a.marketName.localeCompare(b.marketName);
  });

  return rows;
}

function pickPrincipali(markets: MarketDetail[]): MarketDetail[] {
  const result: MarketDetail[] = [];
  const nameL = (m: MarketDetail) => (m.name || "").toLowerCase();

  // 1X2
  const m1x2 = markets.find((m) => nameL(m) === "1x2" || nameL(m) === "esito finale 1x2");
  if (m1x2) result.push(m1x2);

  // U/O 2.5 — Goldbet: "U/O 2.5", Kambi: "Totale gol" with line=2.5
  const muo = markets.find((m) => {
    const n = nameL(m);
    if ((n.includes("under/over") || n.startsWith("u/o") || n.startsWith("o/u")) &&
      (n.includes("2.5") || m.line === 2.5)) return true;
    // Kambi: "Totale gol" with line=2.5 (separate market per line)
    if (n === "totale gol" && m.line === 2.5) return true;
    return false;
  });
  if (muo) result.push(muo);

  // GG/NG — Kambi: "Entrambe le squadre a segno (Gol/No Gol)"
  const mgg = markets.find((m) => {
    const n = nameL(m);
    return n.includes("gol/nogol") || n === "gg/ng" || n.includes("entrambe le squadre a segno");
  });
  if (mgg) result.push(mgg);

  // Doppia Chance — Goldbet "DC", Kambi "Doppia Chance"
  const mdc = markets.find((m) => nameL(m).includes("doppia chance") || nameL(m) === "dc");
  if (mdc) result.push(mdc);

  // Fallback: winner
  if (result.length === 0) {
    const winnerNames = ["t/t risultato", "testa a testa", "vincente incontro", "t/t match", "1x2 tempi reg."];
    const winner = markets.find((m) => winnerNames.includes(nameL(m)));
    if (winner) result.push(winner);
    const firstOU = markets.find((m) => nameL(m).startsWith("u/o") || nameL(m).startsWith("under/over"));
    if (firstOU) result.push(firstOU);
  }

  return result;
}
