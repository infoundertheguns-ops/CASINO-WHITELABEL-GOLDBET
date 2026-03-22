"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { LEVEL_LABELS, PERMISSION_LABELS, PERMISSION_KEYS, DEFAULT_PERMISSIONS, type AgentLevel, type AgentPermissions, type PermissionKey, type PermissionLevel } from "@/lib/types/agent";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("info");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [walletAmount, setWalletAmount] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/agents/${id}`);
      const json = await res.json();
      setData(json);
    } catch { }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async (updates: Record<string, any>) => {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error); return; }
      setMsg("Salvato!");
      loadData();
      setTimeout(() => setMsg(""), 3000);
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  const handleWalletOp = async (action: "load" | "unload") => {
    const amount = parseFloat(walletAmount);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/agents/${id}/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount }),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error); return; }
      setMsg(`Wallet ${action === "load" ? "caricato" : "scaricato"}: €${amount}`);
      setWalletAmount("");
      loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>;
  if (!data?.agent) return <div style={{ padding: 60, textAlign: "center", color: "#ef4444" }}>Agente non trovato</div>;

  const agent = data.agent;
  const permissions: AgentPermissions = agent.permissions || DEFAULT_PERMISSIONS;

  const TABS = [
    { key: "info", label: "Info" },
    { key: "permissions", label: "Permessi" },
    { key: "wallet", label: "Wallet" },
    { key: "players", label: `Giocatori (${data.player_count})` },
    { key: "transactions", label: "Transazioni" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => router.push("/admin/agents")}
          style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}>
          ← Indietro
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            {agent.name} <span style={{ color: "#f0b429", fontFamily: "monospace" }}>[{agent.code}]</span>
          </h2>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {LEVEL_LABELS[agent.level as AgentLevel]} · {agent.wallet_model} · {agent.commission_rate}% commissione
          </div>
        </div>
      </div>

      {msg && <div style={{ padding: 10, borderRadius: 8, background: msg.includes("Errore") || msg.includes("error") ? "#ef444420" : "#10b98120", color: msg.includes("Errore") || msg.includes("error") ? "#ef4444" : "#10b981", fontSize: 13 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: activeTab === tab.key ? "1px solid #f0b429" : "1px solid #1e3a5f",
              background: activeTab === tab.key ? "#f0b42920" : "transparent",
              color: activeTab === tab.key ? "#f0b429" : "#94a3b8",
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Info Tab */}
      {activeTab === "info" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          {/* Editable fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, fontSize: 13, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Nome</label>
              <input
                defaultValue={agent.name}
                onBlur={e => { if (e.target.value !== agent.name) handleSave({ name: e.target.value }); }}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Commissione %</label>
              <input
                type="number"
                defaultValue={agent.commission_rate}
                onBlur={e => { const v = parseFloat(e.target.value); if (v !== agent.commission_rate) handleSave({ commission_rate: v }); }}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Wallet Model</label>
              <select
                defaultValue={agent.wallet_model}
                onChange={e => handleSave({ wallet_model: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}
              >
                <option value="postpaid">Post-pagato</option>
                <option value="prepaid">Prepagato</option>
              </select>
            </div>
          </div>

          {/* Read-only info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, fontSize: 13, padding: "12px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div><span style={{ color: "#64748b" }}>Status: </span><span style={{ color: agent.status === "active" ? "#10b981" : "#f59e0b", fontWeight: 700 }}>{agent.status.toUpperCase()}</span></div>
            <div><span style={{ color: "#64748b" }}>Livello: </span><span style={{ color: "#e2e8f0" }}>{LEVEL_LABELS[agent.level as AgentLevel]}</span></div>
            <div><span style={{ color: "#64748b" }}>Giocatori: </span><span style={{ color: "#60a5fa", fontWeight: 700 }}>{data.player_count}</span></div>
            <div><span style={{ color: "#64748b" }}>Sub-Agenti: </span><span style={{ color: "#a78bfa", fontWeight: 700 }}>{data.sub_agents?.length || 0}</span></div>
          </div>

          {/* Actions */}
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            {agent.status === "active" ? (
              <button onClick={() => handleSave({ status: "suspended" })} disabled={saving}
                style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#f59e0b", color: "#000", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                Sospendi
              </button>
            ) : (
              <button onClick={() => handleSave({ status: "active" })} disabled={saving}
                style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                Riattiva
              </button>
            )}
          </div>
        </div>
      )}

      {/* Permissions Tab */}
      {activeTab === "permissions" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e3a5f" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748b", fontSize: 11, fontWeight: 700 }}>FUNZIONE</th>
                {(["none", "viewer", "editor"] as const).map(l => (
                  <th key={l} style={{ padding: "8px 12px", textAlign: "center", color: "#64748b", fontSize: 11, fontWeight: 700 }}>{l.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_KEYS.map(key => (
                <tr key={key} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 12px", color: "#e2e8f0", fontWeight: 500 }}>{PERMISSION_LABELS[key]}</td>
                  {(["none", "viewer", "editor"] as const).map(level => (
                    <td key={level} style={{ padding: "8px 12px", textAlign: "center" }}>
                      <input
                        type="radio"
                        name={`perm-${key}`}
                        checked={permissions[key] === level}
                        onChange={() => {
                          const newPerms = { ...permissions, [key]: level };
                          handleSave({ permissions: newPerms });
                        }}
                        style={{ cursor: "pointer", accentColor: "#f0b429" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Wallet Tab */}
      {activeTab === "wallet" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20 }}>
          {agent.wallet_model === "prepaid" ? (
            <>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>Saldo Wallet Agente</div>
              <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "monospace", color: "#10b981", marginBottom: 16 }}>
                €{data.wallet?.balance?.toFixed(2) || "0.00"}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" value={walletAmount} onChange={e => setWalletAmount(e.target.value)} placeholder="Importo"
                  style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13, width: 150 }} />
                <button onClick={() => handleWalletOp("load")} disabled={saving}
                  style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  Carica
                </button>
                <button onClick={() => handleWalletOp("unload")} disabled={saving}
                  style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  Scarica
                </button>
              </div>
            </>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 14 }}>
              Questo agente usa il modello <strong>post-pagato</strong>. Il saldo viene calcolato periodicamente nel settlement.
            </div>
          )}
        </div>
      )}

      {/* Players Tab */}
      {activeTab === "players" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid #1e3a5f" }}>
                {["Username", "Email", "Tipo", "Saldo", "Attivo", "Ultimo Login"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data._players ? (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                  <button onClick={async () => {
                    const res = await fetch(`/api/admin/agents/${id}/players`);
                    const d = await res.json();
                    setData((prev: any) => ({ ...prev, _players: d.players || [] }));
                  }} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: "#60a5fa", cursor: "pointer", fontSize: 12 }}>
                    Carica giocatori
                  </button>
                </td></tr>
              ) : data._players.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Nessun giocatore</td></tr>
              ) : data._players.map((p: any) => (
                <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: "#e2e8f0" }}>{p.username}</td>
                  <td style={{ padding: "8px 12px", color: "#94a3b8", fontSize: 12 }}>{p.email}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: p.player_type === "kiosk" ? "#f59e0b20" : "#3b82f620", color: p.player_type === "kiosk" ? "#f59e0b" : "#60a5fa" }}>
                      {(p.player_type || "online").toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#10b981", fontWeight: 600 }}>€{(p.balance || 0).toFixed(2)}</td>
                  <td style={{ padding: "8px 12px", color: p.is_active ? "#10b981" : "#ef4444" }}>{p.is_active ? "Si" : "No"}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#94a3b8", fontSize: 11 }}>
                    {p.last_login ? new Date(p.last_login).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transactions Tab */}
      {activeTab === "transactions" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid #1e3a5f" }}>
                {["Data", "Tipo", "Importo", "Saldo Dopo", "Note"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.transactions || []).length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Nessuna transazione</td></tr>
              ) : (data.transactions || []).map((t: any) => (
                <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#94a3b8" }}>
                    {new Date(t.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "6px 12px", color: "#e2e8f0", fontWeight: 500 }}>{t.type}</td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", fontWeight: 700, color: t.amount >= 0 ? "#10b981" : "#ef4444" }}>
                    {t.amount >= 0 ? "+" : ""}{t.amount.toFixed(2)}
                  </td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#94a3b8" }}>{t.balance_after?.toFixed(2) ?? "—"}</td>
                  <td style={{ padding: "6px 12px", color: "#64748b", fontSize: 11 }}>{t.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
