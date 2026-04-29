"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  DEFAULT_PERMISSIONS,
  type AgentPermissions,
  type PermissionKey,
  type AgentLevel,
} from "@/lib/types/agent";

const LEVEL_BADGE: Record<number, { label: string; color: string }> = {
  1: { label: "Master Agent", color: "#f0b429" },
  2: { label: "Agent", color: "#60a5fa" },
  3: { label: "Sub-Agent", color: "#a78bfa" },
};

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  suspended: "#f59e0b",
  closed: "#ef4444",
};

const WALLET_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  prepaid: { label: "PRE", bg: "#3b82f620", color: "#60a5fa" },
  postpaid: { label: "POST", bg: "#8b5cf620", color: "#a78bfa" },
};

const TABS = [
  { key: "info", label: "Info" },
  { key: "permissions", label: "Permessi" },
  { key: "wallet", label: "Wallet" },
  { key: "players", label: "Giocatori" },
  { key: "transactions", label: "Transazioni" },
];

export default function AgentNetworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("info");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Info tab local state
  const [editName, setEditName] = useState("");
  const [editCommission, setEditCommission] = useState(0);
  const [editWalletModel, setEditWalletModel] = useState("");
  const [editSettlementPeriod, setEditSettlementPeriod] = useState("");
  const [editStatus, setEditStatus] = useState("");

  // Permissions tab local state
  const [editPerms, setEditPerms] = useState<AgentPermissions>({ ...DEFAULT_PERMISSIONS });

  // Wallet tab
  const [walletAmount, setWalletAmount] = useState("");

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/network/${id}`);
      const json = await res.json();
      setData(json);
      if (json.agent) {
        setEditName(json.agent.name || "");
        setEditCommission(json.agent.commission_rate ?? 0);
        setEditWalletModel(json.agent.wallet_model || "postpaid");
        setEditSettlementPeriod(json.agent.settlement_period || "monthly");
        setEditStatus(json.agent.status || "active");
        setEditPerms(json.agent.permissions || { ...DEFAULT_PERMISSIONS });
      }
    } catch { }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async (updates: Record<string, any>) => {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/agent/network/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Errore"); return; }
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
    setMsg("");
    try {
      const res = await fetch(`/api/agent/network/${id}/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount }),
      });
      if (!res.ok) { const d = await res.json(); setMsg(d.error || "Errore"); return; }
      setMsg(`Wallet ${action === "load" ? "caricato" : "scaricato"}: €${amount}`);
      setWalletAmount("");
      loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>;
  if (!data?.agent) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <div style={{ color: "#ef4444", marginBottom: 16 }}>Agente non trovato nella tua rete</div>
      <button onClick={() => router.push("/admin/agent-network")}
        style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>
        ← Torna alla Rete
      </button>
    </div>
  );

  const agent = data.agent;
  const lvlBadge = LEVEL_BADGE[agent.level as AgentLevel] || LEVEL_BADGE[2];
  const wb = WALLET_BADGE[agent.wallet_model] || WALLET_BADGE.postpaid;

  const inputStyle = {
    width: "100%", padding: "8px 12px", borderRadius: 6,
    border: "1px solid #1e3a5f", background: "#0a0914",
    color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" as const,
  };

  const isError = (m: string) => m.toLowerCase().includes("errore") || m.toLowerCase().includes("error") || m.toLowerCase().includes("non");
  const msgIsError = msg && isError(msg);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => router.push("/admin/agent-network")}
          style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}>
          ← Indietro
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
            {agent.name}{" "}
            <span style={{ fontFamily: "monospace", color: "#f0b429" }}>[{agent.code}]</span>
          </h2>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: lvlBadge.color, fontWeight: 600 }}>{lvlBadge.label}</span>
            <span>·</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: wb.bg, color: wb.color }}>{wb.label}</span>
            <span>·</span>
            <span>{agent.commission_rate}% commissione</span>
            <span>·</span>
            <span style={{ color: STATUS_COLORS[agent.status], fontWeight: 600 }}>{agent.status.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, fontSize: 13,
          background: msgIsError ? "#ef444420" : "#10b98120",
          color: msgIsError ? "#ef4444" : "#10b981",
        }}>{msg}</div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          let label = tab.label;
          if (tab.key === "players") label = `Giocatori (${data.player_count ?? 0})`;
          if (tab.key === "transactions") label = `Transazioni (${(data.transactions || []).length})`;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                border: isActive ? "1px solid #f0b429" : "1px solid #1e3a5f",
                background: isActive ? "#f0b42920" : "transparent",
                color: isActive ? "#f0b429" : "#94a3b8",
              }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Info Tab */}
      {activeTab === "info" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Nome</label>
              <input value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Commissione %</label>
              <input type="number" min={0} max={100} step={0.1}
                value={editCommission} onChange={e => setEditCommission(parseFloat(e.target.value) || 0)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Wallet Model</label>
              <select value={editWalletModel} onChange={e => setEditWalletModel(e.target.value)} style={inputStyle}>
                <option value="postpaid">Post-pagato</option>
                <option value="prepaid">Prepagato</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Periodo Settlement</label>
              <select value={editSettlementPeriod} onChange={e => setEditSettlementPeriod(e.target.value)} style={inputStyle}>
                <option value="monthly">Mensile</option>
                <option value="weekly">Settimanale</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Status</label>
              <select value={editStatus} onChange={e => setEditStatus(e.target.value)} style={inputStyle}>
                <option value="active">Attivo</option>
                <option value="suspended">Sospeso</option>
                <option value="closed">Chiuso</option>
              </select>
            </div>
          </div>

          {/* Read-only info row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, padding: "12px 0", borderTop: "1px solid rgba(255,255,255,0.06)", marginBottom: 16, fontSize: 13 }}>
            <div><span style={{ color: "#64748b" }}>Livello: </span><span style={{ color: lvlBadge.color, fontWeight: 700 }}>{lvlBadge.label}</span></div>
            <div><span style={{ color: "#64748b" }}>Codice: </span><span style={{ fontFamily: "monospace", color: "#f0b429" }}>{agent.code}</span></div>
            <div><span style={{ color: "#64748b" }}>Giocatori: </span><span style={{ color: "#60a5fa", fontWeight: 700 }}>{data.player_count}</span></div>
            <div><span style={{ color: "#64748b" }}>Sub-Agenti: </span><span style={{ color: "#a78bfa", fontWeight: 700 }}>{(data.sub_agents || []).length}</span></div>
          </div>

          <button onClick={() => handleSave({ name: editName, commission_rate: editCommission, wallet_model: editWalletModel, settlement_period: editSettlementPeriod, status: editStatus })}
            disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Salvataggio..." : "Salva Modifiche"}
          </button>
        </div>
      )}

      {/* Permissions Tab */}
      {activeTab === "permissions" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 24 }}>
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
                  <td style={{ padding: "10px 12px", color: "#e2e8f0", fontWeight: 500 }}>{PERMISSION_LABELS[key]}</td>
                  {(["none", "viewer", "editor"] as const).map(level => (
                    <td key={level} style={{ padding: "10px 12px", textAlign: "center" }}>
                      <input
                        type="radio"
                        name={`perm-${key}`}
                        checked={editPerms[key] === level}
                        onChange={() => setEditPerms(prev => ({ ...prev, [key]: level }))}
                        style={{ cursor: "pointer", accentColor: "#f0b429" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 20 }}>
            <button onClick={() => handleSave({ permissions: editPerms })} disabled={saving}
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Salvataggio..." : "Salva Permessi"}
            </button>
          </div>
        </div>
      )}

      {/* Wallet Tab */}
      {activeTab === "wallet" && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 24 }}>
          {agent.wallet_model === "prepaid" ? (
            <>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>Saldo Wallet Agente</div>
              <div style={{ fontSize: 36, fontWeight: 800, fontFamily: "monospace", color: "#10b981", marginBottom: 20 }}>
                €{(data.wallet?.balance ?? 0).toFixed(2)}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  value={walletAmount}
                  onChange={e => setWalletAmount(e.target.value)}
                  placeholder="Importo"
                  style={{ padding: "10px 14px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 14, width: 160, fontFamily: "monospace" }}
                />
                <button onClick={() => handleWalletOp("load")} disabled={saving}
                  style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  + Carica
                </button>
                <button onClick={() => handleWalletOp("unload")} disabled={saving}
                  style={{ padding: "10px 20px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  − Scarica
                </button>
              </div>
            </>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 14 }}>
              Modello postpaid — nessun wallet. Il saldo viene calcolato periodicamente nel settlement.
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
                {["Username", "Tipo", "Saldo", "Status"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!data.players || data.players.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 30, textAlign: "center", color: "#64748b" }}>
                    Nessun giocatore associato a questo agente
                  </td>
                </tr>
              ) : data.players.map((p: any) => (
                <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "#e2e8f0" }}>{p.username}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: p.player_type === "kiosk" ? "#f59e0b20" : "#3b82f620", color: p.player_type === "kiosk" ? "#f59e0b" : "#60a5fa" }}>
                      {(p.player_type || "online").toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "#10b981" }}>
                    €{(p.balance ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: p.is_active ? "#10b98120" : "#ef444420", color: p.is_active ? "#10b981" : "#ef4444" }}>
                      {p.is_active ? "ATTIVO" : "INATTIVO"}
                    </span>
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
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.transactions || []).length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Nessuna transazione</td></tr>
              ) : (data.transactions || []).map((t: any) => (
                <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#94a3b8", fontSize: 11 }}>
                    {new Date(t.created_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
                      {t.type}
                    </span>
                  </td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", fontWeight: 700, color: t.amount >= 0 ? "#10b981" : "#ef4444" }}>
                    {t.amount >= 0 ? "+" : ""}{(t.amount ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#94a3b8" }}>
                    {t.balance_after != null ? t.balance_after.toFixed(2) : "—"}
                  </td>
                  <td style={{ padding: "6px 12px", color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.notes || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
