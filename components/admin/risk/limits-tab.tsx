"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

const SPORTS_LIST = [
  "calcio", "tennis", "basket", "hockey", "football_americano",
  "baseball", "rugby", "cricket", "freccette", "snooker",
  "boxe", "volley", "pallamano", "ciclismo", "golf",
  "tennis_tavolo", "mma", "esports", "motorsports",
];

interface BettingLimit {
  id: string;
  agent_id: string | null;
  player_id: string | null;
  sport: string | null;
  max_stake: number | null;
  max_win: number | null;
  max_daily_turnover: number | null;
  is_active: boolean;
  agents?: { display_name: string } | null;
  users?: { username: string } | null;
}

interface Agent {
  id: string;
  display_name: string;
}

export function LimitsTab() {
  const [limits, setLimits] = useState<BettingLimit[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    agent_id: "",
    player_search: "",
    player_id: "",
    sport: "",
    max_stake: "",
    max_win: "",
    max_daily_turnover: "",
  });

  const [playerSuggestions, setPlayerSuggestions] = useState<{ id: string; username: string }[]>([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);

  const loadLimits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/risk/limits");
      const data = await res.json();
      setLimits(data.limits || []);
    } catch {
      setError("Errore caricamento limiti");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agents?limit=100");
      const data = await res.json();
      setAgents(data.agents || []);
    } catch {}
  }, []);

  useEffect(() => {
    loadLimits();
    loadAgents();
  }, [loadLimits, loadAgents]);

  const searchPlayer = async (q: string) => {
    if (q.length < 2) { setPlayerSuggestions([]); return; }
    setPlayerSearchLoading(true);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      setPlayerSuggestions((data.users || []).map((u: any) => ({ id: u.id, username: u.username })));
    } catch {} finally {
      setPlayerSearchLoading(false);
    }
  };

  const resetForm = () => {
    setForm({ agent_id: "", player_search: "", player_id: "", sport: "", max_stake: "", max_win: "", max_daily_turnover: "" });
    setPlayerSuggestions([]);
    setEditId(null);
    setShowForm(false);
    setError(null);
  };

  const startEdit = (l: BettingLimit) => {
    setForm({
      agent_id: l.agent_id || "",
      player_search: l.users?.username || "",
      player_id: l.player_id || "",
      sport: l.sport || "",
      max_stake: l.max_stake != null ? String(l.max_stake) : "",
      max_win: l.max_win != null ? String(l.max_win) : "",
      max_daily_turnover: l.max_daily_turnover != null ? String(l.max_daily_turnover) : "",
    });
    setEditId(l.id);
    setShowForm(true);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        agent_id: form.agent_id || null,
        player_id: form.player_id || null,
        sport: form.sport || null,
        max_stake: form.max_stake ? parseFloat(form.max_stake) : null,
        max_win: form.max_win ? parseFloat(form.max_win) : null,
        max_daily_turnover: form.max_daily_turnover ? parseFloat(form.max_daily_turnover) : null,
      };

      const url = editId ? `/api/admin/risk/limits/${editId}` : "/api/admin/risk/limits";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Errore salvataggio");
        return;
      }
      resetForm();
      loadLimits();
    } catch {
      setError("Errore di rete");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    await fetch(`/api/admin/risk/limits/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !is_active }),
    });
    loadLimits();
  };

  const deleteLimit = async (id: string) => {
    if (!confirm("Eliminare questo limite?")) return;
    await fetch(`/api/admin/risk/limits/${id}`, { method: "DELETE" });
    loadLimits();
  };

  const getLevelLabel = (l: BettingLimit) => {
    if (l.player_id) return "giocatore";
    if (l.agent_id) return "agente";
    return "globale";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold" style={{ color: "var(--admin-text)" }}>
          Limiti di scommessa ({limits.length})
        </h2>
        <button
          onClick={() => { setShowForm(!showForm); setEditId(null); setError(null); }}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand/20 text-brand hover:bg-brand/30"
        >
          {showForm && !editId ? "Annulla" : "+ Crea Limite"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl p-4 space-y-3" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>
            {editId ? "Modifica limite" : "Nuovo limite"}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* Agent */}
            <div>
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Agente (opzionale)</label>
              <select
                value={form.agent_id}
                onChange={e => setForm(f => ({ ...f, agent_id: e.target.value }))}
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              >
                <option value="">Tutti gli agenti</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
              </select>
            </div>

            {/* Player search */}
            <div className="relative">
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Giocatore (opzionale)</label>
              <input
                type="text"
                value={form.player_search}
                onChange={e => {
                  setForm(f => ({ ...f, player_search: e.target.value, player_id: "" }));
                  searchPlayer(e.target.value);
                }}
                placeholder="Cerca username..."
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              />
              {playerSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden shadow-lg" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                  {playerSuggestions.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setForm(f => ({ ...f, player_search: p.username, player_id: p.id })); setPlayerSuggestions([]); }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10"
                      style={{ color: "var(--admin-text)" }}
                    >
                      {p.username}
                    </button>
                  ))}
                </div>
              )}
              {playerSearchLoading && <span className="text-[10px] text-gray-500 mt-0.5 block">Ricerca...</span>}
            </div>

            {/* Sport */}
            <div>
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Sport (opzionale)</label>
              <select
                value={form.sport}
                onChange={e => setForm(f => ({ ...f, sport: e.target.value }))}
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              >
                <option value="">Tutti gli sport</option>
                {SPORTS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Max stake */}
            <div>
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Max Stake (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.max_stake}
                onChange={e => setForm(f => ({ ...f, max_stake: e.target.value }))}
                placeholder="Nessun limite"
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              />
            </div>

            {/* Max win */}
            <div>
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Max Win (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.max_win}
                onChange={e => setForm(f => ({ ...f, max_win: e.target.value }))}
                placeholder="Nessun limite"
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              />
            </div>

            {/* Max daily turnover */}
            <div>
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Max Turnover Giornaliero (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.max_daily_turnover}
                onChange={e => setForm(f => ({ ...f, max_daily_turnover: e.target.value }))}
                placeholder="Nessun limite"
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-brand/20 text-brand hover:bg-brand/30 disabled:opacity-50"
            >
              {saving ? "Salvataggio..." : editId ? "Salva modifiche" : "Crea limite"}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white">
              Annulla
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
        {loading ? (
          <div className="text-center py-8 text-xs" style={{ color: "var(--admin-text4)" }}>Caricamento...</div>
        ) : limits.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: "var(--admin-text4)" }}>Nessun limite configurato</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                  <th className="text-left px-3 py-2 font-semibold">Livello</th>
                  <th className="text-left px-3 py-2 font-semibold">Agente</th>
                  <th className="text-left px-3 py-2 font-semibold">Giocatore</th>
                  <th className="text-left px-3 py-2 font-semibold">Sport</th>
                  <th className="text-right px-3 py-2 font-semibold">Max Stake</th>
                  <th className="text-right px-3 py-2 font-semibold">Max Win</th>
                  <th className="text-right px-3 py-2 font-semibold">Max Daily</th>
                  <th className="text-center px-3 py-2 font-semibold">Attivo</th>
                  <th className="text-center px-3 py-2 font-semibold">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {limits.map(l => (
                  <tr key={l.id} className="border-b border-gray-800/50 hover:bg-white/5">
                    <td className="px-3 py-2">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] font-bold",
                        !l.player_id && !l.agent_id ? "bg-purple-500/20 text-purple-400" :
                        l.player_id ? "bg-blue-500/20 text-blue-400" :
                        "bg-orange-500/20 text-orange-400"
                      )}>
                        {getLevelLabel(l).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--admin-text3)" }}>
                      {l.agents?.display_name || (l.agent_id ? l.agent_id.slice(0, 8) + "…" : "—")}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--admin-text3)" }}>
                      {l.users?.username || (l.player_id ? l.player_id.slice(0, 8) + "…" : "—")}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--admin-text3)" }}>
                      {l.sport || <span className="text-gray-600">tutti</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--admin-text)" }}>
                      {l.max_stake != null ? `€${l.max_stake}` : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--admin-text)" }}>
                      {l.max_win != null ? `€${l.max_win}` : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: "var(--admin-text)" }}>
                      {l.max_daily_turnover != null ? `€${l.max_daily_turnover}` : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleActive(l.id, l.is_active)}
                        className={cn(
                          "w-8 h-4 rounded-full transition-colors relative",
                          l.is_active ? "bg-emerald-500" : "bg-gray-600"
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                          l.is_active ? "left-4.5" : "left-0.5"
                        )} style={{ left: l.is_active ? "calc(100% - 14px)" : "2px" }} />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => startEdit(l)}
                          className="px-2 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteLimit(l.id)}
                          className="px-2 py-0.5 rounded text-[8px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
