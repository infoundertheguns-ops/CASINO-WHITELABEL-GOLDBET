"use client";

import { useState, useEffect, useCallback } from "react";

interface BlacklistEntry {
  id: string;
  player_id: string;
  reason: string | null;
  blocked_by: string | null;
  created_at: string;
  users?: { username: string; agent_id: string | null } | null;
  agents?: { display_name: string } | null;
}

export function BlacklistTab() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ player_search: "", player_id: "", reason: "" });
  const [playerSuggestions, setPlayerSuggestions] = useState<{ id: string; username: string }[]>([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);

  const loadBlacklist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/risk/blacklist");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setError("Errore caricamento blacklist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlacklist();
  }, [loadBlacklist]);

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
    setForm({ player_search: "", player_id: "", reason: "" });
    setPlayerSuggestions([]);
    setShowForm(false);
    setError(null);
  };

  const handleBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.player_id) { setError("Seleziona un giocatore dalla lista"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/risk/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: form.player_id, reason: form.reason || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Errore blocco giocatore");
        return;
      }
      resetForm();
      loadBlacklist();
    } catch {
      setError("Errore di rete");
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async (id: string) => {
    if (!confirm("Sbloccare questo giocatore?")) return;
    await fetch(`/api/admin/risk/blacklist/${id}`, { method: "DELETE" });
    loadBlacklist();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold" style={{ color: "var(--admin-text)" }}>
          Blacklist giocatori ({entries.length})
        </h2>
        <button
          onClick={() => { setShowForm(!showForm); setError(null); }}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30"
        >
          {showForm ? "Annulla" : "Blocca Giocatore"}
        </button>
      </div>

      {/* Block form */}
      {showForm && (
        <form onSubmit={handleBlock} className="rounded-xl p-4 space-y-3" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>Blocca giocatore</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Player search */}
            <div className="relative">
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Username giocatore *</label>
              <input
                type="text"
                value={form.player_search}
                onChange={e => {
                  setForm(f => ({ ...f, player_search: e.target.value, player_id: "" }));
                  searchPlayer(e.target.value);
                }}
                placeholder="Cerca username..."
                required
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              />
              {playerSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden shadow-lg" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                  {playerSuggestions.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, player_search: p.username, player_id: p.id }));
                        setPlayerSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10"
                      style={{ color: "var(--admin-text)" }}
                    >
                      {p.username}
                    </button>
                  ))}
                </div>
              )}
              {playerSearchLoading && <span className="text-[10px] text-gray-500 mt-0.5 block">Ricerca...</span>}
              {form.player_id && (
                <span className="text-[10px] text-emerald-400 mt-0.5 block">Giocatore selezionato</span>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block text-[10px] mb-1" style={{ color: "var(--admin-text4)" }}>Motivo</label>
              <input
                type="text"
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Es. Frode sospetta, violazione T&C..."
                className="w-full border border-gray-700 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: "var(--admin-input, #1e293b)", color: "var(--admin-text)" }}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !form.player_id}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
            >
              {saving ? "Blocco..." : "Blocca giocatore"}
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
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: "var(--admin-text4)" }}>Nessun giocatore in blacklist</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                  <th className="text-left px-3 py-2 font-semibold">Username</th>
                  <th className="text-left px-3 py-2 font-semibold">Agente</th>
                  <th className="text-left px-3 py-2 font-semibold">Motivo</th>
                  <th className="text-left px-3 py-2 font-semibold">Bloccato da</th>
                  <th className="text-right px-3 py-2 font-semibold">Data</th>
                  <th className="text-center px-3 py-2 font-semibold">Azione</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} className="border-b border-gray-800/50 hover:bg-white/5">
                    <td className="px-3 py-2">
                      <span className="font-mono font-bold" style={{ color: "var(--admin-text)" }}>
                        {entry.users?.username || entry.player_id.slice(0, 8) + "…"}
                      </span>
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--admin-text3)" }}>
                      {entry.agents?.display_name || "—"}
                    </td>
                    <td className="px-3 py-2 max-w-xs truncate" style={{ color: "var(--admin-text3)" }}>
                      {entry.reason || <span className="text-gray-600 italic">nessun motivo</span>}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--admin-text3)" }}>
                      {entry.blocked_by || <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleDateString("it-IT", {
                        day: "2-digit", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit"
                      })}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleUnblock(entry.id)}
                        className="px-2 py-0.5 rounded text-[8px] font-bold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                      >
                        Sblocca
                      </button>
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
