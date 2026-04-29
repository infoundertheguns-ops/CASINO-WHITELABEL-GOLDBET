"use client";

import { useEffect, useState, useCallback } from "react";

interface Kiosk {
  id: string;
  code: string;
  name: string;
  agent_id: string;
  is_active: boolean;
  created_at: string;
  balance: number;
  has_active_session: boolean;
  last_heartbeat: string | null;
}

interface Agent {
  id: string;
  name: string;
  code: string;
  has_totp: boolean;
}

export default function KiosksPage() {
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [creating, setCreating] = useState(false);

  // Credit modal
  const [creditModal, setCreditModal] = useState<{
    kioskId: string;
    kioskName: string;
    action: "load" | "unload";
  } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditLoading, setCreditLoading] = useState(false);

  // TOTP modal
  const [totpModal, setTotpModal] = useState<{
    agentId: string;
    agentName: string;
  } | null>(null);
  const [totpData, setTotpData] = useState<{
    qrDataUrl: string;
    secret: string;
  } | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  // Link modal
  const [linkModal, setLinkModal] = useState<{
    code: string;
    name: string;
  } | null>(null);

  const loadKiosks = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/kiosks");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKiosks(data.kiosks || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/kiosks/agents");
      const data = await res.json();
      if (res.ok) setAgents(data.agents || []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadKiosks();
    loadAgents();
  }, [loadKiosks, loadAgents]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/kiosks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          ...(selectedAgentId && { agent_id: selectedAgentId }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreate(false);
      setNewName("");
      setSelectedAgentId("");
      loadKiosks();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleCredit = async () => {
    if (!creditModal || !creditAmount) return;
    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      setError("Importo non valido");
      return;
    }
    setCreditLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/kiosks/${creditModal.kioskId}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: creditModal.action, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCreditModal(null);
      setCreditAmount("");
      loadKiosks();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreditLoading(false);
    }
  };

  const handleKillSession = async (kioskId: string) => {
    if (!confirm("Disattivare tutte le sessioni attive di questo kiosk?")) return;
    setError("");
    try {
      const res = await fetch(`/api/admin/kiosks/${kioskId}/session`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadKiosks();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSetupTotp = async (agentId: string, agentName: string) => {
    setTotpModal({ agentId, agentName });
    setTotpData(null);
    setTotpLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/totp`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTotpData({ qrDataUrl: data.qrDataUrl, secret: data.secret });
      loadAgents();
    } catch (e: any) {
      setError(e.message);
      setTotpModal(null);
    } finally {
      setTotpLoading(false);
    }
  };

  const handleResetTotp = async (agentId: string) => {
    if (!confirm("Resettare il TOTP per questo agent? Dovrà riconfigurare Google Authenticator.")) return;
    setError("");
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/totp`, { method: "DELETE" });
      if (!res.ok) throw new Error("Errore reset TOTP");
      loadAgents();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const formatHeartbeat = (hb: string | null) => {
    if (!hb) return "\u2014";
    const diff = Date.now() - new Date(hb).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "adesso";
    if (mins < 60) return `${mins}m fa`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h fa`;
    return `${Math.floor(hours / 24)}g fa`;
  };

  const getAgentForKiosk = (agentId: string) => agents.find((a) => a.id === agentId);
  const kioskUrl = (code: string) => `https://play.betssolution.com?kiosk=${code}`;

  const btnStyle = (color: string) => ({
    padding: "3px 8px",
    borderRadius: 4,
    border: `1px solid ${color}40`,
    background: "transparent",
    color,
    cursor: "pointer" as const,
    fontSize: 11,
    fontWeight: 600 as const,
  });

  if (loading)
    return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
          Gestione Kiosk
        </h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
        >
          + Nuovo Kiosk
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: "#ef444420", color: "#ef4444", fontSize: 13 }}>
          {error}
          <button onClick={() => setError("")} aria-label="Chiudi avviso errore" style={{ marginLeft: 12, background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Nuovo Kiosk</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Nome</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="es. Sala Roma 1"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}
              />
            </div>
            {agents.length > 1 && (
              <div style={{ minWidth: 180 }}>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Agent</label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}
                >
                  <option value="">Auto (primo agent)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={handleCreate} disabled={creating} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: creating ? 0.5 : 1 }}>
              {creating ? "Creazione..." : "Crea Kiosk"}
            </button>
            <button onClick={() => setShowCreate(false)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Credit Modal */}
      {creditModal && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            {creditModal.action === "load" ? "Carica Credito" : "Scarica Credito"} — {creditModal.kioskName}
          </h3>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1, maxWidth: 200 }}>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Importo (EUR)</label>
              <input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} min="0.01" step="0.01" placeholder="0.00" onKeyDown={(e) => e.key === "Enter" && handleCredit()} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} />
            </div>
            <button onClick={handleCredit} disabled={creditLoading} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: creditModal.action === "load" ? "#10b981" : "#f59e0b", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: creditLoading ? 0.5 : 1 }}>
              {creditLoading ? "Elaborazione..." : creditModal.action === "load" ? "Carica" : "Scarica"}
            </button>
            <button onClick={() => { setCreditModal(null); setCreditAmount(""); }} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* TOTP Modal */}
      {totpModal && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #8b5cf640", borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Configura Authenticator — {totpModal.agentName}
          </h3>
          {totpLoading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}>Generazione QR code...</div>
          ) : totpData ? (
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 12px" }}>Scansiona con Google Authenticator:</p>
                <img src={totpData.qrDataUrl} alt="QR Code TOTP" style={{ width: 200, height: 200, borderRadius: 8, background: "#fff", padding: 8 }} />
              </div>
              <div style={{ flex: 1, minWidth: 250 }}>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px" }}>Oppure inserisci manualmente questo codice:</p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <code style={{ background: "#0a0914", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", color: "#f0b429", fontSize: 14, fontWeight: 700, letterSpacing: 2, wordBreak: "break-all" as const }}>
                    {totpData.secret}
                  </code>
                  <button onClick={() => copyToClipboard(totpData.secret)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}>
                    Copia
                  </button>
                </div>
                <div style={{ background: "#f59e0b15", border: "1px solid #f59e0b30", borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 12, color: "#f59e0b", margin: 0, fontWeight: 600 }}>Importante:</p>
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>
                    Salva questo codice in un posto sicuro. Se perdi l'accesso al telefono, dovrai resettare il TOTP dall'admin.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <button onClick={() => { setTotpModal(null); setTotpData(null); }} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* Link Modal */}
      {linkModal && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #10b98140", borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            Link Kiosk — {linkModal.name}
          </h3>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 12px" }}>Apri questo URL nel browser del terminale kiosk (Chrome kiosk mode):</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ background: "#0a0914", padding: "10px 16px", borderRadius: 6, border: "1px solid #1e3a5f", color: "#10b981", fontSize: 14, fontWeight: 600, flex: 1, wordBreak: "break-all" as const }}>
              {kioskUrl(linkModal.code)}
            </code>
            <button onClick={() => copyToClipboard(kioskUrl(linkModal.code))} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const }}>
              Copia Link
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setLinkModal(null)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* Agents TOTP Status */}
      {agents.length > 0 && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Authenticator Agenti</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {agents.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#0a0914", padding: "8px 14px", borderRadius: 8, border: "1px solid #1e3a5f" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.has_totp ? "#10b981" : "#ef4444", display: "inline-block" }} />
                <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: 11, color: "#64748b" }}>({a.code})</span>
                {a.has_totp ? (
                  <button onClick={() => handleResetTotp(a.id)} style={btnStyle("#f59e0b")}>Reset</button>
                ) : (
                  <button onClick={() => handleSetupTotp(a.id, a.name)} style={btnStyle("#8b5cf6")}>Configura TOTP</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kiosk Table */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
              {["Codice", "Nome", "Saldo", "Sessione", "Heartbeat", "Stato", "Azioni"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kiosks.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Nessun kiosk</td></tr>
            ) : (
              kiosks.map((k) => {
                const agent = getAgentForKiosk(k.agent_id);
                return (
                  <tr key={k.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "#f0b429" }}>{k.code}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{k.name}</span>
                      {agent && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6 }}>{agent.name}</span>}
                    </td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: k.balance > 0 ? "#10b981" : "#94a3b8" }}>
                      {"\u20AC"}{Number(k.balance).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.has_active_session ? "#10b981" : "#64748b", display: "inline-block" }} />
                        <span style={{ fontSize: 12, color: k.has_active_session ? "#10b981" : "#64748b" }}>{k.has_active_session ? "Attiva" : "Inattiva"}</span>
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>{formatHeartbeat(k.last_heartbeat)}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: k.is_active ? "#10b98120" : "#ef444420", color: k.is_active ? "#10b981" : "#ef4444" }}>
                        {k.is_active ? "ATTIVO" : "DISATTIVO"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button onClick={() => setLinkModal({ code: k.code, name: k.name })} style={btnStyle("#3b82f6")}>Link</button>
                        <button onClick={() => setCreditModal({ kioskId: k.id, kioskName: k.name, action: "load" })} style={btnStyle("#10b981")}>+ Carica</button>
                        <button onClick={() => setCreditModal({ kioskId: k.id, kioskName: k.name, action: "unload" })} style={btnStyle("#f59e0b")}>- Scarica</button>
                        {k.has_active_session && (
                          <button onClick={() => handleKillSession(k.id)} style={btnStyle("#ef4444")}>Kill</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
