"use client";

import { useEffect, useState, useCallback } from "react";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open: { bg: "#3b82f620", text: "#60a5fa" },
  won: { bg: "#10b98120", text: "#10b981" },
  lost: { bg: "#ef444420", text: "#ef4444" },
  void: { bg: "#f59e0b20", text: "#f59e0b" },
  pending_acceptance: { bg: "#8b5cf620", text: "#a78bfa" },
};

export default function AgentBetsPage() {
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentId, setAgentId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      const me = await meRes.json();
      const userId = me.user?.id;
      if (!userId) return;

      const agentsRes = await fetch("/api/admin/agents");
      const agentsData = await agentsRes.json();
      const myAgent = (agentsData.agents || []).find((a: any) => a.user_id === userId);
      if (!myAgent) return;
      setAgentId(myAgent.id);

      // Get players
      const playersRes = await fetch(`/api/admin/agents/${myAgent.id}/players`);
      const playersData = await playersRes.json();
      const playerIds = (playersData.players || []).map((p: any) => p.id);
      const playerMap = new Map((playersData.players || []).map((p: any) => [p.id, p.username]));

      if (playerIds.length === 0) { setBets([]); return; }

      // Fetch bets — we need a scoped API, for now use the financial data
      // Since we don't have a direct scoped bets API, show from financial
      setBets([]); // placeholder — needs backend scoped bets endpoint
    } catch { }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento scommesse...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>Scommesse Giocatori</h2>

      <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", background: "var(--admin-card, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 12 }}>
        <div style={{ fontSize: 14, marginBottom: 8 }}>Le scommesse dei tuoi giocatori sono visibili nel report finanziario.</div>
        <a href="/admin/agent-commissions" style={{ color: "#f0b429", fontWeight: 700, fontSize: 14 }}>
          Vai al Report →
        </a>
      </div>
    </div>
  );
}
