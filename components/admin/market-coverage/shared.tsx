"use client";

import type React from "react";

// ═══ TYPES ═══

export interface EventDetail {
  event: {
    id: string;
    home_team: string;
    away_team: string;
    starts_at: string;
    status: string;
    source: string;
    sport_name: string;
    league_name: string;
    source_markets_count: number | null;
  };
  vincitu_count: number;
  market_types: { type: string; count: number; markets: string[] }[];
}

// ═══ HELPERS ═══

export function formatNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
  return n.toLocaleString("it-IT");
}

export function formatNumFull(n: number): string {
  return n.toLocaleString("it-IT");
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** Coverage % color: green >=95, yellow >=80, red <80 */
export function coverageColor(pct: number | null): string {
  if (pct == null) return "var(--admin-text-muted, #94a3b8)";
  if (pct >= 95) return "#10b981";
  if (pct >= 80) return "#f59e0b";
  return "#ef4444";
}

export function coverageBg(pct: number | null): string {
  if (pct == null) return "transparent";
  if (pct >= 95) return "#10b98115";
  if (pct >= 80) return "#f59e0b15";
  return "#ef444415";
}

export function exportCsv(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const escape = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px", borderRadius: 8,
        border: "1px solid var(--admin-border, #1e3a5f)",
        background: "transparent", color: "var(--admin-text-muted, #94a3b8)",
        cursor: "pointer", fontSize: 12, fontWeight: 600, textTransform: "uppercase",
        display: "flex", alignItems: "center", gap: 6,
        transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#e2e8f0"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; }}
    >
      Esporta CSV
    </button>
  );
}

export async function fetchApi(action: string, params: Record<string, string> = {}, source: string = "leon") {
  const sp = new URLSearchParams({ action, source, ...params });
  const res = await fetch(`/api/admin/market-coverage?${sp}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ═══ DONUT RING SVG ═══

export function DonutRing({ pct, size = 56, strokeWidth = 6 }: { pct: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = coverageColor(pct);

  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
    </svg>
  );
}

// ═══ SUB-COMPONENTS ═══

export function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--admin-text-muted, #94a3b8)" }}>
        {label}:
      </span>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--admin-bg, #0a1929)", border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 6, color: "var(--admin-text, #e2e8f0)", padding: "8px 12px", fontSize: 13,
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function KPICard({ label, value, color, subtitle, children }: {
  label: string; value: string; color: string; subtitle?: string; children?: React.ReactNode;
}) {
  return (
    <div style={{
      background: "var(--admin-card, #0f1f35)", border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 12, padding: 24, textAlign: "center",
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--admin-text-muted, #94a3b8)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
        {children}
        <div style={{ fontSize: 32, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.1 }}>{value}</div>
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

export function CollapsibleSection({ title, open, onToggle, children, badge, badgeColor }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
  badge?: number; badgeColor?: string;
}) {
  return (
    <div style={{
      background: "var(--admin-card, #0f1f35)", border: "1px solid var(--admin-border, #1e3a5f)",
      borderRadius: 12, overflow: "hidden",
    }}>
      <div onClick={onToggle} style={{
        padding: "14px 20px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
        background: "rgba(255,255,255,0.02)",
        borderBottom: open ? "1px solid var(--admin-border, #1e3a5f)" : "none",
      }}>
        <span style={{ fontSize: 12, color: "var(--admin-text-muted)" }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--admin-text, #e2e8f0)" }}>
          {title}
        </span>
        {badge != null && badge > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10,
            background: `${badgeColor || "#f59e0b"}20`, color: badgeColor || "#f59e0b",
          }}>{badge}</span>
        )}
      </div>
      {open && children}
    </div>
  );
}

export function EventDetailModal({ detail, loading, onClose }: {
  detail: EventDetail | null; loading: boolean; onClose: () => void;
}) {
  const sourceCount = detail?.event.source_markets_count;
  const dbCount = detail?.vincitu_count ?? 0;
  const gap = sourceCount != null ? sourceCount - dbCount : null;

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--admin-card, #0f1f35)", border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, padding: 24, minWidth: 500, maxWidth: 700, maxHeight: "80vh", overflowY: "auto",
      }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Caricamento...</div>
        ) : detail ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
                  {detail.event.home_team} vs {detail.event.away_team}
                </h3>
                <div style={{ fontSize: 12, color: "var(--admin-text-muted)", marginTop: 4, display: "flex", gap: 12 }}>
                  <span>{detail.event.sport_name} · {detail.event.league_name}</span>
                  <span style={{ color: detail.event.status === "live" ? "#10b981" : "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>
                    {detail.event.status}
                  </span>
                  <span>{formatTime(detail.event.starts_at)}</span>
                </div>
              </div>
              <button onClick={onClose} style={{
                background: "transparent", border: "none", color: "var(--admin-text-muted)",
                fontSize: 18, cursor: "pointer", padding: "4px 8px",
              }}>✕</button>
            </div>

            <div style={{
              padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8,
              marginBottom: 16, display: "flex", gap: 24,
            }}>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#f59e0b" }}>Leon</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#f59e0b", fontFamily: "monospace" }}>
                  {sourceCount != null ? sourceCount : "\u2014"}
                </div>
              </div>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#60a5fa" }}>DB</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#60a5fa", fontFamily: "monospace" }}>{dbCount}</div>
              </div>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--admin-text-muted)" }}>Gap</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: gap != null && gap > 0 ? "#ef4444" : "#10b981", fontFamily: "monospace" }}>
                  {gap != null ? (gap > 0 ? `\u2212${gap}` : gap === 0 ? "0" : `+${Math.abs(gap)}`) : "\u2014"}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--admin-text-muted)", marginBottom: 8, letterSpacing: 0.5 }}>
              Distribuzione per Tipo ({detail.market_types.length} tipi)
            </div>

            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {detail.market_types.map((mt) => (
                <div key={mt.type} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "6px 12px", borderBottom: "1px solid rgba(255,255,255,0.03)",
                }}>
                  <div style={{ fontSize: 12, color: "var(--admin-text, #e2e8f0)" }}>{mt.type}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: Math.max(4, (mt.count / (detail.market_types[0]?.count || 1)) * 120),
                      height: 8, borderRadius: 4, background: "#2563eb",
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)", minWidth: 24, textAlign: "right" }}>
                      {mt.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun dettaglio</div>
        )}
      </div>
    </div>
  );
}
