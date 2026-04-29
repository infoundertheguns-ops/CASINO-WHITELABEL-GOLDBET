"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  DEFAULT_PERMISSIONS,
  type AgentPermissions,
  type PermissionKey,
  type PermissionLevel,
} from "@/lib/types/agent";

const LEVEL_BADGE: Record<number, { label: string; bg: string; color: string }> = {
  2: { label: "Agent", bg: "#3b82f620", color: "#60a5fa" },
  3: { label: "Sub-Agent", bg: "#8b5cf620", color: "#a78bfa" },
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

export default function AgentNetworkPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<any[]>([]);
  const [master, setMaster] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState("");
  const [processing, setProcessing] = useState(false);

  // Create form state
  const [form, setForm] = useState({
    name: "",
    code: "",
    username: "",
    password: "",
    level: 2 as 2 | 3,
    parent_id: "",
    wallet_model: "postpaid" as "prepaid" | "postpaid",
    commission_rate: 0,
    settlement_period: "monthly" as "weekly" | "monthly",
  });
  const [permissions, setPermissions] = useState<AgentPermissions>({ ...DEFAULT_PERMISSIONS });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/network");
      const data = await res.json();
      setAgents(data.agents || []);
      setMaster(data.master || null);
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const level2Agents = agents.filter((a) => a.level === 2);
  const level3ByParent = agents.reduce((acc: Record<string, any[]>, a) => {
    if (a.level === 3 && a.parent_id) {
      if (!acc[a.parent_id]) acc[a.parent_id] = [];
      acc[a.parent_id].push(a);
    }
    return acc;
  }, {});

  const handleCreate = async () => {
    if (!form.name || !form.code || !form.username || !form.password) {
      setMsg("Compila tutti i campi obbligatori.");
      return;
    }
    setProcessing(true);
    setMsg("");
    try {
      const res = await fetch("/api/agent/network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          parent_id: form.level === 3 ? form.parent_id : undefined,
          permissions,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Errore"); return; }
      setMsg(`Agente ${form.username} creato con successo!`);
      setForm({
        name: "", code: "", username: "", password: "",
        level: 2, parent_id: "", wallet_model: "postpaid",
        commission_rate: 0, settlement_period: "monthly",
      });
      setPermissions({ ...DEFAULT_PERMISSIONS });
      setShowCreate(false);
      loadData();
    } catch (e: any) { setMsg(e.message); }
    finally { setProcessing(false); }
  };

  const setPermKey = (key: PermissionKey, level: PermissionLevel) => {
    setPermissions(prev => ({ ...prev, [key]: level }));
  };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento rete agenti...</div>;

  const inputStyle = {
    width: "100%", padding: "8px 12px", borderRadius: 6,
    border: "1px solid #1e3a5f", background: "#0a0914",
    color: "#e2e8f0", fontSize: 13,
  };

  const labelStyle = { fontSize: 11, color: "#94a3b8", display: "block" as const, marginBottom: 4 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Rete Agenti</h2>
        <button
          onClick={() => { setShowCreate(!showCreate); setMsg(""); }}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
        >
          + Crea Agente
        </button>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 8, fontSize: 13,
          background: msg.includes("successo") ? "#10b98120" : "#ef444420",
          color: msg.includes("successo") ? "#10b981" : "#ef4444",
        }}>{msg}</div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, padding: 24 }}>
          <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>Nuovo Agente</h3>

          {/* Basic fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Nome *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Codice *</label>
              <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Username *</label>
              <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Password *</label>
              <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Livello</label>
              <select value={form.level} onChange={e => setForm({ ...form, level: parseInt(e.target.value) as 2 | 3, parent_id: "" })} style={inputStyle}>
                <option value={2}>2 — Agent</option>
                <option value={3}>3 — Sub-Agent</option>
              </select>
            </div>
            {form.level === 3 && (
              <div>
                <label style={labelStyle}>Agente Padre (livello 2) *</label>
                <select value={form.parent_id} onChange={e => setForm({ ...form, parent_id: e.target.value })} style={inputStyle}>
                  <option value="">— Seleziona —</option>
                  {level2Agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name} [{a.code}]</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Wallet Model</label>
              <select value={form.wallet_model} onChange={e => setForm({ ...form, wallet_model: e.target.value as "prepaid" | "postpaid" })} style={inputStyle}>
                <option value="postpaid">Post-pagato</option>
                <option value="prepaid">Prepagato</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Commissione %</label>
              <input type="number" min={0} max={100} step={0.1} value={form.commission_rate}
                onChange={e => setForm({ ...form, commission_rate: parseFloat(e.target.value) || 0 })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Periodo Settlement</label>
              <select value={form.settlement_period} onChange={e => setForm({ ...form, settlement_period: e.target.value as "weekly" | "monthly" })} style={inputStyle}>
                <option value="monthly">Mensile</option>
                <option value="weekly">Settimanale</option>
              </select>
            </div>
          </div>

          {/* Permissions */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 12, textTransform: "uppercase" as const }}>Permessi</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {PERMISSION_KEYS.map(key => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500 }}>{PERMISSION_LABELS[key]}</span>
                  <div style={{ display: "flex", gap: 12 }}>
                    {(["none", "viewer", "editor"] as const).map(lvl => (
                      <label key={lvl} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11, color: permissions[key] === lvl ? "#f0b429" : "#64748b" }}>
                        <input
                          type="radio"
                          name={`create-perm-${key}`}
                          checked={permissions[key] === lvl}
                          onChange={() => setPermKey(key, lvl)}
                          style={{ cursor: "pointer", accentColor: "#f0b429" }}
                        />
                        {lvl === "none" ? "No" : lvl === "viewer" ? "View" : "Edit"}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCreate} disabled={processing}
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: processing ? 0.7 : 1 }}>
              {processing ? "Creazione..." : "Crea Agente"}
            </button>
            <button onClick={() => { setShowCreate(false); setMsg(""); }}
              style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", fontSize: 13, cursor: "pointer" }}>
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Network Tree */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
        {/* Master node */}
        {master && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e3a5f", background: "rgba(240,180,41,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#f0b42920", color: "#f0b429" }}>MASTER</span>
              <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14 }}>{master.name}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#f0b429" }}>[{master.code}]</span>
            </div>
          </div>
        )}

        {/* Level 2 agents */}
        {level2Agents.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#64748b", fontSize: 13 }}>
            Nessun agente nella rete. Crea il primo!
          </div>
        ) : level2Agents.map(agent => {
          const children = level3ByParent[agent.id] || [];
          const isExpanded = expanded.has(agent.id);
          const wb = WALLET_BADGE[agent.wallet_model] || WALLET_BADGE.postpaid;
          const lvlBadge = LEVEL_BADGE[2];

          return (
            <div key={agent.id}>
              {/* Level 2 row */}
              <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 12 }}>
                {/* Expand toggle */}
                <button
                  onClick={() => toggleExpand(agent.id)}
                  style={{ width: 24, height: 24, borderRadius: 4, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  {children.length > 0 ? (isExpanded ? "▼" : "▶") : "·"}
                </button>

                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: lvlBadge.bg, color: lvlBadge.color }}>{lvlBadge.label}</span>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>[{agent.code}]</span>

                <button
                  onClick={() => router.push(`/admin/agent-network/${agent.id}`)}
                  style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 14, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textDecorationColor: "transparent" }}
                  onMouseEnter={e => (e.currentTarget.style.textDecorationColor = "#60a5fa")}
                  onMouseLeave={e => (e.currentTarget.style.textDecorationColor = "transparent")}
                >
                  {agent.name}
                </button>

                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: wb.bg, color: wb.color }}>{wb.label}</span>

                {agent.wallet_model === "prepaid" && (
                  <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#10b981", fontSize: 13 }}>
                    €{(agent.wallet_balance ?? 0).toFixed(2)}
                  </span>
                )}

                <span style={{ fontSize: 12, color: "#64748b" }}>
                  {agent.player_count} giocatori
                </span>

                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: `${STATUS_COLORS[agent.status]}20`, color: STATUS_COLORS[agent.status] }}>
                  {agent.status.toUpperCase()}
                </span>

                {children.length > 0 && (
                  <span style={{ fontSize: 11, color: "#64748b" }}>{children.length} sub-agenti</span>
                )}
              </div>

              {/* Level 3 children */}
              {isExpanded && children.map(child => {
                const cwb = WALLET_BADGE[child.wallet_model] || WALLET_BADGE.postpaid;
                const clvl = LEVEL_BADGE[3];
                return (
                  <div key={child.id} style={{ padding: "10px 16px 10px 56px", borderBottom: "1px solid rgba(255,255,255,0.03)", display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.01)" }}>
                    <span style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 14, flexShrink: 0 }}>└</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: clvl.bg, color: clvl.color }}>{clvl.label}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>[{child.code}]</span>
                    <button
                      onClick={() => router.push(`/admin/agent-network/${child.id}`)}
                      style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 13, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline", textDecorationColor: "transparent" }}
                      onMouseEnter={e => (e.currentTarget.style.textDecorationColor = "#a78bfa")}
                      onMouseLeave={e => (e.currentTarget.style.textDecorationColor = "transparent")}
                    >
                      {child.name}
                    </button>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: cwb.bg, color: cwb.color }}>{cwb.label}</span>
                    {child.wallet_model === "prepaid" && (
                      <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#10b981", fontSize: 12 }}>
                        €{(child.wallet_balance ?? 0).toFixed(2)}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: "#64748b" }}>{child.player_count} giocatori</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: `${STATUS_COLORS[child.status]}20`, color: STATUS_COLORS[child.status] }}>
                      {child.status.toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
