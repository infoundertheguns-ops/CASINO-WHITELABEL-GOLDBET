import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { Kpi, KpiRow as KpiRowComp, GlossaryTerm } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shade Monitor" };

interface KpiRow { label: string; value: string; }
interface TopMarketRow { sport: string; market_canonical_key: string; canonical_outcome_key: string; shade_count: number; }
interface HistogramRow { bucket: string; count: number; }
interface SportRow { slug: string; name: string; events_count: number; shade_active_count: number; }
interface EventRow {
  flashscore_id: string;
  event_id: string;
  sport: string;
  league: string;
  home: string;
  away: string;
  starts_at: string | null;
  outcomes_count: number;
  shade_count: number;
  multi_source_count: number;
  status: string;
}
interface DetailRow {
  market_canonical_key: string;
  canonical_outcome_key: string;
  kambi_odds: number | null;
  kambi_active: boolean | null;
  kambi_suspended: boolean | null;
  twobet_odds: number | null;
  twobet_active: boolean | null;
  twobet_suspended: boolean | null;
  betfair_odds: number | null;
  betfair_active: boolean | null;
  betfair_suspended: boolean | null;
  manual_odds: number | null;
  manual_suspended: boolean | null;
  canonical_verified: boolean;
  displayed_odds: number | null;
  n_sources: number;
  min_source: string | null;
}

