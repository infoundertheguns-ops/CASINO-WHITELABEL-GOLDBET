"use client";

import { useCallback, useEffect, useState } from "react";

// E1.F2a — Manual assign modal for Event Normalization.
// Replaces the browser prompt() with a searchable Flashscore fixture picker.
// UX: search live by team name, filter by date window (±12h from event.starts_at),
// paste Flashscore URL to auto-extract match_id, preview chosen fixture, confirm.

interface Fixture {
  id: string;
  sport: string | null;
  country: string | null;
  league: string | null;
  home_team: string;
  away_team: string;
  match_date: string;
  be_match_id: string | null;
}

interface EventToAssign {
  id: string;
  home_team: string;
  away_team: string;
  starts_at?: string | null;
  sport?: string | null; // raw sport name from events table (e.g. "Calcio", "Tennis")
}

// Map frontend sport labels → be_fixtures.sport values.
function sportSlug(sport: string | null | undefined): string | null {
  if (!sport) return null;
  const s = sport.toLowerCase();
  if (s.includes("calcio") || s.includes("football") || s.includes("soccer")) return "football";
  if (s.includes("tennis tavolo")) return "tennis_tavolo";
  if (s.includes("tennis")) return "tennis";
  if (s.includes("basket")) return "basketball";
  if (s.includes("hockey")) return "hockey";
  if (s.includes("volley")) return "volleyball";
  if (s.includes("pallamano") || s.includes("handball")) return "handball";
  if (s.includes("baseball")) return "baseball";
  if (s.includes("rugby")) return "rugby";
  if (s.includes("cricket")) return "cricket";
  if (s.includes("esport")) return "esports";
  return null;
}

