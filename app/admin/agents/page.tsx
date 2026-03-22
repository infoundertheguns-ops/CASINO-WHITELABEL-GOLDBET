"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LEVEL_LABELS, type Agent, type AgentLevel } from "@/lib/types/agent";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: "#10b98120", text: "#10b981" },
  suspended: { bg: "#f59e0b20", text: "#f59e0b" },
  closed: { bg: "#ef444420", text: "#ef4444" },
};

const LEVEL_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "#8b5cf620", text: "#a78bfa" },
  2: { bg: "#3b82f620", text: "#60a5fa" },
  3: { bg: "#06b6d420", text: "#22d3ee" },
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "", code: "", level: 1, parent_id: "", wallet_model: "postpaid",
    commission_rate: 0, email: "", password: "", username: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents");
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setShowForm(false);
      setFormData({ name: "", code: "", level: 1, parent_id: "", wallet_model: "postpaid", commission_rate: 0, email: "", password: "", username: "" });
      loadAgents();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
          Gestione Agenti
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: "10px 20px", borderRadius: 8, border: "none",
            background: "#8b5cf6", color: "#fff", cursor: "pointer",
            fontSize: 13, fontWeight: 700,
          }}
        >
          + Nuovo Agente
        </button>
      </div>

      {error && <div style={{ padding: 12, borderRadius: 8, background: "#ef444420", color: "#ef4444", fontSize: 13 }}>{error}</div>}

      {/* Create Form */}
      {showForm && (
        <div style={{
          background: "var(--admin-card, #0f172a)",
          border: "1px solid var(--admin-border, #1e3a5f)",
          borderRadius: 12, padding: 20,
        }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Nuovo Agente</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Nome</label>
              <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Codice</label>
              <input value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} placeholder="AG001" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Livello</label>
              <select value={formData.level} onChange={e => setFormData({ ...formData, level: parseInt(e.target.value) })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}>
                <option value={1}>Master Agent</option>
                <option value={2}>Agent</option>
                <option value={3}>Sub-Agent</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Parent</label>
              <select value={formData.parent_id} onChange={e => setFormData({ ...formData, parent_id: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}>
                <option value="">Nessuno (diretto)</option>
                {agents.filter(a => a.level < formData.level).map(a => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Wallet</label>
              <select value={formData.wallet_model} onChange={e => setFormData({ ...formData, wallet_model: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }}>
                <option value="postpaid">Post-pagato</option>
                <option value="prepaid">Prepagato</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Commissione %</label>
              <input type="number" value={formData.commission_rate} onChange={e => setFormData({ ...formData, commission_rate: parseFloat(e.target.value) || 0 })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Username *</label>
              <input value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} placeholder="agent01" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Email (facoltativa)</label>
              <input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} placeholder="opzionale" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Password *</label>
              <input type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "#0a0914", color: "#e2e8f0", fontSize: 13 }} />
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button onClick={handleCreate} disabled={saving}
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: saving ? 0.5 : 1 }}>
              {saving ? "Creazione..." : "Crea Agente"}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}>
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Agent Table */}
      <div style={{
        background: "var(--admin-card, #0f172a)",
        border: "1px solid var(--admin-border, #1e3a5f)",
        borderRadius: 12, overflow: "hidden",
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
              {["Codice", "Nome", "Livello", "Parent", "Wallet", "Comm. %", "Giocatori", "Sub-Agent", "Status", ""].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Nessun agente</td></tr>
            ) : agents.map(a => {
              const lc = LEVEL_COLORS[a.level] || LEVEL_COLORS[1];
              const sc = STATUS_COLORS[a.status] || STATUS_COLORS.active;
              return (
                <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 700, color: "#f0b429" }}>{a.code}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{a.name}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: lc.bg, color: lc.text }}>
                      {LEVEL_LABELS[a.level as AgentLevel]}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12 }}>{a.parent_name || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: a.wallet_model === "prepaid" ? "#f59e0b" : "#94a3b8" }}>
                      {a.wallet_model === "prepaid" ? `PRE (€${a.wallet_balance ?? 0})` : "POST"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--admin-text, #e2e8f0)" }}>{a.commission_rate}%</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#60a5fa" }}>{a.player_count}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#a78bfa" }}>{a.sub_agent_count}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.text }}>
                      {a.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => router.push(`/admin/agents/${a.id}`)}
                      style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #1e3a5f", background: "transparent", color: "#60a5fa", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                      Dettagli →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