export default async function ShadeMonitorPage({
  searchParams,
}: {
  searchParams?: Promise<{ sport?: string; event?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedSport = params.sport ?? "";
  const selectedEvent = params.event ?? "";

  const supa = createAdminClient();

  const [
    { data: kpis },
    { data: topMarkets },
    { data: spread },
    { data: sports },
    { data: events },
    { data: detail },
  ] = await Promise.all([
    supa.rpc("shade_monitor_kpis"),
    supa.rpc("shade_monitor_top_markets", { p_limit: 20 }),
    supa.rpc("shade_monitor_spread_histogram"),
    supa.rpc("shade_monitor_sports"),
    supa.rpc("shade_monitor_events", { p_sport: selectedSport || null, p_limit: 100 }),
    selectedEvent
      ? supa.rpc("shade_monitor_event_detail", { p_flashscore_id: selectedEvent })
      : Promise.resolve({ data: [] as DetailRow[] }),
  ]);

  const kpiRows = (kpis as KpiRow[] | null) ?? [];
  const topRows = (topMarkets as TopMarketRow[] | null) ?? [];
  const histRows = (spread as HistogramRow[] | null) ?? [];
  const sportRows = (sports as SportRow[] | null) ?? [];
  const eventRows = (events as EventRow[] | null) ?? [];
  const detailRows = (detail as DetailRow[] | null) ?? [];

  const eventMeta = selectedEvent ? eventRows.find((e) => e.flashscore_id === selectedEvent) : null;

  return (
    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--admin-text)", margin: 0 }}>
          Shade Monitor
        </h1>
        <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 4, marginBottom: 0 }}>
          Rolling view of <GlossaryTerm term="shade-to-min">shade-to-min</GlossaryTerm> activity across multi-source <GlossaryTerm term="canonical_verified">canonical</GlossaryTerm> outcomes (legacy 3-source debug view).
        </p>
      </div>

      {/* KPI cards — E9 shared primitive, E8 GlossaryTerm */}
      <KpiRowComp minWidth={200}>
        {kpiRows.map((k, i) => (
          <Kpi
            key={String(k.label)}
            label={k.label}
            value={Number(k.value).toLocaleString("it-IT")}
            accent={i === 1 ? "#f97316" : i === 4 ? "#f0b429" : undefined}
          />
        ))}
      </KpiRowComp>

      {/* ─── DRILL-DOWN ────────────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text)", marginBottom: 8, marginTop: 0 }}>
          Drill-down 3-source (Kambi | 22bet | Betfair | MIN)
        </h2>

        {/* Sport filter tabs */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          <SportTab slug="" name="Tutti" count={null} selected={selectedSport === ""} />
          {sportRows.map((s) => (
            <SportTab key={s.slug} slug={s.slug} name={s.name} count={s.shade_active_count} selected={selectedSport === s.slug} />
          ))}
        </div>

        {/* Events list */}
        {!selectedEvent && (
          <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                  <Th>Sport</Th>
                  <Th>League</Th>
                  <Th>Match</Th>
                  <Th>Kickoff</Th>
                  <Th align="right">Outcomes</Th>
                  <Th align="right">Multi-src</Th>
                  <Th align="right">Shade</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {eventRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "var(--admin-text-muted)", padding: "20px" }}>
                      Nessun evento in questa categoria.
                    </td>
                  </tr>
                ) : eventRows.map((e) => (
                  <tr key={e.flashscore_id} style={{ borderTop: "1px solid var(--admin-border)" }}>
                    <td style={tdStyle}>{e.sport}</td>
                    <td style={tdStyle}>{e.league}</td>
                    <td style={tdStyle}>
                      <Link
                        href={`/admin/shade-monitor?sport=${selectedSport}&event=${encodeURIComponent(e.flashscore_id)}`}
                        style={{ color: "var(--admin-text)", textDecoration: "none", fontWeight: 600 }}
                      >
                        {e.home} <span style={{ color: "var(--admin-text-muted)" }}>vs</span> {e.away}
                      </Link>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "var(--admin-text-muted)" }}>
                      {e.starts_at ? new Date(e.starts_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.outcomes_count}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.multi_source_count}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: e.shade_count > 0 ? "#f97316" : "var(--admin-text-muted)" }}>
                      {e.shade_count}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 10, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5,
                        color: e.status === "live" ? "#22c55e" : "var(--admin-text-muted)",
                      }}>
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Event detail */}
        {selectedEvent && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <Link
                  href={`/admin/shade-monitor${selectedSport ? `?sport=${selectedSport}` : ""}`}
                  style={{ fontSize: 12, color: "var(--admin-text-muted)", textDecoration: "none" }}
                >
                  ← Tutti gli eventi
                </Link>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--admin-text)", marginTop: 4 }}>
                  {eventMeta ? `${eventMeta.home} vs ${eventMeta.away}` : selectedEvent}
                </div>
                {eventMeta && (
                  <div style={{ fontSize: 12, color: "var(--admin-text-muted)", marginTop: 2 }}>
                    {eventMeta.sport} · {eventMeta.league} · {eventMeta.starts_at ? new Date(eventMeta.starts_at).toLocaleString("it-IT") : "—"}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--admin-text-muted)", fontFamily: "monospace" }}>
                {selectedEvent}
              </div>
            </div>

            <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                    <Th>Market</Th>
                    <Th>Outcome</Th>
                    <Th align="right">Kambi</Th>
                    <Th align="right">22bet</Th>
                    <Th align="right">Betfair</Th>
                    <Th align="right" accent="#f97316">MIN (displayed)</Th>
                    <Th>Source MIN</Th>
                    <Th>Verif</Th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "var(--admin-text-muted)", padding: "20px" }}>
                        Nessuna outcome canonical per questo evento.
                      </td>
                    </tr>
                  ) : detailRows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--admin-border)" }}>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{r.market_canonical_key}</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{r.canonical_outcome_key}</td>
                      <OddsCell odds={r.kambi_odds} active={r.kambi_active} suspended={r.kambi_suspended} isMin={r.min_source === "kambi"} />
                      <OddsCell odds={r.twobet_odds} active={r.twobet_active} suspended={r.twobet_suspended} isMin={r.min_source === "22bet"} />
                      <OddsCell odds={r.betfair_odds} active={r.betfair_active} suspended={r.betfair_suspended} isMin={r.min_source === "betfair"} />
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800, color: r.displayed_odds ? "#f97316" : "var(--admin-text-muted)" }}>
                        {r.manual_suspended ? "🔴 MANUAL" : r.displayed_odds != null ? Number(r.displayed_odds).toFixed(2) : "—"}
                      </td>
                      <td style={tdStyle}>
                        {r.min_source && (
                          <span style={{
                            fontSize: 10, textTransform: "uppercase", fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                            background: r.min_source === "kambi" ? "rgba(139,92,246,0.2)" : r.min_source === "22bet" ? "rgba(34,197,94,0.2)" : "rgba(251,146,60,0.2)",
                            color: r.min_source === "kambi" ? "#a78bfa" : r.min_source === "22bet" ? "#4ade80" : "#fb923c",
                          }}>
                            {r.min_source}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 10, color: r.canonical_verified ? "#4ade80" : "var(--admin-text-muted)" }}>
                          {r.canonical_verified ? "✓ verified" : "unverified"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Top markets table */}
      <section>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text)", marginBottom: 8, marginTop: 0 }}>
          Top canonical markets by shade frequency
        </h2>
        {topRows.length === 0 ? (
          <div style={{
            padding: "24px 16px",
            border: "1px solid var(--admin-border)",
            borderRadius: 10,
            background: "var(--admin-card)",
            color: "var(--admin-text-muted)",
            fontSize: 13,
            textAlign: "center",
          }}>
            Nessun evento shade attivo. Il flag shade-to-min e&apos; OFF oppure tutte le sorgenti sono allineate.
          </div>
        ) : (
          <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                  <Th>Sport</Th>
                  <Th>Market canonical</Th>
                  <Th>Outcome canonical</Th>
                  <Th align="right">Shade count</Th>
                </tr>
              </thead>
              <tbody>
                {topRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--admin-border)" }}>
                    <td style={tdStyle}>{r.sport}</td>
                    <td style={tdStyle}><code style={{ fontSize: 12 }}>{r.market_canonical_key}</code></td>
                    <td style={tdStyle}><code style={{ fontSize: 12 }}>{r.canonical_outcome_key}</code></td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                      {Number(r.shade_count).toLocaleString("it-IT")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Spread histogram */}
      <section>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--admin-text)", marginBottom: 8, marginTop: 0 }}>
          Distribuzione spread (delta pre-shade tra sorgenti)
        </h2>
        {histRows.length === 0 ? (
          <div style={{
            padding: "24px 16px",
            border: "1px solid var(--admin-border)",
            borderRadius: 10,
            background: "var(--admin-card)",
            color: "var(--admin-text-muted)",
            fontSize: 13,
            textAlign: "center",
          }}>
            Nessun outcome con 2+ sorgenti attive.
          </div>
        ) : (
          <div style={{ border: "1px solid var(--admin-border)", borderRadius: 10, overflow: "auto", background: "var(--admin-card)", maxWidth: 480 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                  <Th>Bucket spread</Th>
                  <Th align="right">Conteggio</Th>
                </tr>
              </thead>
              <tbody>
                {histRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--admin-border)" }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace" }}>{r.bucket}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {Number(r.count).toLocaleString("it-IT")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── UI primitives ───────────────────────────────────────────────


function SportTab({ slug, name, count, selected }: { slug: string; name: string; count: number | null; selected: boolean }) {
  return (
    <Link
      href={`/admin/shade-monitor${slug ? `?sport=${slug}` : ""}`}
      style={{
        padding: "6px 12px",
        borderRadius: 18,
        fontSize: 12,
        fontWeight: 600,
        textDecoration: "none",
        background: selected ? "rgba(249, 115, 22, 0.18)" : "rgba(255, 255, 255, 0.04)",
        color: selected ? "#fb923c" : "var(--admin-text-muted)",
        border: `1px solid ${selected ? "rgba(249, 115, 22, 0.4)" : "var(--admin-border)"}`,
        textTransform: "capitalize",
      }}
    >
      {name}
      {count != null && count > 0 && (
        <span style={{ marginLeft: 6, fontVariantNumeric: "tabular-nums", fontSize: 11, opacity: 0.8 }}>
          ({Number(count).toLocaleString("it-IT")})
        </span>
      )}
    </Link>
  );
}

function OddsCell({ odds, active, suspended, isMin }: { odds: number | null; active: boolean | null; suspended: boolean | null; isMin: boolean }) {
  const isAvail = odds != null && active && !suspended;
  return (
    <td style={{
      ...tdStyle,
      textAlign: "right",
      fontVariantNumeric: "tabular-nums",
      fontWeight: isMin ? 800 : 500,
      color: !isAvail ? "var(--admin-text-muted)" : isMin ? "#f97316" : "var(--admin-text)",
      background: isMin ? "rgba(249, 115, 22, 0.08)" : undefined,
    }}>
      {odds == null ? "—" : !active ? `(${Number(odds).toFixed(2)})` : suspended ? `⏸ ${Number(odds).toFixed(2)}` : Number(odds).toFixed(2)}
    </td>
  );
}

const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top", color: "var(--admin-text)" };

function Th({ children, align = "left", accent }: { children: React.ReactNode; align?: "left" | "right"; accent?: string }) {
  return (
    <th style={{
      padding: "10px 12px",
      textAlign: align,
      fontSize: 11,
      textTransform: "uppercase",
      color: accent || "var(--admin-text-muted)",
      fontWeight: 700,
      letterSpacing: 0.5,
    }}>
      {children}
    </th>
  );
}
