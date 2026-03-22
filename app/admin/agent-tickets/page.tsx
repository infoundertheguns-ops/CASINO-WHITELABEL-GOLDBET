"use client";

import { useState } from "react";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: "#3b82f620", text: "#60a5fa", label: "IN CORSO" },
  won: { bg: "#10b98120", text: "#10b981", label: "VINTA" },
  lost: { bg: "#ef444420", text: "#ef4444", label: "PERSA" },
  void: { bg: "#f59e0b20", text: "#f59e0b", label: "VOID" },
  claimed: { bg: "#8b5cf620", text: "#a78bfa", label: "INCASSATA" },
  expired: { bg: "#6b728020", text: "#6b7280", label: "SCADUTA" },
};

export default function AgentTicketsPage() {
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<any>(null);
  const [selections, setSelections] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [claimMsg, setClaimMsg] = useState("");

  const handleVerify = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    setTicket(null);
    setClaimMsg("");

    try {
      const res = await fetch(`/api/tickets?code=${encodeURIComponent(code.trim())}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setTicket(data.ticket);
      setSelections(data.selections || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!ticket) return;
    setLoading(true);
    setClaimMsg("");
    try {
      const res = await fetch("/api/tickets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_code: ticket.ticket_code }),
      });
      const data = await res.json();
      if (!res.ok) { setClaimMsg(data.error); return; }
      setClaimMsg(`Pagato €${data.amount_paid.toFixed(2)}`);
      // Refresh ticket
      handleVerify();
    } catch (e: any) {
      setClaimMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  const st = ticket ? STATUS_STYLES[ticket.status] || STATUS_STYLES.open : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 700 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
        Verifica & Incasso Ticket
      </h2>

      {/* Search */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, padding: 20,
      }}>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>
          Inserisci o scansiona il codice ticket
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleVerify()}
            placeholder="TK-XXXXXX"
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 8,
              border: "1px solid #1e3a5f", background: "#0a0914",
              color: "#e2e8f0", fontSize: 18, fontFamily: "monospace",
              fontWeight: 700, letterSpacing: 2, textAlign: "center",
            }}
            autoFocus
          />
          <button onClick={handleVerify} disabled={loading}
            style={{
              padding: "12px 24px", borderRadius: 8, border: "none",
              background: "#3b82f6", color: "#fff", fontWeight: 700,
              fontSize: 14, cursor: "pointer", opacity: loading ? 0.5 : 1,
            }}>
            Verifica
          </button>
        </div>
      </div>

      {error && <div style={{ padding: 12, borderRadius: 8, background: "#ef444420", color: "#ef4444", fontSize: 13 }}>{error}</div>}

      {/* Ticket Result */}
      {ticket && (
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: `1px solid ${st?.text || "#1e3a5f"}40`,
          borderLeft: `4px solid ${st?.text || "#1e3a5f"}`,
          borderRadius: 12, padding: 20,
        }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: "#f0b429", letterSpacing: 2 }}>
                {ticket.ticket_code}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                {ticket.bet_type?.toUpperCase()} · {ticket.selections_count} selezioni
              </div>
            </div>
            <span style={{
              padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 800,
              background: st?.bg, color: st?.text,
            }}>
              {st?.label}
            </span>
          </div>

          {/* Selections */}
          {selections.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {selections.map((s: any, i: number) => (
                <div key={i} style={{
                  padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
                  display: "flex", justifyContent: "space-between", fontSize: 13,
                }}>
                  <div>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                      {s.events?.home_team} vs {s.events?.away_team}
                    </span>
                    {s.events?.score_home != null && (
                      <span style={{ color: "#60a5fa", fontFamily: "monospace", marginLeft: 8 }}>
                        {s.events.score_home}-{s.events.score_away}
                      </span>
                    )}
                  </div>
                  <span style={{ fontFamily: "monospace", color: "#f0b429", fontWeight: 700 }}>
                    {s.odds_at_placement?.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Amounts */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12,
            padding: "12px 0", borderTop: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Puntata</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "#e2e8f0" }}>
                €{ticket.stake?.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Quota</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "monospace", color: "#e2e8f0" }}>
                {ticket.total_odds?.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>
                {ticket.status === "won" ? "DA PAGARE" : "Vincita Pot."}
              </div>
              <div style={{
                fontSize: 18, fontWeight: 800, fontFamily: "monospace",
                color: ticket.status === "won" ? "#10b981" : "#e2e8f0",
              }}>
                €{(ticket.win_amount || ticket.potential_win || 0).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Claim Button */}
          {(ticket.status === "won" || ticket.status === "void") && (
            <div style={{ marginTop: 16 }}>
              <button onClick={handleClaim} disabled={loading}
                style={{
                  width: "100%", padding: "14px", borderRadius: 8, border: "none",
                  background: "#10b981", color: "#fff", fontWeight: 800,
                  fontSize: 16, cursor: "pointer", opacity: loading ? 0.5 : 1,
                }}>
                PAGA €{(ticket.win_amount || ticket.stake || 0).toFixed(2)}
              </button>
            </div>
          )}

          {ticket.status === "claimed" && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#8b5cf620", color: "#a78bfa", fontSize: 13, textAlign: "center" }}>
              Incassato il {new Date(ticket.claimed_at).toLocaleString("it-IT")}
            </div>
          )}

          {ticket.status === "lost" && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#ef444410", color: "#ef4444", fontSize: 13, textAlign: "center" }}>
              Scommessa persa — nessun pagamento
            </div>
          )}

          {ticket.status === "open" && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "#3b82f610", color: "#60a5fa", fontSize: 13, textAlign: "center" }}>
              Evento ancora in corso — attendere il risultato
            </div>
          )}

          {claimMsg && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "#10b98120", color: "#10b981", fontSize: 13, textAlign: "center", fontWeight: 700 }}>
              {claimMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
