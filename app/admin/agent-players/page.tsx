"use client";

import { useEffect, useState, useCallback } from "react";

export default function AgentPlayersPage() {
  const [players, setPlayers] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creditPlayer, setCreditPlayer] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditMsg, setCreditMsg] = useState("");
  const [processing, setProcessing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      const me = await meRes.json();
      const userId = me.user?.id;
      if (!userId) return;

      const agentsRes = await fetch("/api/admin/agents");
      const agentsData = await agentsRes.json();
      const myAgent = (agentsData.agents || []).find((a: any) => a.user_id === userId);
      if (!myAgent) return;
      setAgentId(myAgent.id);

      const playersRes = await fetch(`/api/admin/agents/${myAgent.id}/players`);
      const playersData = await playersRes.json();
      setPlayers(playersData.players || []);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCredit = async (playerId: string, action: "load" | "unload") => {
    const amount = parseFloat(creditAmount);
    if (!amount || amount <= 0) return;
    setProcessing(true);
    setCreditMsg("");
    try {
      const res = await fetch("/api/agent/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId, action, amount }),
      });
      const data = await res.json();
      if (!res.ok) { setCreditMsg(data.error); return; }
      setCreditMsg(`${action === "load" ? "Caricato" : "Scaricato"} €${amount} — Nuovo saldo: €${data.player_balance.toFixed(2)}`);
      setCreditAmount("");
      loadData();
    } catch (e: any) { setCreditMsg(e.message); }
    finally { setProcessing(false); }
  };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento giocatori...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>I Miei Giocatori</h2>

      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid #1e3a5f" }}>
              {["Username", "Tipo", "Saldo", "Attivo", "Ultimo Login", "Credito"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Nessun giocatore</td></tr>
            ) : players.map(p => (
              <>
                <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "#e2e8f0" }}>{p.username}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: p.player_type === "kiosk" ? "#f59e0b20" : "#3b82f620", color: p.player_type === "kiosk" ? "#f59e0b" : "#60a5fa" }}>
                      {(p.player_type || "online").toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "#10b981", fontSize: 15 }}>
                    €{(p.balance || 0).toFixed(2)}
                  </td>
                  <td style={{ padding: "10px 12px", color: p.is_active ? "#10b981" : "#ef4444" }}>{p.is_active ? "Si" : "No"}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#94a3b8", fontSize: 11 }}>
                    {p.last_login ? new Date(p.last_login).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button
                      onClick={() => setCreditPlayer(creditPlayer === p.id ? null : p.id)}
                      style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: creditPlayer === p.id ? "#f0b42920" : "transparent", color: creditPlayer === p.id ? "#f0b429" : "#94a3b8", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      {creditPlayer === p.id ? "Chiudi" : "Carica / Scarica"}
                    </button>
                  </td>
                </tr>
                {creditPlayer === p.id && (
                  <tr key={`${p.id}-credit`}>
                    <td colSpan={6} style={{ padding: "8px 12px", background: "rgba(255,255,255,0.02)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="number"
                          value={creditAmount}
                          onChange={e => setCreditAmount(e.target.value)}
                          placeholder="Importo"
                          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13, width: 120 }}
                        />
                        <button onClick={() => handleCredit(p.id, "load")} disabled={processing}
                          style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          Carica
                        </button>
                        <button onClick={() => handleCredit(p.id, "unload")} disabled={processing}
                          style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                          Scarica
                        </button>
                        {creditMsg && <span style={{ fontSize: 12, color: creditMsg.includes("Errore") || creditMsg.includes("insufficiente") ? "#ef4444" : "#10b981", fontWeight: 600 }}>{creditMsg}</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
