"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  username: string;
  email: string;
  kyc_status: string;
  user_class: string;
  is_active: boolean;
  balance: number;
  bonus_balance: number;
  created_at: string;
  total_bets: number;
}

export default function AdminManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: usersData } = await supabase
        .from("users")
        .select("id, username, email, kyc_status, user_class, is_active, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (usersData && usersData.length > 0) {
        const ids = usersData.map(u => u.id);
        const { data: wallets } = await supabase.from("wallets").select("user_id, balance, bonus_balance").in("user_id", ids);
        const { data: bets } = await supabase.from("bets").select("user_id").in("user_id", ids);

        const walletMap = new Map(wallets?.map(w => [w.user_id, w]) || []);
        const betCounts = new Map<string, number>();
        bets?.forEach(b => betCounts.set(b.user_id, (betCounts.get(b.user_id) || 0) + 1));

        setUsers(usersData.map(u => ({
          ...u,
          balance: walletMap.get(u.id)?.balance || 0,
          bonus_balance: walletMap.get(u.id)?.bonus_balance || 0,
          total_bets: betCounts.get(u.id) || 0,
        })));
      }
      setLoading(false);
    }
    load();
  }, []);

  const filtered = search
    ? users.filter(u => u.username?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()))
    : users;

  const toggleActive = async (userId: string, current: boolean) => {
    await supabase.from("users").update({ is_active: !current }).eq("id", userId);
    setUsers(users.map(u => u.id === userId ? { ...u, is_active: !current } : u));
  };

  const updateKYC = async (userId: string, status: string) => {
    await supabase.from("users").update({ kyc_status: status }).eq("id", userId);
    setUsers(users.map(u => u.id === userId ? { ...u, kyc_status: status } : u));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Gestione Utenti</h1>
          <p className="text-sm text-gray-500">{users.length} utenti registrati</p>
        </div>
      </div>

      <div className="mb-4">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Cerca per username o email..."
          className="w-full max-w-md px-4 py-2 rounded-lg bg-[var(--admin-card)] border border-gray-800 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-brand" />
      </div>

      <div className="bg-[var(--admin-card)] rounded-xl border border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Caricamento...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left px-4 py-3">Username</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-right px-4 py-3">Saldo</th>
                <th className="text-right px-4 py-3">Bonus</th>
                <th className="text-center px-4 py-3">Bets</th>
                <th className="text-center px-4 py-3">KYC</th>
                <th className="text-center px-4 py-3">Stato</th>
                <th className="text-right px-4 py-3">Registrato</th>
                <th className="text-center px-4 py-3">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b border-gray-800/50 hover:bg-white/5">
                  <td className="px-4 py-3 text-white font-medium">{u.username}</td>
                  <td className="px-4 py-3 text-gray-400">{u.email}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-400">€{u.balance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono text-purple-400">€{u.bonus_balance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-center text-gray-300">{u.total_bets}</td>
                  <td className="px-4 py-3 text-center">
                    <select value={u.kyc_status || "pending"} onChange={(e) => updateKYC(u.id, e.target.value)}
                      className="bg-transparent border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300 focus:outline-none">
                      <option value="pending">Pending</option>
                      <option value="submitted">Submitted</option>
                      <option value="verified">Verified</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                      u.is_active !== false ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                    )}>{u.is_active !== false ? "ATTIVO" : "BLOCCATO"}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{new Date(u.created_at).toLocaleDateString("it-IT")}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(u.id, u.is_active !== false)}
                      className={cn("px-2 py-1 rounded text-xs font-bold",
                        u.is_active !== false ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                      )}>{u.is_active !== false ? "Blocca" : "Attiva"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