// Parse Flashscore URL to extract match_id.
// Formats accepted:
//   https://www.flashscore.it/partita/slug/ABCDEFGH/
//   https://www.flashscore.com/match/ABCDEFGH/#/match-summary
//   ABCDEFGH (raw)
// Returns null if no valid 8-char alphanumeric ID found.
export function extractFlashscoreId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Raw 8-char match_id: usually uppercase alphanumeric
  if (/^[A-Za-z0-9]{8}$/.test(s)) return s;
  // Try to extract from URL: look for /XXXXXXXX/ or /XXXXXXXX# or at end
  const urlMatch = s.match(/\/([A-Za-z0-9]{8})(?:\/|#|$)/);
  if (urlMatch) return urlMatch[1];
  return null;
}

export function ManualAssignModal({
  event,
  onClose,
  onAssigned,
}: {
  event: EventToAssign;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [search, setSearch] = useState("");
  const [rawId, setRawId] = useState("");
  const [useDateWindow, setUseDateWindow] = useState(true);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selected, setSelected] = useState<Fixture | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Default search to away vs home team names
  useEffect(() => {
    setSearch(event.home_team || event.away_team || "");
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        action: "list",
        page: "1",
        page_size: "50",
      });
      if (search.trim()) params.set("search", search.trim());
      const sp = sportSlug(event.sport);
      if (sp) params.set("sport", sp);
      if (useDateWindow && event.starts_at) {
        const ts = new Date(event.starts_at).getTime();
        const from = new Date(ts - 12 * 3600 * 1000).toISOString().slice(0, 10);
        const to = new Date(ts + 12 * 3600 * 1000).toISOString().slice(0, 10);
        params.set("date_from", from);
        params.set("date_to", to);
      }
      const r = await fetch(`/api/admin/fixtures?${params}`).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setFixtures(r.fixtures ?? []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [search, useDateWindow, event.starts_at, event.sport]);

  // Debounced auto-search
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [load]);

  const assign = async (flashscoreId: string) => {
    if (!flashscoreId) {
      setError("Flashscore ID mancante");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/event-normalization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual-assign", event_id: event.id, flashscore_id: flashscoreId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      onAssigned();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmByUrl = async () => {
    const id = extractFlashscoreId(rawId);
    if (!id) {
      setError("URL/ID non riconosciuto. Atteso ID 8 caratteri o URL Flashscore.");
      return;
    }
    await assign(id);
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const fmtDate = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--admin-text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Assegna Flashscore ID
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
              {event.home_team} <span style={{ color: "var(--admin-text-muted)" }}>vs</span> {event.away_team}
            </div>
            <div style={{ fontSize: 11, color: "var(--admin-text-muted)", marginTop: 2 }}>
              {event.sport ?? "—"} · {event.starts_at ? fmtDate(event.starts_at) : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ padding: "4px 10px", background: "transparent", border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text-muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {error && (
          <div style={{ padding: 10, marginBottom: 12, background: "#ef444422", border: "1px solid #ef4444", borderRadius: 6, color: "#fca5a5", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Paste URL / raw ID row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, padding: "10px 12px", background: "rgba(139,92,246,0.06)", border: "1px solid #8b5cf644", borderRadius: 8 }}>
          <input
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            placeholder="Incolla URL Flashscore o match_id 8 caratteri"
            style={{ flex: 1, padding: "6px 10px", background: "var(--admin-bg, #0a1929)", border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text)", fontFamily: "monospace", fontSize: 12 }}
          />
          <button
            onClick={confirmByUrl}
            disabled={saving || !rawId.trim()}
            style={{ padding: "6px 14px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer", opacity: saving || !rawId.trim() ? 0.5 : 1 }}
          >
            {saving ? "…" : "Usa questo"}
          </button>
        </div>

        {/* Search controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca team…"
            style={{ flex: 1, padding: "6px 10px", background: "var(--admin-bg, #0a1929)", border: "1px solid var(--admin-border)", borderRadius: 6, color: "var(--admin-text)", fontSize: 13 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--admin-text-muted)" }}>
            <input type="checkbox" checked={useDateWindow} onChange={(e) => setUseDateWindow(e.target.checked)} />
            ±12h da starts_at
          </label>
        </div>

        {/* Fixtures list */}
        <div style={{ border: "1px solid var(--admin-border)", borderRadius: 8, overflow: "auto", maxHeight: 400 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                <th style={thStyle}>Data</th>
                <th style={thStyle}>Sport</th>
                <th style={thStyle}>Lega</th>
                <th style={thStyle}>Home</th>
                <th style={thStyle}>Away</th>
                <th style={thStyle}>FS ID</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {loading && fixtures.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Caricamento…</td></tr>
              )}
              {!loading && fixtures.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "var(--admin-text-muted)" }}>Nessun risultato. Prova a disabilitare "±12h" o rilassare la search.</td></tr>
              )}
              {fixtures.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setSelected(f)}
                  style={{
                    borderTop: "1px solid var(--admin-border)",
                    cursor: "pointer",
                    background: selected?.id === f.id ? "rgba(139,92,246,0.15)" : undefined,
                  }}
                >
                  <td style={tdStyle}>{fmtDate(f.match_date)}</td>
                  <td style={tdStyle}>{f.sport ?? "—"}</td>
                  <td style={{ ...tdStyle, fontSize: 11, color: "var(--admin-text-muted)" }}>{f.country ? `${f.country} · ` : ""}{f.league ?? "—"}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{f.home_team}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{f.away_team}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, color: "#8b5cf6" }}>{f.be_match_id ?? "—"}</td>
                  <td style={tdStyle}>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (f.be_match_id) void assign(f.be_match_id); }}
                      disabled={saving || !f.be_match_id}
                      style={{ padding: "3px 10px", background: "#10b98122", border: "1px solid #10b981", color: "#10b981", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: f.be_match_id ? "pointer" : "not-allowed", opacity: f.be_match_id ? 1 : 0.4 }}
                    >
                      ✓ Assegna
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bottom actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          {selected && (
            <>
              <span style={{ fontSize: 12, color: "var(--admin-text-muted)" }}>
                Selezionato: <code style={{ color: "#8b5cf6" }}>{selected.be_match_id}</code>
              </span>
              <button
                onClick={() => selected.be_match_id && assign(selected.be_match_id)}
                disabled={saving || !selected.be_match_id}
                style={{ padding: "6px 14px", background: "#10b981", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
              >
                {saving ? "Assegnazione…" : "✓ Conferma"}
              </button>
            </>
          )}
          <button onClick={onClose} style={{ marginLeft: "auto", padding: "6px 14px", background: "transparent", border: "1px solid var(--admin-border)", color: "var(--admin-text-muted)", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>Annulla</button>
        </div>
      </div>
    </div>
  );
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
