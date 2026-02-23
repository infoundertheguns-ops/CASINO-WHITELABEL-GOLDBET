"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface FlaggedUser {
  id: string;
  user_id: string;
  classification: string;
  risk_score: number;
  total_bets: number;
  total_stake: number;
  win_rate: number;
  avg_stake: number;
  lifetime_ggr: number;
  flags_count: number;
  users?: {
    username: string;
    email: string;
    kyc_status: string;
    user_class: string;
    created_at: string;
    is_blocked: boolean;
  };
}

const classBadge = (c: string) => {
  switch (c) {
    case "sharp": return "bg-red-500/20 text-red-400";
    case "syndicate": return "bg-red-600/20 text-red-300";
    case "semi_pro": return "bg-orange-500/20 text-orange-400";
    case "vip": return "bg-purple-500/20 text-purple-400";
    default: return "bg-green-500/20 text-green-400";
  }
};

export function FlaggedUsersTable({ users }: { users: FlaggedUser[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (users.length === 0) {
    return (
      <div className="bg-[#12111a] rounded-xl border border-gray-800 p-8 text-center text-gray-500 text-sm">
        Nessun utente flaggato
      </div>
    );
  }

  return (
    <div className="bg-[#12111a] rounded-xl border border-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-bold text-white">Utenti Flaggati</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left px-4 py-2 font-semibold">Utente</th>
              <th className="text-center px-4 py-2 font-semibold">Classificazione</th>
              <th className="text-right px-4 py-2 font-semibold">Risk Score</th>
              <th className="text-right px-4 py-2 font-semibold">Bet Totali</th>
              <th className="text-right px-4 py-2 font-semibold">Win Rate</th>
              <th className="text-right px-4 py-2 font-semibold">GGR</th>
              <th className="text-center px-4 py-2 font-semibold">Flags</th>
              <th className="text-center px-4 py-2 font-semibold">KYC</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <>
                <tr
                  key={u.id}
                  className="border-b border-gray-800/50 hover:bg-white/5 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                >
                  <td className="px-4 py-2">
                    <div className="text-white font-medium">{u.users?.username || "—"}</div>
                    <div className="text-[9px] text-gray-500">{u.users?.email}</div>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold", classBadge(u.classification))}>
                      {u.classification.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={cn("font-mono font-bold",
                      u.risk_score > 75 ? "text-red-400" :
                      u.risk_score > 50 ? "text-orange-400" :
                      u.risk_score > 25 ? "text-yellow-400" :
                      "text-green-400"
                    )}>{u.risk_score}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">{u.total_bets}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">{(u.win_rate * 100).toFixed(1)}%</td>
                  <td className={cn("px-4 py-2 text-right font-mono", u.lifetime_ggr >= 0 ? "text-emerald-400" : "text-red-400")}>
                    ${u.lifetime_ggr.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-center font-mono text-orange-400">{u.flags_count}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold",
                      u.users?.kyc_status === "verified" ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400"
                    )}>
                      {u.users?.kyc_status === "verified" ? "OK" : "NO"}
                    </span>
                  </td>
                </tr>
                {expandedId === u.id && (
                  <tr key={`${u.id}-detail`} className="bg-[#0d0c15]">
                    <td colSpan={8} className="px-6 py-4">
                      <div className="grid grid-cols-4 gap-4 text-[10px]">
                        <div>
                          <span className="text-gray-500">Stake Totale</span>
                          <div className="text-white font-mono">${u.total_stake.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Avg Stake</span>
                          <div className="text-white font-mono">${u.avg_stake.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Account</span>
                          <div className="text-white">{u.users?.created_at ? new Date(u.users.created_at).toLocaleDateString("it-IT") : "—"}</div>
                        </div>
                        <div>
                          <span className="text-gray-500">Status</span>
                          <div className={u.users?.is_blocked ? "text-red-400 font-bold" : "text-green-400"}>
                            {u.users?.is_blocked ? "BLOCCATO" : "ATTIVO"}
                          </div>
                        </div>
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
