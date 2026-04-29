"use client";

import { useEffect, useState, useCallback } from "react";

interface Kiosk {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  balance: number;
  has_active_session: boolean;
  last_heartbeat: string | null;
}

export default function AgentKiosksPage() {
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [totpConfigured, setTotpConfigured] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");

  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Credit
  const [creditModal, setCreditModal] = useState<{ kioskId: string; kioskName: string; action: "load" | "unload" } | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditLoading, setCreditLoading] = useState(false);

  // TOTP
  const [showTotp, setShowTotp] = useState(false);
  const [totpData, setTotpData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  // Link
  const [linkModal, setLinkModal] = useState<{ code: string; name: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/kiosks");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKiosks(data.kiosks || []);
      setTotpConfigured(data.totp_configured ?? false);
      setAgentId(data.agent_id ?? "");
      setAgentName(data.agent_name ?? "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/agent/kiosks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreate(false);
      setNewName("");
      loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleCredit = async () => {
    if (!creditModal || !creditAmount) return;
    const amount = parseFloat(creditAmount);
    if (isNaN(amount) || amount <= 0) { setError("Importo non valido"); return; }
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
      loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreditLoading(false);
    }
  };

  const handleKillSession = async (kioskId: string) => {
    if (!confirm("Disattivare la sessione di questo kiosk?")) return;
    try {
      const res = await fetch(`/api/admin/kiosks/${kioskId}/session`, { method: "DELETE" });
      if (!res.ok) throw new Error("Errore");
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSetupTotp = async () => {
    if (!agentId) return;
    setShowTotp(true);
    setTotpData(null);
    setTotpLoading(true);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/totp`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTotpData({ qrDataUrl: data.qrDataUrl, secret: data.secret });
      setTotpConfigured(true);
    } catch (e: any) {
      setError(e.message);
      setShowTotp(false);
    } finally {
      setTotpLoading(false);
    }
  };

  const handleResetTotp = async () => {
    if (!confirm("Resettare il TOTP? Dovrai riconfigurare Google Authenticator.")) return;
    try {
      await fetch(`/api/admin/agents/${agentId}/totp`, { method: "DELETE" });
      setTotpConfigured(false);
      setTotpData(null);
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text).catch(() => {}); };
  const kioskUrl = (code: string) => `https://play.betssolution.com?kiosk=${code}`;

  const formatHeartbeat = (hb: string | null) => {
    if (!hb) return "\u2014";
    const diff = Date.now() - new Date(hb).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "adesso";
    if (mins < 60) return `${mins}m fa`;
    const hours = Math.floor(mins / 60);
    return hours < 24 ? `${hours}h fa` : `${Math.floor(hours / 24)}g fa`;
  };

  const btn = (color: string) => ({
    padding: "3px 8px" as const, borderRadius: 4, border: `1px solid ${color}40`,
    background: "transparent", color, cursor: "pointer" as const, fontSize: 11, fontWeight: 600 as const,
  });

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>I Miei Kiosk</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowCreate(!showCreate)} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            + Nuovo Kiosk
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: "#ef444420", color: "#ef4444", fontSize: 13 }}>
          {error}
          <button onClick={() => setError("")} aria-label="Chiudi avviso errore" style={{ marginLeft: 12, background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* TOTP Card */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: `1px solid ${totpConfigured ? "#10b98140" : "#f59e0b40"}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: totpConfigured ? "#10b981" : "#ef4444", display: "inline-block" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Google Authenticator</span>
            <span style={{ fontSize: 12, color: totpConfigured ? "#10b981" : "#f59e0b" }}>
              {totpConfigured ? "Configurato" : "Non configurato"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {totpConfigured ? (
              <button onClick={handleResetTotp} style={btn("#f59e0b")}>Reset TOTP</button>
            ) : (
              <button onClick={handleSetupTotp} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                Configura TOTP
              </button>
            )}
          </div>
        </div>
        {!totpConfigured && !showTotp && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "8px 0 0" }}>
            Devi configurare Google Authenticator per poter attivare i kiosk. Clicca &quot;Configura TOTP&quot; e scansiona il QR code con l&apos;app sul telefono.
          </p>
        )}
      </div>

      {/* TOTP Setup Modal */}
      {showTotp && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #8b5cf640", borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Configura Authenticator</h3>
          {totpLoading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}>Generazione QR code...</div>
          ) : totpData ? (
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 12px" }}>Scansiona con Google Authenticator:</p>
                <img src={totpData.qrDataUrl} alt="QR Code TOTP" style={{ width: 220, height: 220, borderRadius: 8, background: "#fff", padding: 10 }} />
              </div>
              <div style={{ flex: 1, minWidth: 250 }}>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px" }}>Oppure inserisci manualmente:</p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <code style={{ background: "#0a0914", padding: "10px 14px", borderRadius: 6, border: "1px solid #1e3a5f", color: "#f0b429", fontSize: 14, fontWeight: 700, letterSpacing: 2, wordBreak: "break-all" as const }}>
                    {totpData.secret}
                  </code>
                  <button onClick={() => copyToClipboard(totpData.secret)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}>
                    Copia
                  </button>
                </div>
                <div style={{ background: "#f59e0b15", border: "1px solid #f59e0b30", borderRadius: 8, padding: 12 }}>
                  <p style={{ fontSize: 12, color: "#f59e0b", margin: 0, fontWeight: 600 }}>Importante</p>
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>Salva questo codice. Se perdi il telefono, contatta l&apos;admin per il reset.</p>
                </div>
              </div>
            </div>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <button onClick={() => { setShowTotp(false); setTotpData(null); }} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Nuovo Kiosk</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ flex: 1, maxWidth: 300 }}>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Nome</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="es. Sala Roma 1" onKeyDown={(e) => e.key === "Enter" && handleCreate()} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} />
            </div>
            <button onClick={handleCreate} disabled={creating} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: creating ? 0.5 : 1 }}>
              {creating ? "Creazione..." : "Crea"}
            </button>
            <button onClick={() => setShowCreate(false)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Annulla</button>
          </div>
        </div>
      )}

      {/* Credit Modal */}
      {creditModal && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            {creditModal.action === "load" ? "Carica" : "Scarica"} Credito — {creditModal.kioskName}
          </h3>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ maxWidth: 200 }}>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Importo (EUR)</label>
              <input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} min="0.01" step="0.01" placeholder="0.00" onKeyDown={(e) => e.key === "Enter" && handleCredit()} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} />
            </div>
            <button onClick={handleCredit} disabled={creditLoading} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: creditModal.action === "load" ? "#10b981" : "#f59e0b", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: creditLoading ? 0.5 : 1 }}>
              {creditLoading ? "..." : creditModal.action === "load" ? "Carica" : "Scarica"}
            </button>
            <button onClick={() => { setCreditModal(null); setCreditAmount(""); }} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Annulla</button>
          </div>
        </div>
      )}

      {/* Link Modal */}
      {linkModal && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #10b98140", borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Link Kiosk — {linkModal.name}</h3>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 12px" }}>Apri questo URL nel browser del terminale:</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ background: "#0a0914", padding: "10px 16px", borderRadius: 6, border: "1px solid #1e3a5f", color: "#10b981", fontSize: 14, fontWeight: 600, flex: 1, wordBreak: "break-all" as const }}>{kioskUrl(linkModal.code)}</code>
            <button onClick={() => copyToClipboard(kioskUrl(linkModal.code))} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" as const }}>Copia</button>
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setLinkModal(null)} style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>Chiudi</button>
          </div>
        </div>
      )}

      {/* Kiosk Table */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
              {["Codice", "Nome", "Saldo", "Sessione", "Heartbeat", "Azioni"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {kiosks.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Nessun kiosk. Clicca &quot;+ Nuovo Kiosk&quot; per crearne uno.</td></tr>
            ) : (
              kiosks.map((k) => (
                <tr key={k.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "#f0b429" }}>{k.code}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{k.name}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: k.balance > 0 ? "#10b981" : "#94a3b8" }}>
                    {"\u20AC"}{Number(k.balance).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.has_active_session ? "#10b981" : "#64748b" }} />
                      <span style={{ fontSize: 12, color: k.has_active_session ? "#10b981" : "#64748b" }}>{k.has_active_session ? "Attiva" : "—"}</span>
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>{formatHeartbeat(k.last_heartbeat)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button onClick={() => setLinkModal({ code: k.code, name: k.name })} style={btn("#3b82f6")}>Link</button>
                      <button onClick={() => setCreditModal({ kioskId: k.id, kioskName: k.name, action: "load" })} style={btn("#10b981")}>+ Carica</button>
                      <button onClick={() => setCreditModal({ kioskId: k.id, kioskName: k.name, action: "unload" })} style={btn("#f59e0b")}>- Scarica</button>
                      {k.has_active_session && <button onClick={() => handleKillSession(k.id)} style={btn("#ef4444")}>Kill</button>}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
