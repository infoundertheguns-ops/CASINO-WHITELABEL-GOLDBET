"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { RiskKPIs } from "@/components/admin/risk/risk-kpis";
import { RiskScoreChart } from "@/components/admin/risk/risk-score-chart";
import { AlertsTimeline } from "@/components/admin/risk/alerts-timeline";
import { SportRiskChart } from "@/components/admin/risk/sport-risk-chart";
import { FlaggedUsersTable } from "@/components/admin/risk/flagged-users-table";
import { AIAnalysisPanel } from "@/components/admin/risk/ai-analysis-panel";
import { ResolveModal } from "@/components/admin/risk/resolve-modal";
import { SLABadge } from "@/components/admin/risk/sla-badge";
import { AssignmentDropdown } from "@/components/admin/risk/assignment-dropdown";
import { AlertsPerDayChart } from "@/components/admin/risk/alerts-per-day-chart";
import { LiveBetTicker } from "@/components/admin/risk/live-bet-ticker";
import { LimitsTab } from "@/components/admin/risk/limits-tab";
import { BlacklistTab } from "@/components/admin/risk/blacklist-tab";

type Tab = "dashboard" | "alerts" | "users" | "ai" | "trading" | "liability" | "limits" | "blacklist";

export default function AdminRiskAgent() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertFilter, setAlertFilter] = useState({ severity: "", status: "" });
  const [users, setUsers] = useState<any[]>([]);
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotal, setUsersTotal] = useState(0);
  // Bulk selection
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set());
  const [resolveModal, setResolveModal] = useState<{ open: boolean; mode: "single" | "bulk"; ids: string[] }>({
    open: false, mode: "single", ids: [],
  });
  // Trading queue
  const [tradingBets, setTradingBets] = useState<any[]>([]);
  const [tradingTotal, setTradingTotal] = useState(0);
  // Liability
  const [liabilityData, setLiabilityData] = useState<any>(null);
  const [liabilityEvent, setLiabilityEvent] = useState<any>(null);
  // Admins list for assignment
  const [admins, setAdmins] = useState<{ id: string; display_name: string }[]>([]);
  // Stats for dashboard charts (lazy loaded)
  const [alertsByDay, setAlertsByDay] = useState<Record<string, number>>({});
  const [sportRisk, setSportRisk] = useState<any[]>([]);

  const supabase = createClient();

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/risk?tab=overview");
      const data = await res.json();
      setOverview(data);
    } catch {}
  }, []);

  // Load stats lazily only when dashboard tab is active
  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/risk?tab=stats");
      const data = await res.json();
      setAlertsByDay(data.byDay || {});
      setSportRisk(data.sport_risk || []);
    } catch {}
  }, []);

  // Load admin users for assignment dropdown
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/risk?tab=users&page=1&limit=1");
        // Admin users from admin_users table — use a simple list
        // For now, provide a default admin
        setAdmins([
          { id: "admin", display_name: "Admin" },
        ]);
      } catch {}
    })();
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tab: "alerts", page: String(alertsPage), limit: "20" });
      if (alertFilter.severity) params.set("severity", alertFilter.severity);
      if (alertFilter.status) params.set("status", alertFilter.status);
      const res = await fetch(`/api/admin/risk?${params}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
      setAlertsTotal(data.total || 0);
    } catch {}
  }, [alertsPage, alertFilter]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/risk?tab=users&page=${usersPage}&limit=20`);
      const data = await res.json();
      setUsers(data.users || []);
      setUsersTotal(data.total || 0);
    } catch {}
  }, [usersPage]);

  const loadTrading = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/trading-queue");
      const data = await res.json();
      setTradingBets(data.bets || []);
      setTradingTotal(data.total || 0);
    } catch {}
  }, []);

  const loadLiability = useCallback(async (eventId?: string) => {
    try {
      const url = eventId
        ? `/api/admin/liability?view=event&event_id=${eventId}`
        : "/api/admin/liability";
      const res = await fetch(url);
      const data = await res.json();
      if (eventId) setLiabilityEvent(data);
      else setLiabilityData(data);
    } catch {}
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadOverview()]).finally(() => setLoading(false));
  }, [loadOverview]);

  useEffect(() => { if (tab === "dashboard") loadStats(); }, [tab, loadStats]);
  useEffect(() => { if (tab === "alerts") loadAlerts(); }, [tab, loadAlerts]);
  useEffect(() => { if (tab === "users") loadUsers(); }, [tab, loadUsers]);
  useEffect(() => { if (tab === "trading") loadTrading(); }, [tab, loadTrading]);
  useEffect(() => { if (tab === "liability") loadLiability(); }, [tab, loadLiability]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("risk-flags-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "risk_flags" }, () => {
        loadOverview();
        if (tab === "alerts") loadAlerts();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, (payload) => {
        if ((payload.new as any)?.status === "pending_acceptance" && tab === "trading") loadTrading();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tab, loadOverview, loadAlerts, loadTrading, supabase]);

  const handleResolveAlert = async (id: string, status: string) => {
    try {
      await fetch("/api/admin/risk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, status } : a));
      loadOverview();
    } catch {}
  };

  const handleBulkAction = async (action: string, notes: string) => {
    const ids = resolveModal.ids;
    await fetch("/api/admin/risk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bulk: true, ids, status: action === "block_users" || action === "reduce_limits" ? "resolved" : action, action, notes }),
    });
    setSelectedAlerts(new Set());
    loadAlerts();
    loadOverview();
  };

  const handleTradingAction = async (betId: string, action: string, acceptedStake?: number, note?: string) => {
    await fetch("/api/admin/trading-queue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet_id: betId, action, accepted_stake: acceptedStake, note }),
    });
    loadTrading();
    loadOverview();
  };

  const handleAIAnalyze = async (id: string, type: "bet" | "user") => {
    const res = await fetch("/api/risk-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bet_id: id, use_ai: true }),
    });
    if (!res.ok) throw new Error("Analisi fallita");
    return res.json();
  };

  const handleAssign = async (alertId: string, adminId: string | null) => {
    await fetch("/api/admin/risk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: alertId, assigned_to: adminId }),
    });
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, assigned_to: adminId } : a));
  };

  const toggleSelect = (id: string) => {
    setSelectedAlerts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedAlerts.size === alerts.length) setSelectedAlerts(new Set());
    else setSelectedAlerts(new Set(alerts.map(a => a.id)));
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "alerts", label: "Alert", badge: overview?.kpis?.open_alerts },
    { id: "trading", label: "Trading Queue", badge: overview?.kpis?.pending_bets },
    { id: "liability", label: "Liability" },
    { id: "users", label: "Utenti" },
    { id: "ai", label: "AI" },
    { id: "limits", label: "Limiti" },
    { id: "blacklist", label: "Blacklist" },
  ];

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Caricamento...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: "var(--admin-text)" }}>Risk & Trading Desk</h1>
          <p className="text-sm" style={{ color: "var(--admin-text4)" }}>Liability, accettazione bet, AI optimizer, alert</p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 rounded-lg p-1 w-fit flex-wrap" style={{ background: "var(--admin-card)" }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2 rounded-md text-xs font-bold transition-colors relative",
              tab === t.id ? "bg-brand/20 text-brand" : "text-gray-500 hover:text-white"
            )}
          >
            {t.label}
            {t.badge && t.badge > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ Dashboard ═══ */}
      {tab === "dashboard" && overview && (
        <div className="space-y-4">
          <RiskKPIs
            openAlerts={overview.kpis?.open_alerts || 0}
            criticalAlerts={overview.kpis?.critical_alerts || 0}
            avgScore={overview.kpis?.avg_score || 0}
            flaggedUsers={overview.kpis?.flagged_users || 0}
            blockedToday={overview.kpis?.blocked_today || 0}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RiskScoreChart distribution={overview.distribution || { low: 0, medium: 0, high: 0, critical: 0 }} />
            <SportRiskChart data={sportRisk.length > 0 ? sportRisk : (overview.sport_risk || [])} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AlertsPerDayChart data={alertsByDay} />
            <LiveBetTicker />
          </div>
          <AlertsTimeline alerts={overview.recent_alerts || []} onResolve={handleResolveAlert} />
        </div>
      )}

      {/* ═══ Alerts with Bulk Actions ═══ */}
      {tab === "alerts" && (
        <div className="space-y-4">
          <div className="flex gap-3 items-center flex-wrap">
            <select value={alertFilter.severity} onChange={e => { setAlertFilter(f => ({ ...f, severity: e.target.value })); setAlertsPage(1); }}
              className="border border-gray-700 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--admin-card)", color: "var(--admin-text)" }}>
              <option value="">Tutte le severity</option>
              <option value="critical">Critical</option><option value="high">High</option>
              <option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <select value={alertFilter.status} onChange={e => { setAlertFilter(f => ({ ...f, status: e.target.value })); setAlertsPage(1); }}
              className="border border-gray-700 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--admin-card)", color: "var(--admin-text)" }}>
              <option value="">Tutti gli status</option>
              <option value="open">Open</option><option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
              <option value="escalated">Escalated</option>
            </select>

            {selectedAlerts.size > 0 && (
              <button
                onClick={() => setResolveModal({ open: true, mode: "bulk", ids: [...selectedAlerts] })}
                className="px-3 py-2 rounded-lg text-xs font-bold bg-brand/20 text-brand"
              >
                Azione su {selectedAlerts.size} selezionati
              </button>
            )}

            <span className="text-[10px] ml-auto" style={{ color: "var(--admin-text4)" }}>{alertsTotal} risultati</span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                    <th className="text-left px-3 py-2">
                      <input type="checkbox" checked={selectedAlerts.size === alerts.length && alerts.length > 0}
                        onChange={selectAll} className="accent-brand" />
                    </th>
                    <th className="text-left px-3 py-2 font-semibold">Severity</th>
                    <th className="text-left px-3 py-2 font-semibold">Utente</th>
                    <th className="text-left px-3 py-2 font-semibold">Tipo</th>
                    <th className="text-left px-3 py-2 font-semibold">Descrizione</th>
                    <th className="text-center px-3 py-2 font-semibold">SLA</th>
                    <th className="text-center px-3 py-2 font-semibold">Assegna</th>
                    <th className="text-center px-3 py-2 font-semibold">Status</th>
                    <th className="text-right px-3 py-2 font-semibold">Data</th>
                    <th className="text-center px-3 py-2 font-semibold">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(a => (
                    <tr key={a.id} className="border-b border-gray-800/50 hover:bg-white/5">
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selectedAlerts.has(a.id)}
                          onChange={() => toggleSelect(a.id)} className="accent-brand" />
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold",
                          a.severity === "critical" ? "bg-red-500/20 text-red-400" :
                          a.severity === "high" ? "bg-orange-500/20 text-orange-400" :
                          a.severity === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-green-500/20 text-green-400"
                        )}>{a.severity?.toUpperCase()}</span>
                      </td>
                      <td className="px-3 py-2">
                        <a href={`/admin/risk/player/${a.user_id}`} className="hover:text-brand underline" style={{ color: "var(--admin-text)" }}>
                          {a.users?.username || "—"}
                        </a>
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--admin-text3)" }}>{a.flag_type}</td>
                      <td className="px-3 py-2 max-w-xs truncate" style={{ color: "var(--admin-text3)" }}>{a.description}</td>
                      <td className="px-3 py-2 text-center">
                        <SLABadge deadline={a.sla_deadline} severity={a.severity} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <AssignmentDropdown
                          currentAssignee={a.assigned_to}
                          admins={admins}
                          onAssign={(adminId) => handleAssign(a.id, adminId)}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={cn("text-[8px] font-bold",
                          a.status === "open" ? "text-yellow-400" : a.status === "resolved" ? "text-emerald-400" :
                          a.status === "escalated" ? "text-red-400" : "text-gray-500"
                        )}>{a.status?.toUpperCase()}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">
                        {new Date(a.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {a.status === "open" && (
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => setResolveModal({ open: true, mode: "single", ids: [a.id] })}
                              className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-bold">Risolvi</button>
                            <button onClick={() => handleResolveAlert(a.id, "dismissed")}
                              className="px-2 py-0.5 rounded bg-gray-500/20 text-gray-400 text-[8px] font-bold">Ignora</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {alertsTotal > 20 && (
              <div className="px-4 py-3 border-t border-gray-800 flex gap-2 justify-center">
                <button onClick={() => setAlertsPage(p => Math.max(1, p - 1))} disabled={alertsPage === 1}
                  className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30">Prec</button>
                <span className="text-xs text-gray-500 px-3 py-1">Pagina {alertsPage}</span>
                <button onClick={() => setAlertsPage(p => p + 1)} disabled={alertsPage * 20 >= alertsTotal}
                  className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30">Succ</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ Trading Queue ═══ */}
      {tab === "trading" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold" style={{ color: "var(--admin-text)" }}>
              Bet in attesa di accettazione ({tradingTotal})
            </h2>
            <button onClick={loadTrading} className="text-[10px] text-brand hover:underline">Aggiorna</button>
          </div>

          {tradingBets.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--admin-text4)" }}>
              <p className="text-sm">Nessuna bet in coda</p>
              <p className="text-[10px] mt-1">Le bet che richiedono approvazione manuale appariranno qui</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tradingBets.map((bet: any) => (
                <div key={bet.id} className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold" style={{ color: "var(--admin-text)" }}>
                          {bet.users?.username || "—"}
                        </span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-bold">
                          {bet.users?.user_class?.toUpperCase() || "NEW"}
                        </span>
                        {bet.is_live && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">LIVE</span>
                        )}
                        <span
                          className="text-[9px] font-mono cursor-pointer hover:text-brand transition-colors"
                          style={{ color: "var(--admin-text4)" }}
                          title="Clicca per copiare ID completo"
                          onClick={() => { navigator.clipboard.writeText(bet.id); }}
                        >
                          #{bet.id?.slice(0, 8)} 📋
                        </span>
                      </div>
                      <div className="text-[10px] mb-2" style={{ color: "var(--admin-text3)" }}>
                        {(bet.bet_selections || []).map((s: any, i: number) => (
                          <div key={i}>
                            {s.events?.home_team} vs {s.events?.away_team} — {s.markets?.name}: <b>{s.outcomes?.name}</b> @{s.odds_at_placement}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-4 text-[10px]" style={{ color: "var(--admin-text4)" }}>
                        <span>Stake: <b style={{ color: "var(--admin-text)" }}>€{bet.requested_stake || bet.stake}</b></span>
                        <span>Quote: <b>{bet.total_odds?.toFixed(2)}</b></span>
                        <span>Vincita pot.: <b>€{bet.potential_win?.toFixed(2)}</b></span>
                        <span>Risk: <b className={bet.risk_score > 50 ? "text-red-400" : ""}>{bet.risk_score || "—"}</b></span>
                        {bet.acceptance_note && <span className="italic">{bet.acceptance_note}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => handleTradingAction(bet.id, "accept")}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                        Accetta
                      </button>
                      <button onClick={() => {
                        const partial = prompt(`Stake parziale (max $${bet.requested_stake || bet.stake}):`);
                        if (partial) handleTradingAction(bet.id, "partial_accept", parseFloat(partial));
                      }}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30">
                        Parziale
                      </button>
                      <button onClick={() => handleTradingAction(bet.id, "reject", undefined, "Rifiutata dal trader")}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30">
                        Rifiuta
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-[9px]" style={{ color: "var(--admin-text4)" }}>
                    {new Date(bet.created_at).toLocaleString("it-IT")}
                    {bet.time_to_kickoff_minutes != null && ` | Kickoff tra ${bet.time_to_kickoff_minutes}min`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Liability ═══ */}
      {tab === "liability" && (
        <div className="space-y-4">
          {liabilityEvent ? (
            // Event detail view
            <div>
              <button onClick={() => setLiabilityEvent(null)} className="text-xs text-brand hover:underline mb-3">
                &larr; Torna alla lista
              </button>
              <div className="rounded-xl p-4 mb-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                <h3 className="text-sm font-bold mb-1" style={{ color: "var(--admin-text)" }}>
                  {liabilityEvent.event?.home_team} vs {liabilityEvent.event?.away_team}
                </h3>
                <p className="text-[10px]" style={{ color: "var(--admin-text4)" }}>
                  {liabilityEvent.event?.sport?.name} | {liabilityEvent.event?.league?.name}
                </p>
              </div>

              <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                      <th className="text-left px-4 py-2">Esito</th>
                      <th className="text-right px-4 py-2">Liability</th>
                      <th className="text-right px-4 py-2">Max</th>
                      <th className="text-right px-4 py-2">% Usato</th>
                      <th className="text-right px-4 py-2">Stake Tot.</th>
                      <th className="text-right px-4 py-2">N. Bet</th>
                      <th className="text-center px-4 py-2">AI Optimizer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(liabilityEvent.liability || []).map((l: any) => (
                      <tr key={l.outcome_id} className="border-b border-gray-800/50">
                        <td className="px-4 py-2" style={{ color: "var(--admin-text)" }}>{l.outcome_name}</td>
                        <td className="px-4 py-2 text-right font-mono" style={{ color: l.pct_used > 80 ? "#ef4444" : l.pct_used > 50 ? "#f59e0b" : "var(--admin-text)" }}>
                          €${l.current_liability?.toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono" style={{ color: "var(--admin-text3)" }}>€{l.max_liability?.toFixed(0)}</td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                              <div className="h-full rounded-full" style={{
                                width: `${Math.min(100, l.pct_used)}%`,
                                background: l.pct_used > 80 ? "#ef4444" : l.pct_used > 50 ? "#f59e0b" : "#22c55e"
                              }} />
                            </div>
                            <span className="text-[10px] font-mono" style={{ color: "var(--admin-text3)" }}>{l.pct_used?.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono" style={{ color: "var(--admin-text3)" }}>€{l.total_stake?.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--admin-text3)" }}>{l.bet_count || 0}</td>
                        <td className="px-4 py-2 text-center">
                          {l.pct_used > 50 && (
                            <button
                              onClick={async () => {
                                const res = await fetch("/api/admin/liability", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ event_id: liabilityEvent.event?.id, auto_apply: false }),
                                });
                                const data = await res.json();
                                alert(`AI suggerisce ${data.suggestions?.length || 0} aggiustamenti`);
                              }}
                              className="px-2 py-0.5 rounded text-[8px] font-bold bg-purple-500/20 text-purple-400"
                            >
                              Ottimizza
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Recent adjustments */}
              {liabilityEvent.adjustments?.length > 0 && (
                <div className="mt-4 rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                  <h4 className="text-xs font-bold mb-2" style={{ color: "var(--admin-text)" }}>Aggiustamenti recenti</h4>
                  {liabilityEvent.adjustments.map((adj: any) => (
                    <div key={adj.id} className="flex items-center gap-3 py-1 text-[10px]" style={{ color: "var(--admin-text3)" }}>
                      <span className="font-mono">{adj.old_odds} &rarr; {adj.new_odds}</span>
                      <span className={cn("px-1 py-0.5 rounded text-[8px]",
                        adj.suggested_by === "ai" ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"
                      )}>{adj.suggested_by}</span>
                      <span className="truncate max-w-[200px]">{adj.reason}</span>
                      <span className="ml-auto text-gray-500">{new Date(adj.created_at).toLocaleTimeString("it-IT")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Overview
            <>
              {liabilityData?.global && (
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                    <div className="text-[10px] uppercase font-bold" style={{ color: "var(--admin-text4)" }}>Liability Totale</div>
                    <div className="text-xl font-black mt-1" style={{ color: "var(--admin-text)" }}>€{(liabilityData.global.total_liability || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                    <div className="text-[10px] uppercase font-bold" style={{ color: "var(--admin-text4)" }}>Eventi Critici</div>
                    <div className="text-xl font-black mt-1 text-red-400">{liabilityData.global.critical_events || 0}</div>
                  </div>
                  <div className="rounded-xl p-4" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                    <div className="text-[10px] uppercase font-bold" style={{ color: "var(--admin-text4)" }}>Eventi Monitorati</div>
                    <div className="text-xl font-black mt-1" style={{ color: "var(--admin-text)" }}>{liabilityData.global.total_events || 0}</div>
                  </div>
                </div>
              )}

              <div className="rounded-xl overflow-hidden" style={{ background: "var(--admin-card)", border: "1px solid var(--admin-border)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--admin-text4)", borderBottom: "1px solid var(--admin-border)" }}>
                      <th className="text-left px-4 py-2">Evento</th>
                      <th className="text-left px-4 py-2">Sport</th>
                      <th className="text-right px-4 py-2">Max Liability</th>
                      <th className="text-right px-4 py-2">% Esposizione</th>
                      <th className="text-center px-4 py-2">Esiti Caldi</th>
                      <th className="text-center px-4 py-2">Dettaglio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(liabilityData?.events || []).map((e: any) => (
                      <tr key={e.id} className="border-b border-gray-800/50 hover:bg-white/5">
                        <td className="px-4 py-2">
                          <div style={{ color: "var(--admin-text)" }}>{e.home_team} vs {e.away_team}</div>
                          <div className="text-[9px]" style={{ color: "var(--admin-text4)" }}>
                            {e.league?.name} {e.is_live && <span className="text-red-400">LIVE</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2" style={{ color: "var(--admin-text3)" }}>{e.sport?.name}</td>
                        <td className="px-4 py-2 text-right font-mono" style={{ color: e.max_pct > 80 ? "#ef4444" : "var(--admin-text)" }}>
                          €${e.max_liability?.toFixed(0)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                              <div className="h-full rounded-full" style={{
                                width: `${Math.min(100, e.max_pct)}%`,
                                background: e.max_pct > 80 ? "#ef4444" : e.max_pct > 50 ? "#f59e0b" : "#22c55e"
                              }} />
                            </div>
                            <span className="text-[10px] font-mono">{e.max_pct?.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {e.hot_outcomes > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-orange-500/20 text-orange-400">
                              {e.hot_outcomes}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button onClick={() => loadLiability(e.id)}
                            className="px-2 py-0.5 rounded text-[8px] font-bold bg-brand/20 text-brand">
                            Dettaglio
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Users ═══ */}
      {tab === "users" && (
        <div className="space-y-4">
          <FlaggedUsersTable users={users} />
          {usersTotal > 20 && (
            <div className="flex gap-2 justify-center">
              <button onClick={() => setUsersPage(p => Math.max(1, p - 1))} disabled={usersPage === 1}
                className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30">Prec</button>
              <span className="text-xs text-gray-500 px-3 py-1">Pagina {usersPage} / {Math.ceil(usersTotal / 20)}</span>
              <button onClick={() => setUsersPage(p => p + 1)} disabled={usersPage * 20 >= usersTotal}
                className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white disabled:opacity-30">Succ</button>
            </div>
          )}
        </div>
      )}

      {/* ═══ AI ═══ */}
      {tab === "ai" && <AIAnalysisPanel onAnalyze={handleAIAnalyze} />}

      {/* ═══ Limits ═══ */}
      {tab === "limits" && <LimitsTab />}

      {/* ═══ Blacklist ═══ */}
      {tab === "blacklist" && <BlacklistTab />}

      {/* Resolve Modal */}
      <ResolveModal
        isOpen={resolveModal.open}
        onClose={() => setResolveModal({ open: false, mode: "single", ids: [] })}
        onConfirm={handleBulkAction}
        alertCount={resolveModal.ids.length}
        mode={resolveModal.mode}
      />
    </div>
  );
}
